// Spaces – background service worker
// Model: a space is a tab group titled "<emoji> <name>". A folder inside a space is another tab
// group titled "<emoji> <name> › <folder>", so folders show up natively (and collapsible) in the
// browser's tab strip / vertical sidebar. Inactive spaces have all their groups collapsed.
// Existing tab groups are auto-detected as spaces. Native pinned tabs are swapped per space.

const NONE = -1; // chrome.tabGroups.TAB_GROUP_ID_NONE
const SEP = ' › ';
const label = (s) => s.rawTitle || `${s.emoji || '📁'} ${s.name}`;
const folderTitle = (s, f) => `${label(s)}${SEP}${f.name}`;
const COLORS = {
  grey: '#5f6368', blue: '#1a73e8', red: '#d93025', yellow: '#f9ab00', green: '#188038',
  pink: '#d01884', purple: '#9334e6', cyan: '#007b83', orange: '#e8710a',
};

// ---------- serialisation ----------
let queue = Promise.resolve();
const enqueue = (fn) => {
  const run = queue.then(fn);
  queue = run.catch(() => {});
  return run;
};

// ---------- storage helpers ----------
async function getState() {
  const s = await chrome.storage.local.get(['spaces']);
  return { spaces: s.spaces || [] };
}
async function getSession() {
  const { groups = {}, active = {} } = await chrome.storage.session.get(['groups', 'active']);
  return { groups, active };
}
// key = spaceId for a space's main group, "spaceId:folderId" for a folder group
async function setGroupMapping(win, key, groupId) {
  const { groups } = await getSession();
  groups[win] = groups[win] || {};
  groups[win][key] = groupId;
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
async function findGroupKey(key, title, win) {
  const { groups } = await getSession();
  const gid = groups[win]?.[key];
  if (gid != null) {
    try {
      const g = await chrome.tabGroups.get(gid);
      if (g.windowId === win) return g;
    } catch {}
  }
  // Adopt a group by title (handles browser session restore, where ids change)
  const all = await chrome.tabGroups.query({ windowId: win });
  const g = all.find((x) => x.title === title);
  if (g) {
    await setGroupMapping(win, key, g.id);
    return g;
  }
  return null;
}
const findGroup = (space, win) => findGroupKey(space.id, label(space), win);
const findFolderGroup = (space, f, win) => findGroupKey(`${space.id}:${f.id}`, folderTitle(space, f), win);

// All live groups of a space in a window: main group first, then folder groups.
async function spaceGroups(space, win) {
  const out = [];
  const m = await findGroup(space, win);
  if (m) out.push({ folderId: null, group: m });
  for (const f of space.folders || []) {
    const g = await findFolderGroup(space, f, win);
    if (g) out.push({ folderId: f.id, group: g });
  }
  return out;
}
async function spaceTabs(space, win) {
  const out = [];
  for (const { folderId, group } of await spaceGroups(space, win)) {
    const ts = (await chrome.tabs.query({ groupId: group.id })).sort((a, b) => a.index - b.index);
    for (const t of ts) out.push({ tab: t, folderId });
  }
  return out;
}

// Which space (and folder) does a group belong to?
async function spaceInfoForGroup(groupId, win, spaces) {
  if (groupId == null || groupId < 0) return null;
  const { groups } = await getSession();
  for (const [key, gid] of Object.entries(groups[win] || {})) {
    if (gid === groupId && spaces.some((s) => s.id === key.split(':')[0])) {
      const [spaceId, folderId = null] = key.split(':');
      return { spaceId, folderId };
    }
  }
  let g;
  try {
    g = await chrome.tabGroups.get(groupId);
  } catch {
    return null;
  }
  const title = g.title || '';
  for (const s of spaces) {
    if (label(s) === title) {
      await setGroupMapping(win, s.id, groupId);
      return { spaceId: s.id, folderId: null };
    }
    for (const f of s.folders || []) {
      if (folderTitle(s, f) === title) {
        await setGroupMapping(win, `${s.id}:${f.id}`, groupId);
        return { spaceId: s.id, folderId: f.id };
      }
    }
  }
  return null;
}
async function spaceForGroup(groupId, win, spaces) {
  return (await spaceInfoForGroup(groupId, win, spaces))?.spaceId ?? null;
}

async function currentSpaceId(win, spaces) {
  const [t] = await chrome.tabs.query({ active: true, windowId: win });
  const fromTab = t ? await spaceForGroup(t.groupId, win, spaces) : null;
  if (fromTab) return fromTab;
  const { active } = await getSession();
  return spaces.some((s) => s.id === active[win]) ? active[win] : null;
}

// ---------- auto-detect spaces from existing tab groups ----------
const EMOJI_RE = /^(\p{Extended_Pictographic}[️‍\p{Extended_Pictographic}]*)\s*(.*)$/u;
async function adoptGroups() {
  const st = await getState();
  let changed = false;
  for (const w of await normalWindows()) {
    const groups = await chrome.tabGroups.query({ windowId: w.id });
    for (const g of groups) {
      const title = (g.title || '').trim();
      if (!title) continue; // untitled groups are adopted once they get a name
      if (await spaceInfoForGroup(g.id, w.id, st.spaces)) continue;
      // "<space title> › <folder>" under a known space → a folder of that space
      const parent = st.spaces.find((s) => title.startsWith(label(s) + SEP));
      if (parent) {
        const name = title.slice(label(parent).length + SEP.length).trim();
        if (name) {
          const f = { id: crypto.randomUUID(), name, collapsed: !!g.collapsed };
          parent.folders = [...(parent.folders || []), f];
          await setGroupMapping(w.id, `${parent.id}:${f.id}`, g.id);
          changed = true;
          continue;
        }
      }
      const m = title.match(EMOJI_RE);
      const space = {
        id: crypto.randomUUID(),
        emoji: m ? m[1] : '📁',
        name: (m ? m[2] : title) || title,
        color: g.color || 'blue',
        rawTitle: g.title, // keep the group's title exactly as the user wrote it
        tabs: [],
        folders: [],
        activeIdx: 0,
      };
      st.spaces.push(space);
      await setGroupMapping(w.id, space.id, g.id);
      changed = true;
    }
  }
  if (changed) await chrome.storage.local.set({ spaces: st.spaces });
  return changed;
}
let adoptTimer;
const scheduleAdopt = () => {
  clearTimeout(adoptTimer);
  adoptTimer = setTimeout(() => enqueue(adoptGroups).catch(() => {}), 800);
};

// ---------- snapshotting (keeps saved tabs fresh for restarts) ----------
async function snapshotWindow(spaces, win) {
  for (const s of spaces) {
    const items = await spaceTabs(s, win);
    if (!items.length) continue;
    const prev = new Map((s.tabs || []).map((x) => [x.url, x]));
    s.tabs = items.map(({ tab: t, folderId }) => {
      const url = t.url || t.pendingUrl || '';
      const old = prev.get(url);
      const title = t.title && t.title !== url ? t.title : old?.title || t.title || '';
      return { url, title, favIconUrl: t.favIconUrl || old?.favIconUrl || '', ...(folderId ? { folderId } : {}) };
    });
    const ai = items.findIndex((x) => x.tab.active);
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
// While we are rewriting the pinned tabs, don't mistake our own churn for the user's changes.
let pinsLockUntil = 0;
const lockPins = (ms = 2500) => (pinsLockUntil = Date.now() + ms);
// Native pinned tabs belong to whichever space is "pin owner" in the window.
async function snapshotPins(spaces, win) {
  if (Date.now() < pinsLockUntil) return;
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
  lockPins(60000);
  try {
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
        await chrome.tabs.create({ windowId: win, url: want[i].url, pinned: true, active: false });
      } catch (e) {
        console.warn('Spaces: could not restore pinned tab', want[i].url, e);
      }
    }
    if (toClose.length) await chrome.tabs.remove(toClose).catch(() => {});
  } finally {
    lockPins();
  }
}

let snapTimer;
function scheduleSnapshot() {
  clearTimeout(snapTimer);
  const wait = Math.max(1000, pinsLockUntil - Date.now() + 200);
  snapTimer = setTimeout(
    () =>
      enqueue(async () => {
        const { spaces } = await getState();
        if (!spaces.length) return;
        for (const w of await normalWindows()) await snapshotWindow(spaces, w.id);
        await chrome.storage.local.set({ spaces });
      }),
    wait
  );
}

// ---------- toolbar icon follows the active space ----------
function drawIcon(size, emoji, color) {
  const c = new OffscreenCanvas(size, size);
  const x = c.getContext('2d');
  x.fillStyle = color;
  x.beginPath();
  x.roundRect(0, 0, size, size, size * 0.22);
  x.fill();
  x.font = `${Math.round(size * 0.68)}px sans-serif`;
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText(emoji, size / 2, size / 2 + size * 0.06);
  return x.getImageData(0, 0, size, size);
}
async function updateIcon() {
  try {
    const win = await mainWindowId();
    const { spaces } = await getState();
    const cur = await currentSpaceId(win, spaces);
    const s = spaces.find((x) => x.id === cur);
    if (!s) {
      await chrome.action.setIcon({ path: { 16: 'icons/16.png', 32: 'icons/32.png', 48: 'icons/48.png' } });
      await chrome.action.setTitle({ title: 'Spaces' });
      return;
    }
    const col = COLORS[s.color] || '#5f6368';
    await chrome.action.setIcon({
      imageData: { 16: drawIcon(16, s.emoji || '📁', col), 32: drawIcon(32, s.emoji || '📁', col), 48: drawIcon(48, s.emoji || '📁', col) },
    });
    await chrome.action.setTitle({ title: `Spaces — ${s.name}` });
  } catch (e) {
    console.warn('Spaces: icon update failed', e);
  }
}
let iconTimer;
const scheduleIcon = () => {
  clearTimeout(iconTimer);
  iconTimer = setTimeout(updateIcon, 150);
};

// ---------- core operations ----------
async function restoreSpace(space, win) {
  const saved = space.tabs?.length ? space.tabs : [{ url: '' }];
  const ai = Math.min(Math.max(space.activeIdx || 0, 0), saved.length - 1);
  const known = new Set((space.folders || []).map((f) => f.id));
  const made = [];
  for (let i = 0; i < saved.length; i++) {
    try {
      const t = await chrome.tabs.create({ windowId: win, url: saved[i].url || undefined, active: false });
      made.push({ id: t.id, i, folderId: known.has(saved[i].folderId) ? saved[i].folderId : null });
    } catch {
      /* some internal URLs can't be opened by extensions – skip */
    }
  }
  if (!made.length) {
    const t = await chrome.tabs.create({ windowId: win, active: false });
    made.push({ id: t.id, i: 0, folderId: null });
  }
  const keep = made.find((x) => x.i === ai) || made[0];
  // main group first so it sits before the folder groups
  const buckets = [[null, made.filter((x) => !x.folderId)]];
  for (const f of space.folders || []) buckets.push([f.id, made.filter((x) => x.folderId === f.id)]);
  for (const [folderId, items] of buckets) {
    if (!items.length) continue;
    const gid = await chrome.tabs.group({ tabIds: items.map((x) => x.id), createProperties: { windowId: win } });
    if (folderId) {
      const f = space.folders.find((x) => x.id === folderId);
      await chrome.tabGroups.update(gid, {
        title: folderTitle(space, f), color: space.color, collapsed: !!f.collapsed && !items.some((x) => x.id === keep.id),
      });
      await setGroupMapping(win, `${space.id}:${folderId}`, gid);
    } else {
      await chrome.tabGroups.update(gid, { title: label(space), color: space.color, collapsed: false });
      await setGroupMapping(win, space.id, gid);
    }
  }
  // Don't keep every restored tab loaded in memory
  for (const x of made) if (x.id !== keep.id && saved[x.i]?.url) chrome.tabs.discard(x.id).catch(() => {});
  return keep.id;
}

async function switchSpace(spaceId, win, preferTabId) {
  win = win ?? (await mainWindowId());
  const { spaces } = await getState();
  const target = spaces.find((s) => s.id === spaceId);
  if (!target) return;

  await snapshotWindow(spaces, win);
  const prevOwner = await ownerFor(win, spaces);

  // 1. bring the target up first so the window never ends up with no visible tab
  let activeTabId;
  const items = await spaceTabs(target, win);
  if (items.length) {
    const pick =
      items.find((x) => x.tab.id === preferTabId) ||
      items[Math.min(target.activeIdx || 0, items.length - 1)] ||
      items[0];
    for (const { folderId, group } of await spaceGroups(target, win)) {
      const f = (target.folders || []).find((x) => x.id === folderId);
      const hasPick = pick.folderId === folderId;
      await chrome.tabGroups.update(group.id, { collapsed: folderId ? !!f?.collapsed && !hasPick : false });
    }
    activeTabId = pick.tab.id;
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

  // 2. collapse every group of the other spaces
  for (const s of spaces) {
    if (s.id === spaceId) continue;
    for (const { group } of await spaceGroups(s, win)) await chrome.tabGroups.update(group.id, { collapsed: true });
  }

  const sess = await getSession();
  sess.active[win] = spaceId;
  await chrome.storage.session.set({ active: sess.active });
  await chrome.storage.local.set({ spaces });
  scheduleIcon();
}

async function createSpace({ name, emoji, color }) {
  const st = await getState();
  const win = await mainWindowId();
  emoji = (emoji || '').trim() || '📁';
  const base = (name || '').trim() || 'Space';
  let finalName = base;
  let n = 2;
  while (st.spaces.some((s) => label(s) === `${emoji} ${finalName}`)) finalName = `${base} ${n++}`;
  const space = { id: crypto.randomUUID(), name: finalName, emoji, color: color || 'blue', tabs: [], folders: [], activeIdx: 0 };

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

async function retitle(space, found) {
  for (const { group, folderId } of found) {
    const f = (space.folders || []).find((x) => x.id === folderId);
    await chrome.tabGroups.update(group.id, {
      title: folderId ? (f ? folderTitle(space, f) : group.title) : label(space),
      color: space.color,
    });
  }
}

async function updateSpace(id, patch) {
  const st = await getState();
  const space = st.spaces.find((s) => s.id === id);
  if (!space) return;
  // find groups using the OLD titles before changing anything
  const found = [];
  for (const w of await normalWindows()) found.push(...(await spaceGroups(space, w.id)));
  if (patch.name !== undefined) space.name = (patch.name || '').trim() || space.name;
  if (patch.emoji !== undefined) space.emoji = (patch.emoji || '').trim() || '📁';
  if (patch.name !== undefined || patch.emoji !== undefined) delete space.rawTitle;
  if (patch.color) space.color = patch.color;
  await retitle(space, found);
  await chrome.storage.local.set({ spaces: st.spaces });
  scheduleIcon();
}

async function deleteSpace(id, closeTabs) {
  const st = await getState();
  const space = st.spaces.find((s) => s.id === id);
  if (!space) return;
  for (const w of await normalWindows()) {
    const ids = (await spaceTabs(space, w.id)).map((x) => x.tab.id);
    for (const { group } of await spaceGroups(space, w.id)) expectedRemovals.add(group.id);
    if (!ids.length) continue;
    if (closeTabs) {
      // keep the window alive if this would close its last tab
      const all = await chrome.tabs.query({ windowId: w.id });
      if (all.length === ids.length) await chrome.tabs.create({ windowId: w.id, active: true });
      await chrome.tabs.remove(ids);
    } else {
      await chrome.tabs.ungroup(ids);
    }
  }
  const sess = await getSession();
  for (const w of Object.keys(sess.groups))
    for (const k of Object.keys(sess.groups[w])) if (k.split(':')[0] === id) delete sess.groups[w][k];
  for (const w of Object.keys(sess.active)) if (sess.active[w] === id) delete sess.active[w];
  await chrome.storage.session.set(sess);
  const { pinOwner = {} } = await chrome.storage.local.get('pinOwner');
  for (const w of Object.keys(pinOwner)) if (pinOwner[w] === id) delete pinOwner[w];
  await chrome.storage.local.set({ pinOwner });
  await chrome.storage.local.set({ spaces: st.spaces.filter((s) => s.id !== id) });
  scheduleIcon();
}

// Put a tab into a space's main group (folderId null) or one of its folder groups.
async function putTab(tabId, space, folderId, win) {
  let g;
  let key;
  let title;
  if (folderId) {
    const f = (space.folders || []).find((x) => x.id === folderId);
    if (!f) return putTab(tabId, space, null, win);
    g = await findFolderGroup(space, f, win);
    key = `${space.id}:${f.id}`;
    title = folderTitle(space, f);
  } else {
    g = await findGroup(space, win);
    key = space.id;
    title = label(space);
  }
  if (g) {
    await chrome.tabs.group({ tabIds: [tabId], groupId: g.id });
    if (g.collapsed) await chrome.tabGroups.update(g.id, { collapsed: false });
  } else {
    const gid = await chrome.tabs.group({ tabIds: [tabId], createProperties: { windowId: win } });
    await chrome.tabGroups.update(gid, { title, color: space.color, collapsed: false });
    await setGroupMapping(win, key, gid);
  }
}

async function moveTab(tabId, spaceId) {
  const tab = await chrome.tabs.get(tabId);
  const win = tab.windowId;
  const { spaces } = await getState();
  const space = spaces.find((s) => s.id === spaceId);
  if (!space) return;
  if (tab.pinned) await chrome.tabs.update(tabId, { pinned: false });
  await putTab(tabId, space, null, win);
  await switchSpace(spaceId, win, tabId);
}

async function moveCurrent(spaceId) {
  const win = await mainWindowId();
  const [t] = await chrome.tabs.query({ active: true, windowId: win });
  if (t) await moveTab(t.id, spaceId);
}

async function cycle(dir) {
  const win = await mainWindowId();
  const { spaces } = await getState();
  if (spaces.length < 2) return;
  const cur = await currentSpaceId(win, spaces);
  const i = spaces.findIndex((s) => s.id === cur);
  const next = spaces[(i + dir + spaces.length) % spaces.length];
  await switchSpace(next.id, win);
}

// ---------- view for the popup ----------
async function getView() {
  const win = await mainWindowId();
  const { spaces } = await getState();
  const cur = await currentSpaceId(win, spaces);
  const owner = await ownerFor(win, spaces);
  const out = [];
  const info = (t) => ({ id: t.id, title: t.title, url: t.url, favIconUrl: t.favIconUrl, active: t.active });
  for (const s of spaces) {
    const items = await spaceTabs(s, win);
    const open = items.length > 0;
    const tabs = open
      ? items.map(({ tab, folderId }) => ({ ...info(tab), folderId }))
      : (s.tabs || []).map((t) => ({ ...t }));
    const pins =
      s.id === owner
        ? (await chrome.tabs.query({ windowId: win, pinned: true })).sort((a, b) => a.index - b.index).map(info)
        : (s.pins || []).map((p) => ({ ...p }));
    out.push({ id: s.id, name: s.name, emoji: s.emoji, color: s.color, open, tabs, pins, current: s.id === cur, folders: s.folders || [] });
  }
  return { spaces: out };
}

// ---------- folders (inside a space; each is a tab group) ----------
async function foldersOp(spaceId, fn) {
  const st = await getState();
  const sp = st.spaces.find((x) => x.id === spaceId);
  if (!sp) return;
  await fn(sp, st);
  await chrome.storage.local.set({ spaces: st.spaces });
}

// ---------- messaging ----------
const handlers = {
  getView: () => enqueue(getView),
  switch: ({ id }) => enqueue(() => switchSpace(id)),
  create: ({ space }) => enqueue(() => createSpace(space)),
  update: ({ id, patch }) => enqueue(() => updateSpace(id, patch)),
  delete: ({ id, closeTabs }) => enqueue(() => deleteSpace(id, closeTabs)),
  moveCurrent: ({ id }) => enqueue(() => moveCurrent(id)),
  createFolder: ({ spaceId, name }) =>
    enqueue(() =>
      foldersOp(spaceId, (sp) => {
        sp.folders = [...(sp.folders || []), { id: crypto.randomUUID(), name: (name || '').trim() || 'Folder', collapsed: false }];
      })
    ),
  updateFolder: ({ spaceId, id, patch }) =>
    enqueue(() =>
      foldersOp(spaceId, async (sp) => {
        const f = (sp.folders || []).find((x) => x.id === id);
        if (!f) return;
        const found = [];
        for (const w of await normalWindows()) found.push(...(await spaceGroups(sp, w.id)));
        if (patch.name !== undefined) f.name = (patch.name || '').trim() || f.name;
        if (patch.collapsed !== undefined) f.collapsed = !!patch.collapsed;
        await retitle(sp, found);
        if (patch.collapsed !== undefined)
          for (const x of found) if (x.folderId === id) await chrome.tabGroups.update(x.group.id, { collapsed: f.collapsed });
      })
    ),
  // Deleting a folder keeps its tabs; they go back to the space's main group.
  deleteFolder: ({ spaceId, id }) =>
    enqueue(() =>
      foldersOp(spaceId, async (sp) => {
        for (const w of await normalWindows()) {
          const f = (sp.folders || []).find((x) => x.id === id);
          const g = f && (await findFolderGroup(sp, f, w.id));
          if (!g) continue;
          expectedRemovals.add(g.id);
          for (const t of await chrome.tabs.query({ groupId: g.id })) await putTab(t.id, sp, null, w.id);
        }
        sp.folders = (sp.folders || []).filter((f) => f.id !== id);
        for (const t of sp.tabs || []) if (t.folderId === id) delete t.folderId;
      })
    ),
  setTabFolder: ({ tabId, folderId }) =>
    enqueue(async () => {
      const tab = await chrome.tabs.get(tabId);
      const { spaces } = await getState();
      const info = await spaceInfoForGroup(tab.groupId, tab.windowId, spaces);
      const space = spaces.find((s) => s.id === info?.spaceId);
      if (!space) return;
      await putTab(tabId, space, folderId || null, tab.windowId);
      scheduleSnapshot();
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
        if (sp) await putTab(tabId, sp, null, t.windowId);
      } else {
        await chrome.tabs.update(tabId, { pinned: true });
      }
      scheduleSnapshot();
    }),
  focusTab: ({ tabId }) => chrome.tabs.update(tabId, { active: true }),
  closeTab: ({ tabId }) => chrome.tabs.remove(tabId),
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

// ---------- shortcuts ----------
// Window ids are not stable across browser restarts
chrome.runtime.onStartup.addListener(() => chrome.storage.local.remove('pinOwner'));

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
  if (area === 'local' && changes.spaces) {
    enqueue(rebuildMenu);
    scheduleIcon();
  }
});
chrome.runtime.onInstalled.addListener(() => {
  enqueue(rebuildMenu);
  scheduleAdopt();
});
enqueue(rebuildMenu);
scheduleAdopt();
scheduleIcon();

// ---------- clicking a tab in another space's group (e.g. in the vertical sidebar) switches space ----------
chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
  scheduleIcon();
  enqueue(async () => {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab || tab.groupId === NONE || tab.windowId !== windowId) return;
    const { spaces } = await getState();
    const info = await spaceInfoForGroup(tab.groupId, windowId, spaces);
    if (!info) return;
    const { active } = await getSession();
    if (active[windowId] === info.spaceId) return;
    await switchSpace(info.spaceId, windowId, tabId);
  }).catch(() => {});
});
chrome.windows.onFocusChanged.addListener(scheduleIcon);

