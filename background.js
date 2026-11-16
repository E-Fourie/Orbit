// Spaces – background service worker
// Model: each space is a tab group (title = "<emoji> <name>") in the window.
// Inactive spaces are either collapsed (default) or suspended (tabs saved + closed).
// Native pinned tabs are never grouped, so they act as global pins across spaces.

const NONE = -1; // chrome.tabGroups.TAB_GROUP_ID_NONE
const label = (s) => `${s.emoji || '📁'} ${s.name}`;

// ---------- serialisation ----------
let queue = Promise.resolve();
const enqueue = (fn) => {
  const run = queue.then(fn);
  queue = run.catch(() => {});
  return run;
};

// ---------- storage helpers ----------
async function getState() {
  const s = await chrome.storage.local.get(['spaces', 'folders', 'settings']);
  return {
    spaces: s.spaces || [],
    folders: s.folders || [],
    settings: { suspend: false, ...(s.settings || {}) },
  };
}
// Display / cycling order: each folder's spaces in folder order, then spaces not in a folder.
function orderedSpaces(spaces, folders) {
  const ids = new Set(folders.map((f) => f.id));
  return [
    ...folders.flatMap((f) => spaces.filter((s) => s.folderId === f.id)),
    ...spaces.filter((s) => !s.folderId || !ids.has(s.folderId)),
  ];
}
async function getSession() {
  const { groups = {}, active = {} } = await chrome.storage.session.get(['groups', 'active']);
  return { groups, active };
}
async function setGroupMapping(win, spaceId, groupId) {
  const { groups } = await getSession();
  groups[win] = groups[win] || {};
  groups[win][spaceId] = groupId;
  await chrome.storage.session.set({ groups });
}
async function mainWindowId() {
  const w = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
  return w.id;
}
const normalWindows = () => chrome.windows.getAll({ windowTypes: ['normal'] });

// Group ids that we close on purpose (so we don't treat it as "user emptied the space")
const expectedRemovals = new Set();

// ---------- group lookup ----------
async function findGroup(space, win) {
  const { groups } = await getSession();
  const gid = groups[win]?.[space.id];
  if (gid != null) {
    try {
      const g = await chrome.tabGroups.get(gid);
      if (g.windowId === win) return g;
    } catch {}
  }
  // Adopt a group by title (handles browser session restore, where ids change)
  const all = await chrome.tabGroups.query({ windowId: win });
  const g = all.find((x) => x.title === label(space));
  if (g) {
    await setGroupMapping(win, space.id, g.id);
    return g;
  }
  return null;
}

async function spaceForGroup(groupId, win, spaces) {
  if (groupId == null || groupId < 0) return null;
  const { groups } = await getSession();
  for (const [sid, gid] of Object.entries(groups[win] || {})) if (gid === groupId) return sid;
  try {
    const g = await chrome.tabGroups.get(groupId);
    const s = spaces.find((x) => label(x) === g.title);
    if (s) {
      await setGroupMapping(win, s.id, groupId);
      return s.id;
    }
  } catch {}
  return null;
}

async function currentSpaceId(win, spaces) {
  const [t] = await chrome.tabs.query({ active: true, windowId: win });
  const fromTab = t ? await spaceForGroup(t.groupId, win, spaces) : null;
  if (fromTab) return fromTab;
  const { active } = await getSession();
  return spaces.some((s) => s.id === active[win]) ? active[win] : null;
}

// ---------- snapshotting (keeps saved tabs fresh for suspend/restore & restarts) ----------
async function snapshotWindow(spaces, win) {
  for (const s of spaces) {
    const g = await findGroup(s, win);
    if (!g) continue;
    const tabs = (await chrome.tabs.query({ groupId: g.id })).sort((a, b) => a.index - b.index);
    if (!tabs.length) continue;
    const prev = new Map((s.tabs || []).map((x) => [x.url, x]));
    s.tabs = tabs.map((t) => {
      const url = t.url || t.pendingUrl || '';
      const old = prev.get(url);
      const title = t.title && t.title !== url ? t.title : old?.title || t.title || '';
      return { url, title, favIconUrl: t.favIconUrl || old?.favIconUrl || '' };
    });
    const ai = tabs.findIndex((t) => t.active);
    if (ai >= 0) s.activeIdx = ai;
  }
  await snapshotPins(spaces, win);
}

