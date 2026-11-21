// Orbit – background service worker
// Model: a space is a tab group titled "<emoji> <name>"; every tab belongs to exactly one space.
// Inactive spaces are collapsed (or, optionally, closed and restored from saved URLs).
// Existing tab groups are auto-detected as spaces. Native pinned tabs are swapped per space.

const NONE = -1; // chrome.tabGroups.TAB_GROUP_ID_NONE
const label = (s) => s.rawTitle || `${s.emoji || '📁'} ${s.name}`;
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
// key = spaceId
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

// The live group of a space in a window (as a list, to keep callers simple).
async function spaceGroups(space, win) {
  const m = await findGroup(space, win);
  return m ? [{ group: m }] : [];
}
async function spaceTabs(space, win) {
  const out = [];
  for (const { group } of await spaceGroups(space, win)) {
    const ts = (await chrome.tabs.query({ groupId: group.id })).sort((a, b) => a.index - b.index);
    for (const t of ts) out.push({ tab: t });
  }
  return out;
}

// Which space does a group belong to?
async function spaceInfoForGroup(groupId, win, spaces) {
  if (groupId == null || groupId < 0) return null;
  const { groups } = await getSession();
  for (const [key, gid] of Object.entries(groups[win] || {})) {
    if (gid === groupId && spaces.some((s) => s.id === key)) return { spaceId: key };
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
      return { spaceId: s.id };
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
// One-time: folders no longer exist; each old folder becomes its own space (same emoji, its tabs and group).
async function migrateFolders(st) {
  let changed = false;
  for (const parent of [...st.spaces]) {
    const folders = parent.folders;
    if (!folders) continue;
    delete parent.folders;
    changed = true;
    for (const f of folders) {
      let name = f.name || 'Folder';
      let n = 2;
      while (st.spaces.some((s) => label(s) === `${parent.emoji} ${name}`)) name = `${f.name} ${n++}`;
      const sp = {
        id: crypto.randomUUID(), name, emoji: parent.emoji || '📁', color: parent.color || 'blue',
        tabs: (parent.tabs || []).filter((t) => t.folderId === f.id).map(({ folderId, ...t }) => t), activeIdx: 0,
      };
      parent.tabs = (parent.tabs || []).filter((t) => t.folderId !== f.id);
      st.spaces.push(sp);
      const { groups } = await getSession();
      for (const w of await normalWindows()) {
        let g = null;
        const gid = groups[w.id]?.[`${parent.id}:${f.id}`];
        if (gid != null) g = await chrome.tabGroups.get(gid).catch(() => null);
        if (!g) g = (await chrome.tabGroups.query({ windowId: w.id })).find((x) => x.title === `${label(parent)} › ${f.name}`);
        if (g) {
          await chrome.tabGroups.update(g.id, { title: label(sp), color: sp.color });
          await setGroupMapping(w.id, sp.id, g.id);
        }
      }
    }
    const sess = await getSession();
    for (const w of Object.keys(sess.groups))
      for (const k of Object.keys(sess.groups[w])) if (k.startsWith(parent.id + ':')) delete sess.groups[w][k];
    await chrome.storage.session.set({ groups: sess.groups });
  }
  for (const s of st.spaces) for (const t of s.tabs || []) delete t.folderId;
  return changed;
}

async function adoptGroups() {
  const st = await getState();
  let changed = await migrateFolders(st);
  for (const w of await normalWindows()) {
    const groups = await chrome.tabGroups.query({ windowId: w.id });
    for (const g of groups) {
      const title = (g.title || '').trim();
      if (!title) continue; // untitled groups are adopted once they get a name
      if (await spaceInfoForGroup(g.id, w.id, st.spaces)) continue;
      const m = title.match(EMOJI_RE);
      const space = {
        id: crypto.randomUUID(),
        emoji: m ? m[1] : '📁',
        name: (m ? m[2] : title) || title,
        color: g.color || 'blue',
        rawTitle: g.title, // keep the group's title exactly as the user wrote it
        tabs: [],
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
// Small rolling log (kept in storage) so problems can be diagnosed: palette → "Copy Orbit diagnostics".
let logChain = Promise.resolve();
const dlog = (msg) => {
  logChain = logChain.then(async () => {
    const { orbitLog = [] } = await chrome.storage.local.get('orbitLog');
    orbitLog.push(`${new Date().toISOString().slice(11, 19)} ${msg}`);
    await chrome.storage.local.set({ orbitLog: orbitLog.slice(-300) });
  }).catch(() => {});
};
// With several windows a space can have a group in more than one; only the biggest one is the source of truth.
async function bestWindows(spaces) {
  const best = new Map();
  for (const w of await normalWindows())
    for (const s of spaces) {
      const n = (await spaceTabs(s, w.id)).length;
      if (n > (best.get(s.id)?.n || 0)) best.set(s.id, { win: w.id, n });
    }
  return best;
}
const isOrbitPage = (u) => /^chrome-extension:\/\/[^/]+\/(palette-tab|newtab|palette)\.html/.test(u || '');
async function snapshotWindow(spaces, win, best) {
  // tabMeta remembers each tab's last known url/title/icon: a sleeping (discarded) or just-restored tab can
  // report an empty url, and we must never save that over the real address.
  const { tabMeta = {} } = await chrome.storage.session.get('tabMeta');
  for (const s of spaces) {
    if (s.parked) continue; // closed on purpose: its saved tabs are the truth until it is restored
    if (best && best.get(s.id)?.win !== win) continue;
    const items = (await spaceTabs(s, win)).filter(({ tab }) => !isOrbitPage(tab.url || tab.pendingUrl));
    if (!items.length) continue;
    const prev = new Map((s.tabs || []).map((x) => [x.url, x]));
    const next = [];
    for (const { tab: t } of items) {
      const m = tabMeta[t.id];
      const url = t.url || t.pendingUrl || m?.url || '';
      if (!url) continue; // nothing known about this tab: don't save a blank entry over real ones
      const old = prev.get(url);
      // keep the last good name/icon: a sleeping or still-loading tab reports an empty title or its bare URL
      const fresh = t.title && t.title !== url && !/^(loading|new tab)/i.test(t.title);
      const title = fresh ? t.title : old?.title || (m?.url === url && m.title) || t.title || '';
      const favIconUrl = t.favIconUrl || old?.favIconUrl || (m?.url === url && m.favIconUrl) || '';
      next.push({ url, title, favIconUrl });
      tabMeta[t.id] = { url, title, favIconUrl };
    }
    if (!next.length) continue;
    if (next.length < (s.tabs || []).length)
      dlog(`snapshot ${s.name}: saved ${(s.tabs || []).length} -> ${next.length} (live ${items.length}, win ${win})`);
    s.tabs = next;
    const ai = items.findIndex((x) => x.tab.active);
    if (ai >= 0) s.activeIdx = Math.min(ai, next.length - 1);
  }
  await chrome.storage.session.set({ tabMeta });
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
        const best = await bestWindows(spaces);
        for (const w of await normalWindows()) await snapshotWindow(spaces, w.id, best);
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
    await chrome.action.setTitle({ title: `Orbit — ${s.name}` });
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
  const made = [];
  for (let i = 0; i < saved.length; i++) {
    try {
      const u = saved[i].url || undefined;
      let t;
      try {
        t = await chrome.tabs.create({ windowId: win, url: u, active: false });
      } catch (e) {
        if (u?.startsWith('brave://')) t = await chrome.tabs.create({ windowId: win, url: u.replace('brave://', 'chrome://'), active: false });
        else if (u?.startsWith('chrome://')) t = await chrome.tabs.create({ windowId: win, url: u.replace('chrome://', 'brave://'), active: false });
        else throw e;
      }
      made.push({ id: t.id, i });
      if (saved[i].url) {
        const { tabMeta = {} } = await chrome.storage.session.get('tabMeta');
        tabMeta[t.id] = { url: saved[i].url, title: saved[i].title || '', favIconUrl: saved[i].favIconUrl || '' };
        await chrome.storage.session.set({ tabMeta });
      }
    } catch {
      /* some internal URLs can't be opened by extensions – skip */
    }
  }
  if (!made.length) {
    const t = await chrome.tabs.create({ windowId: win, active: false });
    made.push({ id: t.id, i: 0 });
  }
  const keep = made.find((x) => x.i === ai) || made[0];
  const gid = await chrome.tabs.group({ tabIds: made.map((x) => x.id), createProperties: { windowId: win } });
  await chrome.tabGroups.update(gid, { title: label(space), color: space.color, collapsed: false });
  await setGroupMapping(win, space.id, gid);
  return keep.id;
}

async function switchSpace(spaceId, win, preferTabId) {
  win = win ?? (await mainWindowId());
  const { spaces } = await getState();
  const target = spaces.find((s) => s.id === spaceId);
  if (!target) return;

  await snapshotWindow(spaces, win, await bestWindows(spaces));
  dlog(`switch -> ${target.name}; saved: ${spaces.map((s) => `${s.name}=${(s.tabs || []).length}${s.parked ? 'P' : ''}`).join(' ')}`);
  // safety copy of everything saved, taken before anything can be closed
  await chrome.storage.local.set({ spaces, spacesBackup: { at: Date.now(), spaces: JSON.parse(JSON.stringify(spaces)) } });
  const prevOwner = await ownerFor(win, spaces);

  // 1. bring the target up first so the window never ends up with no visible tab
  let activeTabId;
  const items = await spaceTabs(target, win);
  if (items.length) {
    const pick =
      items.find((x) => x.tab.id === preferTabId) ||
      items[Math.min(target.activeIdx || 0, items.length - 1)] ||
      items[0];
    for (const { group } of await spaceGroups(target, win)) await chrome.tabGroups.update(group.id, { collapsed: false });
    activeTabId = pick.tab.id;
    target.parked = false;
  } else {
    activeTabId = await restoreSpace(target, win);
    target.parked = false;
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

  // 2. hide the other spaces: their tabs were just saved (and backed up) above, so close them; they are
  //    relaunched from the saved list when you switch back. A space is only closed if it has saved tabs.
  const { tabMeta = {} } = await chrome.storage.session.get('tabMeta');
  for (const s of spaces) {
    if (s.id === spaceId) continue;
    const groups = await spaceGroups(s, win);
    if (!groups.length) continue;
    const hasSaved = (s.tabs || []).length > 0;
    if (hasSaved) {
      s.parked = true;
      await chrome.storage.local.set({ spaces }); // persist "parked" before anything closes
    }
    for (const { group } of groups) {
      expectedRemovals.add(group.id);
      // Close Orbit's own pages always; close other tabs only if they were saved (known address).
      const all = await chrome.tabs.query({ groupId: group.id });
      const ids = all
        .filter((t) => isOrbitPage(t.url || t.pendingUrl) || (hasSaved && (t.url || t.pendingUrl || tabMeta[t.id]?.url)))
        .map((t) => t.id);
      dlog(`closing ${s.name}: ${ids.length}/${all.length} tabs (saved ${(s.tabs || []).length})`);
      if (ids.length) await chrome.tabs.remove(ids).catch(() => {});
      // anything left (unsaved tabs we refused to close) stays, just collapsed
      if (ids.length < all.length) {
        expectedRemovals.delete(group.id);
        await chrome.tabGroups.update(group.id, { collapsed: true }).catch(() => {});
      }
    }
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
  const space = { id: crypto.randomUUID(), name: finalName, emoji, color: color || 'blue', tabs: [], activeIdx: 0 };

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
  for (const { group } of found) await chrome.tabGroups.update(group.id, { title: label(space), color: space.color });
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

// Put a tab into a space's group (creating the group if needed).
async function putTab(tabId, space, win) {
  const g = await findGroup(space, win);
  const key = space.id;
  const title = label(space);
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
  if (space.parked) {
    await restoreSpace(space, win); // bring its saved tabs back first so the moved tab joins them
    space.parked = false;
    await chrome.storage.local.set({ spaces });
  }
  await putTab(tabId, space, win);
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
      ? items.map(({ tab }) => info(tab))
      : (s.tabs || []).map((t) => ({ ...t }));
    const pins =
      s.id === owner
        ? (await chrome.tabs.query({ windowId: win, pinned: true })).sort((a, b) => a.index - b.index).map(info)
        : (s.pins || []).map((p) => ({ ...p }));
    out.push({ id: s.id, name: s.name, emoji: s.emoji, color: s.color, open, tabs, pins, current: s.id === cur });
  }
  return { spaces: out };
}

// ---------- messaging ----------
const handlers = {
  getView: () => enqueue(getView),
  switch: ({ id }) => enqueue(() => switchSpace(id)),
  create: ({ space }) => enqueue(() => createSpace(space)),
  update: ({ id, patch }) => enqueue(() => updateSpace(id, patch)),
  delete: ({ id, closeTabs }) => enqueue(() => deleteSpace(id, closeTabs)),
  moveCurrent: ({ id }) => enqueue(() => moveCurrent(id)),
  cycle: ({ dir }) => enqueue(() => cycle(dir === -1 ? -1 : 1)),
  togglePin: ({ tabId }) =>
    enqueue(async () => {
      const t = await chrome.tabs.get(tabId);
      if (t.pinned) {
        await chrome.tabs.update(tabId, { pinned: false });
        const { spaces } = await getState();
        const ownerId = await ownerFor(t.windowId, spaces);
        const sp = spaces.find((s) => s.id === ownerId);
        if (sp) await putTab(tabId, sp, t.windowId);
      } else {
        await chrome.tabs.update(tabId, { pinned: true });
      }
      scheduleSnapshot();
    }),
  diagnostics: async () => {
    const { spaces = [], spacesBackup, orbitLog = [] } = await chrome.storage.local.get(['spaces', 'spacesBackup', 'orbitLog']);
    const wins = await normalWindows();
    const lines = [`Orbit ${chrome.runtime.getManifest().version}; windows: ${wins.length}`];
    for (const s of spaces) {
      const live = [];
      for (const w of wins) live.push(`w${w.id}:${(await spaceTabs(s, w.id)).length}`);
      lines.push(`${s.emoji} ${s.name}: saved=${(s.tabs || []).length} live=[${live.join(' ')}] parked=${!!s.parked}`);
    }
    const bk = (spacesBackup?.spaces || []).map((s) => `${s.name}=${(s.tabs || []).length}`).join(' ');
    lines.push(`backup (${spacesBackup ? new Date(spacesBackup.at).toISOString() : 'none'}): ${bk}`);
    return lines.concat(['--- log ---'], orbitLog.slice(-60)).join('\n');
  },
  // address-bar style suggestions: bookmarks first, then the most-visited matching history
  suggest: async ({ q, only }) => {
    const text = String(q || '').trim();
    if (text.length < (only ? 1 : 2)) return [];
    const cap = only ? 20 : 6;
    const [hist, marks] = await Promise.all([
      chrome.history.search({ text, maxResults: 40, startTime: 0 }).catch(() => []),
      chrome.bookmarks.search(text).catch(() => []),
    ]);
    const out = [];
    const seen = new Set();
    const add = (x, bookmark) => {
      if (!x.url || seen.has(x.url) || !/^https?:/.test(x.url)) return;
      seen.add(x.url);
      out.push({ url: x.url, title: x.title || '', bookmark });
    };
    if (only !== 'history') marks.filter((m) => m.url).slice(0, only ? 20 : 3).forEach((m) => add(m, true));
    if (only !== 'bookmark') hist
      .sort((a, c) => (c.visitCount || 0) + 5 * (c.typedCount || 0) - ((a.visitCount || 0) + 5 * (a.typedCount || 0)))
      .forEach((h) => out.length < cap && add(h, false));
    return out;
  },
  // ----- bookmarks and extensions -----
  bookmarkCurrent: async () => {
    const win = await mainWindowId();
    const [t] = await chrome.tabs.query({ active: true, windowId: win });
    if (!t?.url) throw new Error('no page to bookmark');
    await chrome.bookmarks.create({ title: t.title || t.url, url: t.url });
  },
  unbookmarkCurrent: async () => {
    const win = await mainWindowId();
    const [t] = await chrome.tabs.query({ active: true, windowId: win });
    for (const m of await chrome.bookmarks.search({ url: t?.url || '' })) await chrome.bookmarks.remove(m.id);
  },
  extList: async () =>
    (await chrome.management.getAll())
      .filter((e) => e.type === 'extension' && e.id !== chrome.runtime.id)
      .sort((a, c) => a.name.localeCompare(c.name))
      .map((e) => ({ id: e.id, name: e.name, enabled: e.enabled, version: e.version, optionsUrl: e.optionsUrl || '', mayDisable: e.mayDisable })),
  extSet: ({ id, enabled }) => chrome.management.setEnabled(id, !!enabled),
  extUninstall: ({ id }) => chrome.management.uninstall(id, { showConfirmDialog: true }),
  extOptions: async ({ url }) => {
    await chrome.tabs.create({ url });
  },
  // ----- tab / window / browser actions from the palette -----
  tabAction: async ({ action }) => {
    const win = await mainWindowId();
    const [t] = await chrome.tabs.query({ active: true, windowId: win });
    if (!t) throw new Error('no active tab');
    const STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];
    switch (action) {
      case 'duplicate': await chrome.tabs.duplicate(t.id); break;
      case 'reload': await chrome.tabs.reload(t.id); break;
      case 'hardReload': await chrome.tabs.reload(t.id, { bypassCache: true }); break;
      case 'mute': await chrome.tabs.update(t.id, { muted: !t.mutedInfo?.muted }); break;
      case 'source': await chrome.tabs.create({ windowId: win, url: 'view-source:' + t.url }); break;
      case 'zoomIn':
      case 'zoomOut': {
        const z = await chrome.tabs.getZoom(t.id);
        const i = STEPS.findIndex((s) => s >= z - 0.001);
        const n = action === 'zoomIn' ? Math.min(STEPS.length - 1, (STEPS[i] > z + 0.001 ? i : i + 1)) : Math.max(0, i - 1);
        await chrome.tabs.setZoom(t.id, STEPS[Math.max(0, n)]);
        break;
      }
      case 'zoomReset': await chrome.tabs.setZoom(t.id, 1); break;
      case 'print': await chrome.scripting.executeScript({ target: { tabId: t.id }, func: () => setTimeout(() => window.print(), 80) }); break;
      case 'sleepOthers':
        for (const o of await chrome.tabs.query({ windowId: win, active: false, discarded: false })) await chrome.tabs.discard(o.id).catch(() => {});
        break;
      case 'closeDuplicates': {
        const seen = new Set([t.url]);
        const dupes = [];
        for (const o of (await chrome.tabs.query({ windowId: win })).sort((a, c) => a.index - c.index)) {
          if (o.id === t.id || o.pinned) continue;
          const u = o.url || o.pendingUrl;
          if (!u || /^chrome-extension:/.test(u)) continue;
          if (seen.has(u)) dupes.push(o.id);
          else seen.add(u);
        }
        if (dupes.length) await chrome.tabs.remove(dupes);
        break;
      }
      case 'fullscreen': {
        const w = await chrome.windows.get(win);
        await chrome.windows.update(win, { state: w.state === 'fullscreen' ? 'normal' : 'fullscreen' });
        break;
      }
      default: throw new Error('unknown action ' + action);
    }
  },
  reopenClosed: () => chrome.sessions.restore(),
  newWindow: () => chrome.windows.create({ focused: true }),
  reloadExtension: async () => {
    setTimeout(() => chrome.runtime.reload(), 150);
  },
  // brave://restart relaunches the browser (it reopens your tabs)
  relaunch: async () => {
    await chrome.tabs.create({ url: 'brave://restart' }).catch(() => chrome.tabs.create({ url: 'chrome://restart' }));
  },
  bookmarkSpace: async ({ id }) => {
    const view = await enqueue(getView);
    const s = view.spaces.find((x) => x.id === id);
    if (!s) return;
    const urls = [...(s.pins || []), ...(s.tabs || [])].filter((x) => /^https?:/.test(x.url || ''));
    const folder = await chrome.bookmarks.create({ title: `${s.emoji} ${s.name}` });
    for (const u of urls) await chrome.bookmarks.create({ parentId: folder.id, title: u.title || u.url, url: u.url });
  },
  setSetting: async ({ key, value }) => {
    const { settings = {} } = await chrome.storage.local.get('settings');
    settings[key] = value;
    await chrome.storage.local.set({ settings });
  },
  copyLink: () => copyCurrentLink(),
  focusTab: async ({ tabId }) => {
    const t = await chrome.tabs.update(tabId, { active: true });
    await chrome.windows.update(t.windowId, { focused: true });
  },
  paletteData: async () => {
    const view = await enqueue(getView);
    const win = await mainWindowId();
    const [t] = await chrome.tabs.query({ active: true, windowId: win });
    const bookmarked = t?.url ? (await chrome.bookmarks.search({ url: t.url }).catch(() => [])).length > 0 : false;
    const { settings = {} } = await chrome.storage.local.get('settings');
    const scheme = settings.theme === 'light' || settings.theme === 'dark' ? settings.theme : await browserScheme();
    return { spaces: view.spaces, scheme, theme: settings.theme || 'auto', cur: t ? { id: t.id, pinned: t.pinned, url: t.url, title: t.title, bookmarked, muted: !!t.mutedInfo?.muted, audible: !!t.audible } : null };
  },
  // url null = blank new tab. New tabs are adopted into the active space by the usual listeners.
  openUrl: async ({ url, current, tabId }) => {
    const win = await mainWindowId();
    const [t] = tabId ? [{ id: tabId }] : await chrome.tabs.query({ active: true, windowId: win });
    const go = async (u) => {
      if (current && t && url) await chrome.tabs.update(t.id, { url: u });
      // blank tab = the palette page itself, so it doesn't bounce through the New Tab override
      else await chrome.tabs.create({ windowId: win, url: u || chrome.runtime.getURL('palette-tab.html') });
    };
    try {
      await go(url);
    } catch (e) {
      // some builds only accept chrome:// from extensions
      if (url?.startsWith('brave://')) await go(url.replace('brave://', 'chrome://'));
      else throw e;
    }
    await chrome.windows.update(win, { focused: true });
  },
  // The New Tab override loaded (Cmd+T): bounce back to the previous tab and draw the palette over it.
  ntp: async (_msg, sender) => {
    const ntp = sender?.tab;
    if (!ntp) return { fallback: true, reason: 'no sender tab' };
    try {
      // most recently used other tab in this window (lastAccessed also covers tabs used before the extension loaded)
      const prev = (await chrome.tabs.query({ windowId: ntp.windowId }))
        .filter((t) => t.id !== ntp.id && !(t.url || '').startsWith('chrome-extension://'))
        .sort((a, c) => (c.lastAccessed || 0) - (a.lastAccessed || 0))[0];
      if (!prev) return { fallback: true, reason: 'no other tab in this window' };
      const probe = () => chrome.scripting.executeScript({ target: { tabId: prev.id }, func: () => true });
      if (prev.discarded) {
        // waking a discarded tab reloads it; give it a moment
        await chrome.tabs.update(prev.id, { active: true });
        for (let i = 0; ; i++) {
          try {
            await probe();
            break;
          } catch (e) {
            if (i >= 12) throw e;
            await new Promise((r) => setTimeout(r, 150));
          }
        }
      } else {
        await probe(); // throws on pages we can't script (brave://, web store…)
        await chrome.tabs.update(prev.id, { active: true });
      }
      await chrome.tabs.remove(ntp.id);
      await showPalette(prev.id);
      return { fallback: false };
    } catch (e) {
      const reason = String(e?.message || e);
      console.warn('Orbit: New Tab overlay unavailable, showing in-tab palette:', reason);
      chrome.tabs.update(ntp.id, { active: true }).catch(() => {});
      return { fallback: true, reason };
    }
  },
  search: async ({ text, current, tabId }) => {
    const win = await mainWindowId();
    const [t] = tabId ? [{ id: tabId }] : await chrome.tabs.query({ active: true, windowId: win });
    await chrome.windows.update(win, { focused: true });
    await chrome.search.query(current && t ? { text, tabId: t.id } : { text, disposition: 'NEW_TAB' });
  },
  closeTab: ({ tabId }) => chrome.tabs.remove(tabId),
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const h = handlers[msg?.type];
  if (!h) return;
  Promise.resolve(h(msg, _sender)).then(
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
  if (cmd === 'copy-link') copyCurrentLink();
  if (cmd === 'open-palette') openPalette();
});

// Clicking the toolbar icon opens the palette.
chrome.action.onClicked.addListener(() => openPalette());

// The browser's own light/dark preference, read from an extension page (an offscreen document) so it
// doesn't depend on the website you're on. null if unavailable (the overlay then uses the page's value).
async function browserScheme() {
  try {
    if (!(await chrome.offscreen.hasDocument())) {
      await chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['CLIPBOARD'], justification: 'Copy links and read the browser theme' });
    }
    const r = await chrome.runtime.sendMessage({ type: 'offscreen-theme' });
    return r?.scheme === 'dark' || r?.scheme === 'light' ? r.scheme : null;
  } catch {
    return null;
  }
}

// ---------- command palette ----------
// Show/toggle the overlay in a tab: via its content script if present, else inject on demand.
async function showPalette(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'togglePalette' });
  } catch {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['palette-core.js', 'palette.js'] });
    await chrome.scripting.executeScript({ target: { tabId }, func: () => window.__orbitTogglePalette() });
  }
}