// ---------- new tabs (Cmd+T, links, etc.) join the active space ----------
chrome.tabs.onCreated.addListener((created) =>
  enqueue(async () => {
    // runs after any switch/restore in progress has finished grouping its own tabs
    let tab;
    try { tab = await chrome.tabs.get(created.id); } catch { return; }
    if (tab.pinned || tab.groupId !== NONE) return;
    const w = await chrome.windows.get(tab.windowId).catch(() => null);
    if (!w || w.type !== 'normal') return;
    const { spaces } = await getState();
    if (!spaces.length) return;
    const cur = await currentSpaceId(tab.windowId, spaces);
    const space = spaces.find((x) => x.id === cur);
    if (!space) return;
    await putTab(tab.id, space, null, tab.windowId);
  }).catch(() => {})
);

// ---------- keep saved state fresh ----------
[
  chrome.tabs.onCreated,
  chrome.tabs.onUpdated,
  chrome.tabs.onRemoved,
  chrome.tabs.onMoved,
  chrome.tabs.onAttached,
  chrome.tabs.onDetached,
  chrome.tabs.onActivated,
  chrome.tabGroups.onMoved,
].forEach((ev) => ev.addListener(scheduleSnapshot));

chrome.tabGroups.onCreated.addListener(scheduleAdopt);
chrome.tabGroups.onUpdated.addListener((group) => {
  scheduleSnapshot();
  scheduleAdopt();
  // keep a folder's saved "collapsed" flag in sync with the group collapsing in the sidebar
  enqueue(async () => {
    const { spaces } = await getState();
    const info = await spaceInfoForGroup(group.id, group.windowId, spaces);
    if (!info?.folderId) return;
    const { active } = await getSession();
    if (active[group.windowId] !== info.spaceId) return; // parked by us, not the user
    const sp = spaces.find((s) => s.id === info.spaceId);
    const f = sp.folders.find((x) => x.id === info.folderId);
    if (f && f.collapsed !== group.collapsed) {
      f.collapsed = group.collapsed;
      await chrome.storage.local.set({ spaces });
    }
  }).catch(() => {});
});

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
        const key = Object.keys(m).find((k) => m[k] === group.id);
        if (!key) return;
        delete m[key];
        await chrome.storage.session.set({ groups: sess.groups });
        if (key.includes(':')) return; // a folder group: its tabs just moved elsewhere
        const st = await getState();
        const s = st.spaces.find((x) => x.id === key);
        if (s && !(await spaceTabs(s, win)).length) {
          s.tabs = [];
          s.activeIdx = 0;
          await chrome.storage.local.set({ spaces: st.spaces });
        }
      }),
    1500
  );
});