async function ownerFor(win, spaces) {
  const { pinOwner = {} } = await chrome.storage.local.get('pinOwner');
  if (spaces.some((s) => s.id === pinOwner[win])) return pinOwner[win];
  return currentSpaceId(win, spaces);
}
async function setPinOwner(win, id) {
  const { pinOwner = {} } = await chrome.storage.local.get('pinOwner');
  pinOwner[win] = id;
  await chrome.storage.local.set({ pinOwner });
}
// Native pinned tabs belong to whichever space is "pin owner" in the window.
async function snapshotPins(spaces, win) {
  const owner = await ownerFor(win, spaces);
  const s = spaces.find((x) => x.id === owner);
  if (!s) return;
  const pinned = (await chrome.tabs.query({ windowId: win, pinned: true })).sort((a, b) => a.index - b.index);
  const prev = new Map((s.pins || []).map((x) => [x.url, x]));
  s.pins = pinned.map((t) => {
    const url = t.url || t.pendingUrl || '';
    const old = prev.get(url);
    const title = t.title && t.title !== url ? t.title : old?.title || t.title || '';
    return { url, title, favIconUrl: t.favIconUrl || old?.favIconUrl || '' };
  });
}
// Make the window's pinned tabs match the target space's pins. Pins that already match by URL
// are kept as-is (never closed and reopened); only the differences are closed / created.
async function swapPins(target, win) {
  const want = (target.pins || []).filter((p) => p.url);
  const cur = await chrome.tabs.query({ windowId: win, pinned: true });
  const used = new Set();
  const toClose = [];
  for (const t of cur) {
    const url = t.url || t.pendingUrl || '';
    const i = want.findIndex((p, idx) => !used.has(idx) && p.url === url);
    if (i >= 0) used.add(i);
    else toClose.push(t.id);
  }
  // Create the new pins first so the window can never be left without a tab, then close the old ones.
  for (let i = 0; i < want.length; i++) {
    if (used.has(i)) continue;
    try {
      const t = await chrome.tabs.create({ windowId: win, url: want[i].url, pinned: true, active: false });
      chrome.tabs.discard(t.id).catch(() => {});
    } catch (e) {
      console.warn('Spaces: could not restore pinned tab', want[i].url, e);
    }
  }
  if (toClose.length) await chrome.tabs.remove(toClose).catch(() => {});
}

let snapTimer;
function scheduleSnapshot() {
  clearTimeout(snapTimer);
  snapTimer = setTimeout(
    () =>
      enqueue(async () => {
        const { spaces } = await getState();
        if (!spaces.length) return;
        for (const w of await normalWindows()) await snapshotWindow(spaces, w.id);
        await chrome.storage.local.set({ spaces });
      }),
    1000
  );
}

// ---------- core operations ----------
async function restoreSpace(space, win) {
  const saved = space.tabs?.length ? space.tabs : [{ url: '' }];
  const ai = Math.min(Math.max(space.activeIdx || 0, 0), saved.length - 1);
  const made = [];
  for (let i = 0; i < saved.length; i++) {
    try {
      const t = await chrome.tabs.create({
        windowId: win,
        url: saved[i].url || undefined,
        active: false,
      });
      made.push({ id: t.id, i });
    } catch {
      /* some internal URLs can't be opened by extensions – skip */
    }
  }
  if (!made.length) {
    const t = await chrome.tabs.create({ windowId: win, active: false });
    made.push({ id: t.id, i: 0 });
  }
  const gid = await chrome.tabs.group({
    tabIds: made.map((x) => x.id),
    createProperties: { windowId: win },
  });
  await chrome.tabGroups.update(gid, { title: label(space), color: space.color, collapsed: false });
  await setGroupMapping(win, space.id, gid);
  const keep = made.find((x) => x.i === ai) || made[0];
  // Don't keep every restored tab loaded in memory
  for (const x of made) if (x.id !== keep.id && saved[x.i]?.url) chrome.tabs.discard(x.id).catch(() => {});
  return keep.id;
}