// Overlay injected into the page; on pages we can't script (brave://, new tab, web store) use a small window instead.
async function openPalette() {
  const paletteUrl = chrome.runtime.getURL('palette.html');
  const open = await chrome.tabs.query({ url: paletteUrl });
  if (open.length) {
    await chrome.windows.remove(open[0].windowId).catch(() => {});
    return;
  }
  const win = await mainWindowId();
  const [tab] = await chrome.tabs.query({ active: true, windowId: win });
  try {
    if (!tab?.id) throw new Error('no tab');
    await showPalette(tab.id);
  } catch {
    const w = await chrome.windows.get(win);
    const width = 680;
    const height = 520;
    await chrome.windows.create({
      url: paletteUrl,
      type: 'popup',
      focused: true,
      width,
      height,
      left: Math.round((w.left ?? 0) + ((w.width ?? width) - width) / 2),
      top: Math.round((w.top ?? 0) + 90),
    });
  }
}

// ---------- copy the current tab's link ----------
async function copyCurrentLink() {
  const win = await mainWindowId();
  const [tab] = await chrome.tabs.query({ active: true, windowId: win });
  const url = tab?.url || tab?.pendingUrl;
  let ok = false;
  if (url) {
    // 1. write from inside the page (focused, so the clipboard accepts it)
    try {
      const [r] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: async (text) => {
          try {
            await navigator.clipboard.writeText(text);
            return true;
          } catch {}
          const t = document.createElement('textarea');
          t.value = text;
          t.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
          document.documentElement.appendChild(t);
          t.select();
          const done = document.execCommand('copy');
          t.remove();
          return done;
        },
        args: [url],
      });
      ok = !!r?.result;
    } catch {}
    // 2. pages we can't script (brave://, web store…): hidden helper page
    if (!ok) {
      try {
        if (!(await chrome.offscreen.hasDocument())) {
          await chrome.offscreen.createDocument({
            url: 'offscreen.html',
            reasons: ['CLIPBOARD'],
            justification: 'Copy the current tab URL to the clipboard',
          });
        }
        const r = await chrome.runtime.sendMessage({ type: 'offscreen-copy', text: url });
        ok = !!r?.ok;
      } catch {}
    }
  }
  await chrome.action.setBadgeBackgroundColor({ color: ok ? '#188038' : '#d93025' });
  await chrome.action.setBadgeText({ text: ok ? '✓' : '!' });
  setTimeout(() => chrome.action.setBadgeText({ text: '' }), 1500);
  return ok;
}

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
chrome.runtime.onInstalled.addListener((details) => {
  // Extensions can't change browser settings, so take a fresh install straight to the vertical tabs switch.
  if (details.reason === 'install')
    chrome.tabs.create({ url: 'brave://settings/appearance' }).catch(() => chrome.tabs.create({ url: 'chrome://settings/appearance' }).catch(() => {}));
  enqueue(rebuildMenu);
  scheduleAdopt();
});
enqueue(rebuildMenu);
scheduleAdopt();
scheduleIcon();