async function switchSpace(spaceId, win, preferTabId) {
  win = win ?? (await mainWindowId());
  const { spaces, settings } = await getState();
  const target = spaces.find((s) => s.id === spaceId);
  if (!target) return;

  await snapshotWindow(spaces, win);
  const prevOwner = await ownerFor(win, spaces);

  // 1. bring the target up first so the window never ends up with no visible tab
  let activeTabId;
  const g = await findGroup(target, win);
  const tabs = g ? (await chrome.tabs.query({ groupId: g.id })).sort((a, b) => a.index - b.index) : [];
  if (g && tabs.length) {
    await chrome.tabGroups.update(g.id, { collapsed: false });
    const pick =
      tabs.find((t) => t.id === preferTabId) ||
      tabs[Math.min(target.activeIdx || 0, tabs.length - 1)] ||
      tabs[0];
    activeTabId = pick.id;
  } else {
    activeTabId = await restoreSpace(target, win);
  }
  await chrome.tabs.update(activeTabId, { active: true });

  // 1b. swap pinned tabs to the target space's pins
  if (prevOwner !== spaceId) {
    if (!prevOwner && !(target.pins || []).length) {
      // pins have no recorded owner yet: adopt the current ones instead of closing them
      target.pins = (await chrome.tabs.query({ windowId: win, pinned: true }))
        .sort((a, b) => a.index - b.index)
        .map((t) => ({ url: t.url || t.pendingUrl || '', title: t.title || '', favIconUrl: t.favIconUrl || '' }));
    } else {
      await swapPins(target, win);
    }
  }
  await setPinOwner(win, spaceId);

  // 2. park the others
  for (const s of spaces) {
    if (s.id === spaceId) continue;
    const og = await findGroup(s, win);
    if (!og) continue;
    if (settings.suspend) {
      const ts = await chrome.tabs.query({ groupId: og.id });
      expectedRemovals.add(og.id);
      await chrome.tabs.remove(ts.map((t) => t.id));
    } else {
      await chrome.tabGroups.update(og.id, { collapsed: true });
    }
  }

  const sess = await getSession();
  sess.active[win] = spaceId;
  await chrome.storage.session.set({ active: sess.active });
  await chrome.storage.local.set({ spaces });
}

async function createSpace({ name, emoji, color, folderId }) {
  const st = await getState();
  const win = await mainWindowId();
  emoji = (emoji || '').trim() || '📁';
  const base = (name || '').trim() || 'Space';
  let finalName = base;
  let n = 2;
  while (st.spaces.some((s) => label(s) === `${emoji} ${finalName}`)) finalName = `${base} ${n++}`;
  const space = { id: crypto.randomUUID(), name: finalName, emoji, color: color || 'blue', tabs: [], activeIdx: 0 };
  if (folderId && st.folders.some((f) => f.id === folderId)) space.folderId = folderId;

  // First space ever: adopt the window's current loose (unpinned, ungrouped) tabs
  if (st.spaces.length === 0) {
    const loose = await chrome.tabs.query({ windowId: win, pinned: false, groupId: NONE });
    if (loose.length) {
      const gid = await chrome.tabs.group({
        tabIds: loose.map((t) => t.id),
        createProperties: { windowId: win },
      });
      await chrome.tabGroups.update(gid, { title: label(space), color: space.color, collapsed: false });
      await setGroupMapping(win, space.id, gid);
    }
    await setPinOwner(win, space.id);
  }
  st.spaces.push(space);
  await chrome.storage.local.set({ spaces: st.spaces });
  await switchSpace(space.id, win);
}

async function updateSpace(id, patch) {
  const st = await getState();
  const space = st.spaces.find((s) => s.id === id);
  if (!space) return;
  // find groups using the OLD label before changing anything
  const found = [];
  for (const w of await normalWindows()) {
    const g = await findGroup(space, w.id);
    if (g) found.push(g);
  }
  if (patch.name !== undefined) space.name = (patch.name || '').trim() || space.name;
  if (patch.emoji !== undefined) space.emoji = (patch.emoji || '').trim() || '📁';
  if (patch.color) space.color = patch.color;
  if (patch.folderId !== undefined) {
    if (patch.folderId && st.folders.some((f) => f.id === patch.folderId)) space.folderId = patch.folderId;
    else delete space.folderId;
  }
  for (const g of found) await chrome.tabGroups.update(g.id, { title: label(space), color: space.color });
  await chrome.storage.local.set({ spaces: st.spaces });
}

async function deleteSpace(id, closeTabs) {
  const st = await getState();
  const space = st.spaces.find((s) => s.id === id);
  if (!space) return;
  for (const w of await normalWindows()) {
    const g = await findGroup(space, w.id);
    if (!g) continue;
    const ts = await chrome.tabs.query({ groupId: g.id });
    const ids = ts.map((t) => t.id);
    if (!ids.length) continue;
    if (closeTabs) {
      expectedRemovals.add(g.id);
      // keep the window alive if this would close its last tab
      const all = await chrome.tabs.query({ windowId: w.id });
      if (all.length === ids.length) await chrome.tabs.create({ windowId: w.id, active: true });
      await chrome.tabs.remove(ids);
    } else {
      expectedRemovals.add(g.id);
      await chrome.tabs.ungroup(ids);
    }
  }
  const sess = await getSession();
  for (const w of Object.keys(sess.groups)) delete sess.groups[w][id];
  for (const w of Object.keys(sess.active)) if (sess.active[w] === id) delete sess.active[w];
  await chrome.storage.session.set(sess);
  const { pinOwner = {} } = await chrome.storage.local.get('pinOwner');
  for (const w of Object.keys(pinOwner)) if (pinOwner[w] === id) delete pinOwner[w];
  await chrome.storage.local.set({ pinOwner });
  await chrome.storage.local.set({ spaces: st.spaces.filter((s) => s.id !== id) });
}