// ---------- clicking a tab in another space's group (e.g. in the vertical sidebar) switches space ----------
// Closing the last tab of the active space: keep the space alive with a new tab page, instead of
// letting its group vanish and the browser jump into another space.
const tabGroupOf = new Map();
const primeTabGroups = chrome.tabs
  .query({})
  .then((ts) => ts.forEach((t) => tabGroupOf.set(t.id, t.groupId)))
  .catch(() => {});
chrome.tabs.onCreated.addListener((t) => tabGroupOf.set(t.id, t.groupId));
chrome.tabs.onUpdated.addListener((id, ci) => {
  if (ci.groupId !== undefined) tabGroupOf.set(id, ci.groupId);
});
chrome.tabs.onRemoved.addListener(async (tabId, info) => {
  await primeTabGroups;
  const g = tabGroupOf.get(tabId);
  tabGroupOf.delete(tabId);
  if (info.isWindowClosing || g == null || g < 0) return;
  enqueue(async () => {
    if ((await chrome.tabs.query({ groupId: g })).length) return; // the group still has tabs
    if (expectedRemovals.has(g)) return; // we closed it on purpose
    const win = info.windowId;
    const { spaces } = await getState();
    const sess = await getSession();
    const m = sess.groups[win] || {};
    const key = Object.keys(m).find((k) => m[k] === g);
    const space = spaces.find((s) => s.id === key);
    if (!space || space.parked || sess.active[win] !== space.id) return;
    const t = await chrome.tabs.create({ windowId: win, url: chrome.runtime.getURL('palette-tab.html'), active: true });
    await putTab(t.id, space, win);
  }).catch(() => {});
});

chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
  scheduleIcon();
  enqueue(async () => {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab || !tab.active || tab.groupId === NONE || tab.windowId !== windowId) return; // !active: focus already moved on
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
    await putTab(tab.id, space, tab.windowId);
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