async function moveTab(tabId, spaceId) {
  const tab = await chrome.tabs.get(tabId);
  const win = tab.windowId;
  const { spaces } = await getState();
  const space = spaces.find((s) => s.id === spaceId);
  if (!space) return;
  if (tab.pinned) await chrome.tabs.update(tabId, { pinned: false });
  const g = await findGroup(space, win);
  if (g) {
    await chrome.tabs.group({ tabIds: [tabId], groupId: g.id });
  } else {
    const gid = await chrome.tabs.group({ tabIds: [tabId], createProperties: { windowId: win } });
    await chrome.tabGroups.update(gid, { title: label(space), color: space.color });
    await setGroupMapping(win, space.id, gid);
  }
  await switchSpace(spaceId, win, tabId);
}

async function moveCurrent(spaceId) {
  const win = await mainWindowId();
  const [t] = await chrome.tabs.query({ active: true, windowId: win });
  if (t) await moveTab(t.id, spaceId);
}

async function cycle(dir) {
  const win = await mainWindowId();
  const st = await getState();
  const spaces = orderedSpaces(st.spaces, st.folders);
  if (spaces.length < 2) return;
  const cur = await currentSpaceId(win, spaces);
  const i = spaces.findIndex((s) => s.id === cur);
  const next = spaces[(i + dir + spaces.length) % spaces.length];
  await switchSpace(next.id, win);
}

// ---------- view for the popup ----------
async function getView() {
  const win = await mainWindowId();
  const { spaces, folders, settings } = await getState();
  const cur = await currentSpaceId(win, spaces);
  const owner = await ownerFor(win, spaces);
  const out = [];
  for (const s of spaces) {
    const g = await findGroup(s, win);
    let tabs = null;
    let open = false;
    if (g) {
      const ts = (await chrome.tabs.query({ groupId: g.id })).sort((a, b) => a.index - b.index);
      if (ts.length) {
        open = true;
        tabs = ts.map((t) => ({ id: t.id, title: t.title, url: t.url, favIconUrl: t.favIconUrl, active: t.active }));
      }
    }
    if (!tabs) tabs = (s.tabs || []).map((t) => ({ ...t }));
    const pins =
      s.id === owner
        ? (await chrome.tabs.query({ windowId: win, pinned: true }))
            .sort((a, b) => a.index - b.index)
            .map((t) => ({ id: t.id, title: t.title, url: t.url, favIconUrl: t.favIconUrl, active: t.active }))
        : (s.pins || []).map((p) => ({ ...p }));
    out.push({ id: s.id, name: s.name, emoji: s.emoji, color: s.color, open, tabs, pins, current: s.id === cur, folderId: s.folderId || null });
  }
  return { spaces: out, folders, settings };
}

// ---------- messaging ----------
const handlers = {
  getView: () => enqueue(getView),
  switch: ({ id }) => enqueue(() => switchSpace(id)),
  create: ({ space }) => enqueue(() => createSpace(space)),
  update: ({ id, patch }) => enqueue(() => updateSpace(id, patch)),
  delete: ({ id, closeTabs }) => enqueue(() => deleteSpace(id, closeTabs)),
  moveCurrent: ({ id }) => enqueue(() => moveCurrent(id)),
  createFolder: ({ name }) =>
    enqueue(async () => {
      const st = await getState();
      st.folders.push({ id: crypto.randomUUID(), name: (name || '').trim() || 'Folder', collapsed: false });
      await chrome.storage.local.set({ folders: st.folders });
    }),
  updateFolder: ({ id, patch }) =>
    enqueue(async () => {
      const st = await getState();
      const f = st.folders.find((x) => x.id === id);
      if (!f) return;
      if (patch.name !== undefined) f.name = (patch.name || '').trim() || f.name;
      if (patch.collapsed !== undefined) f.collapsed = !!patch.collapsed;
      await chrome.storage.local.set({ folders: st.folders });
    }),
  // Deleting a folder keeps its spaces; they move back to the top level.
  deleteFolder: ({ id }) =>
    enqueue(async () => {
      const st = await getState();
      for (const s of st.spaces) if (s.folderId === id) delete s.folderId;
      await chrome.storage.local.set({ spaces: st.spaces, folders: st.folders.filter((f) => f.id !== id) });
    }),
  cycle: ({ dir }) => enqueue(() => cycle(dir === -1 ? -1 : 1)),
  togglePin: ({ tabId }) =>
    enqueue(async () => {
      const t = await chrome.tabs.get(tabId);
      if (t.pinned) {
        await chrome.tabs.update(tabId, { pinned: false });
        const { spaces } = await getState();
        const ownerId = await ownerFor(t.windowId, spaces);
        const sp = spaces.find((s) => s.id === ownerId);
        const g = sp && (await findGroup(sp, t.windowId));
        if (g) await chrome.tabs.group({ tabIds: [tabId], groupId: g.id });
      } else {
        await chrome.tabs.update(tabId, { pinned: true });
      }
      scheduleSnapshot();
    }),
  focusTab: ({ tabId }) => chrome.tabs.update(tabId, { active: true }),
  closeTab: ({ tabId }) => chrome.tabs.remove(tabId),
  setSettings: ({ suspend }) =>
    enqueue(async () => {
      const st = await getState();
      await chrome.storage.local.set({ settings: { ...st.settings, suspend: !!suspend } });
    }),
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const h = handlers[msg?.type];
  if (!h) return;
  Promise.resolve(h(msg)).then(
    (data) => sendResponse({ ok: true, data }),
    (e) => sendResponse({ ok: false, error: String(e?.message || e) })
  );
  return true;
});

// Window ids are not stable across browser restarts
chrome.runtime.onStartup.addListener(() => chrome.storage.local.remove('pinOwner'));

// ---------- shortcuts ----------
chrome.commands.onCommand.addListener((cmd) => {
  if (cmd === 'next-space') enqueue(() => cycle(1));
  if (cmd === 'prev-space') enqueue(() => cycle(-1));
});

// ---------- context menu: "Move tab to space" ----------
let menuSig = null;
async function rebuildMenu() {
  const { spaces } = await getState();
  const sig = spaces.map((s) => s.id + label(s)).join('|');
  if (sig === menuSig) return;
  menuSig = sig;
  await chrome.contextMenus.removeAll();
  if (!spaces.length) return;
  chrome.contextMenus.create({ id: 'move-root', title: 'Move tab to space', contexts: ['page'] });
  for (const s of spaces) {
    chrome.contextMenus.create({ id: 'move:' + s.id, parentId: 'move-root', title: label(s), contexts: ['page'] });
  }
}
chrome.contextMenus.onClicked.addListener((info, tab) => {
  const id = String(info.menuItemId);
  if (id.startsWith('move:') && tab) enqueue(() => moveTab(tab.id, id.slice(5)));
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.spaces) enqueue(rebuildMenu);
});
chrome.runtime.onInstalled.addListener(() => enqueue(rebuildMenu));
enqueue(rebuildMenu);

// ---------- keep saved state fresh ----------
[
  chrome.tabs.onCreated,
  chrome.tabs.onUpdated,
  chrome.tabs.onRemoved,
  chrome.tabs.onMoved,
  chrome.tabs.onAttached,
  chrome.tabs.onDetached,
  chrome.tabs.onActivated,
  chrome.tabGroups.onUpdated,
  chrome.tabGroups.onMoved,
].forEach((ev) => ev.addListener(scheduleSnapshot));

// If the user empties a space's group themselves, forget its saved tabs
chrome.tabGroups.onRemoved.addListener((group) => {
  if (expectedRemovals.delete(group.id)) return;
  const win = group.windowId;
  setTimeout(
    () =>
      enqueue(async () => {
        try {
          await chrome.windows.get(win); // window closed → keep saved tabs
        } catch {
          return;
        }
        const sess = await getSession();
        const m = sess.groups[win] || {};
        const sid = Object.keys(m).find((k) => m[k] === group.id);
        if (!sid) return;
        delete m[sid];
        await chrome.storage.session.set({ groups: sess.groups });
        const st = await getState();
        const s = st.spaces.find((x) => x.id === sid);
        if (s) {
          s.tabs = [];
          s.activeIdx = 0;
          await chrome.storage.local.set({ spaces: st.spaces });
        }
      }),
    1500
  );
});
