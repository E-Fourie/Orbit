// Command palette UI, shared by the in-page overlay (palette.js) and the
// standalone window used on pages we can't inject into (palette.html).
// Usage: orbitPalette(rootElementOrShadowRoot, { close })
(() => {
  const CSS = `
:host, .scrim { all: initial; }
.scrim {
  position: fixed; inset: 0; z-index: 2147483647; display: flex; justify-content: center; align-items: flex-start;
  padding-top: 13vh; background: rgba(10, 12, 18, .38); backdrop-filter: blur(3px);
  font: 14px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  --bg: #ffffff; --fg: #1d1f24; --dim: #6b7280; --line: rgba(0,0,0,.08); --sel: rgba(152,198,195,.38); --accent: #3b837f; --chip: rgba(0,0,0,.06);
  color: var(--fg); color-scheme: light dark;
}
@media (prefers-color-scheme: dark) {
  .scrim:not([data-theme="light"]) { --bg: #1f2126; --fg: #ececf0; --dim: #9aa0aa; --line: rgba(255,255,255,.09); --sel: rgba(152,198,195,.20); --accent: #98c6c3; --chip: rgba(255,255,255,.09); }
}
.scrim[data-theme="dark"] { --bg: #1f2126; --fg: #ececf0; --dim: #9aa0aa; --line: rgba(255,255,255,.09); --sel: rgba(152,198,195,.20); --accent: #98c6c3; --chip: rgba(255,255,255,.09); color-scheme: dark; }
.scrim[data-theme="light"] { color-scheme: light; }
.box { width: min(640px, 92vw); max-height: 70vh; display: flex; flex-direction: column; background: var(--bg);
  border-radius: 14px; box-shadow: 0 24px 70px rgba(0,0,0,.35), 0 0 0 1px var(--line); overflow: hidden; }
.in { display: flex; align-items: center; gap: 10px; padding: 14px 16px; border-bottom: 1px solid var(--line); }
.in .ico { font-size: 16px; opacity: .6; }
input { all: unset; flex: 1; font-size: 17px; color: var(--fg); min-width: 0; }
input::placeholder { color: var(--dim); }
.space { flex: none; display: flex; align-items: center; gap: 5px; font-size: 12px; padding: 3px 9px; border-radius: 99px;
  background: var(--chip); color: var(--fg); white-space: nowrap; max-width: 180px; overflow: hidden; text-overflow: ellipsis; }
.space i { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
.list { overflow-y: auto; padding: 6px; }
.row { display: flex; align-items: center; gap: 12px; padding: 8px 10px; border-radius: 9px; cursor: pointer; }
.row.sel { background: var(--sel); }
.fav { flex: none; width: 20px; height: 20px; border-radius: 5px; display: grid; place-items: center; font-size: 14px;
  background: var(--chip); overflow: hidden; }
.fav img { width: 16px; height: 16px; }
.txt { flex: 1; min-width: 0; }
.t { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.s { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--dim); font-size: 12px; }
.tag { flex: none; font-size: 11px; color: var(--dim); background: var(--chip); padding: 2px 7px; border-radius: 99px; max-width: 160px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.kind { flex: none; font-size: 11px; color: var(--accent); }
.empty { padding: 22px; text-align: center; color: var(--dim); }
.foot { display: flex; gap: 16px; padding: 8px 14px; border-top: 1px solid var(--line); color: var(--dim); font-size: 11px; }
.foot b { font-weight: 600; color: var(--fg); }
`;

  const COLORS = {
    grey: '#5f6368', blue: '#1a73e8', red: '#d93025', yellow: '#f9ab00', green: '#188038',
    pink: '#d01884', purple: '#9334e6', cyan: '#007b83', orange: '#e8710a',
  };
  // Browser pages (brave:// is also reachable as chrome://)
  const PAGES = [
    ['Extensions', 'extensions'], ['Extension shortcuts', 'extensions/shortcuts'], ['Settings', 'settings'],
    ['Appearance settings', 'settings/appearance'], ['New tab page settings', 'settings/newTab'],
    ['Shields settings', 'settings/shields'], ['Privacy and security settings', 'settings/privacy'],
    ['Cookies settings', 'settings/cookies'], ['Passwords', 'settings/passwords'], ['Sync', 'settings/braveSync'],
    ['Search engines', 'settings/search'], ['Languages', 'settings/languages'], ['Downloads settings', 'settings/downloads'],
    ['History', 'history'], ['Downloads', 'downloads'], ['Bookmarks', 'bookmarks'], ['Flags (experiments)', 'flags'],
    ['Version / About Brave', 'version'], ['Rewards', 'rewards'], ['Wallet', 'wallet'], ['Inspect (devtools targets)', 'inspect'],
    ['Clear browsing data', 'settings/clearBrowserData'], ['Check for updates / About', 'settings/help'], ['System settings', 'settings/system'],
    ['Task manager / memory (discards)', 'discards'], ['Site engagement', 'site-engagement'], ['GPU info', 'gpu'], ['Net export / internals', 'net-internals'],
  ];
  const EMOJI_RE = /^(\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*)\s*/u;

  // Prefix shortcuts: the first character narrows the palette to one kind of result.
  const PFX = { '@': ['Tab', 'Pinned', 'Saved tab'], '/': ['Space'], ':': ['Command'], '~': ['Page'], '#': ['Bookmark'], '!': ['History'], '?': ['Search', 'Open'] };
  const HINTS = '@ tabs · / spaces · : commands · ~ pages · # bookmarks · ! history · ? web · > move tab · + new space';

  function looksLikeUrl(q) {
    if (/\s/.test(q)) return null;
    if (/^[a-z][a-z0-9+.-]*:\/\/\S+$/i.test(q)) return q;
    if (/^(localhost|(\d{1,3}\.){3}\d{1,3})(:\d+)?(\/\S*)?$/i.test(q)) return 'http://' + q;
    // IPv6 literal, with or without brackets/port ([::1]:3000, 2001:db8::1)
    let m = q.match(/^\[([0-9a-f:.]+)\](:\d+)?(\/\S*)?$/i);
    if (m && m[1].includes(':')) return 'http://' + q;
    m = q.match(/^([0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}$/i);
    if (m) return `http://[${q}]`;
    // host:port ( nas:8080, router.local:81 )
    if (/^[a-z0-9-]+(\.[a-z0-9-]+)*:\d{1,5}(\/\S*)?$/i.test(q)) return 'http://' + q;
    if (/^[^\s/]+\.[a-z]{2,}(:\d+)?([/?#]\S*)?$/i.test(q)) return 'https://' + q;
    return null;
  }

  function hostOf(url) {
    try {
      const u = new URL(url);
      return (u.host + u.pathname).replace(/\/$/, '') || url;
    } catch {
      return url || '';
    }
  }

  // Every whitespace-separated token must match; substring beats subsequence, title beats the rest.
  function score(q, e) {
    const toks = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!toks.length) return e.base;
    const title = e.title.toLowerCase();
    const rest = `${e.sub} ${e.tag || ''} ${e.kind}`.toLowerCase();
    let total = 0;
    for (const t of toks) {
      let s = -1;
      const i = title.indexOf(t);
      if (i >= 0) s = 100 - Math.min(i, 50) + (i === 0 || /\W/.test(title[i - 1]) ? 30 : 0);
      else if (rest.includes(t)) s = 40;
      else {
        let j = 0;
        for (const c of title) if (c === t[j]) j++;
        if (j === t.length) s = 10;
      }
      if (s < 0) return -1;
      total += s;
    }
    return total + e.base;
  }

  window.orbitPalette = function mount(root, { close, newTab }) {
    // newTab = { tabId } when running as the New Tab page: navigate that tab instead of opening another.
    const send = async (type, payload = {}) => {
      const r = await chrome.runtime.sendMessage({ type, ...payload });
      if (!r?.ok) throw new Error(r?.error || 'failed');
      return r.data;
    };
    const el = (tag, cls, text) => {
      const e = document.createElement(tag);
      if (cls) e.className = cls;
      if (text != null) e.textContent = text;
      return e;
    };

    const style = el('style');
    style.textContent = CSS;
    const scrim = el('div', 'scrim');
    const box = el('div', 'box');
    const inRow = el('div', 'in');
    inRow.append(el('span', 'ico', '⌘'));
    const input = el('input');
    const DEFAULT_PH = 'Search tabs, switch spaces, run a command, or type a URL…';
    input.placeholder = DEFAULT_PH;
    input.spellcheck = false;
    input.autocomplete = 'off';
    inRow.append(input);
    const spaceChip = el('span', 'space');
    spaceChip.hidden = true;
    inRow.append(spaceChip);
    const list = el('div', 'list');
    const foot = el('div', 'foot');
    for (const [k, v] of [['↑↓', 'move'], ['↵', 'select'], ['⇧↵', 'open in this tab'], ['+ name', 'new space'], ['> name', 'move tab'], ['esc', 'close']]) {
      const s = el('span');
      s.append(el('b', null, k), ' ' + v);
      foot.append(s);
    }
    const hint = el('div', 'foot', HINTS);
    hint.style.cssText = 'padding-top:0;border-top:none;opacity:.8;flex-wrap:wrap;gap:4px 10px;font-size:10.5px';
    box.append(inRow, list, foot, hint);
    scrim.append(box);
    root.append(style, scrim);

    let data = { spaces: [], cur: null };
    let results = [];
    let sel = 0;
    let sugg = []; // history/bookmark suggestions for the current query
    let mode = null; // submenus for managing spaces: manage → space → rename | emoji | color | confirm
    const sName = (s) => `${s.emoji} ${s.name}`;
    const go = (m, val = '') => {
      mode = m;
      input.value = val;
      input.placeholder = m?.placeholder || DEFAULT_PH;
      refresh();
      input.focus();
      if (val) input.select();
    };

    const openExts = () => {
      go({ kind: 'exts', placeholder: 'Choose an extension to manage' });
      send('extList').then((list) => {
        if (mode?.kind === 'exts') {
          mode.items = list;
          refresh();
        }
      }).catch(() => {});
    };

    const prefixOf = (q) => (!mode && q.length && PFX[q[0]] ? q[0] : null);

    function modeEntries(q) {
      const { spaces } = data;
      const s = mode.space;
      const out = [];
      const item = (title, sub, icon, run, extra = {}) => out.push({ kind: '', title, sub: sub || '', icon, base: 0, run, ...extra });
      if (mode.kind === 'manage') {
        for (const x of spaces)
          item(sName(x), x.current ? 'Current space' : `${(x.tabs?.length || 0) + (x.pins?.length || 0)} tabs`, x.emoji,
            async () => go({ kind: 'space', space: x, placeholder: `${sName(x)}: choose an action` }), { base: x.current ? 10 : 0 });
      } else if (mode.kind === 'exts') {
        if (!mode.items) item('Loading extensions…', '', '⏳', async () => {});
        for (const x of mode.items || [])
          item(x.name, `${x.enabled ? 'Enabled' : 'Disabled'} · v${x.version}`, x.enabled ? '🧩' : '⏸',
            async () => go({ kind: 'ext', ext: x, items: mode.items, placeholder: `${x.name}: choose an action` }), { base: x.enabled ? 1 : 0 });
      } else if (mode.kind === 'ext') {
        const x = mode.ext;
        if (x.mayDisable !== false)
          item(x.enabled ? 'Disable' : 'Enable', x.name, x.enabled ? '⏸' : '▶', act(() => send('extSet', { id: x.id, enabled: !x.enabled })));
        if (x.optionsUrl) item('Open options', '', '⚙', act(() => send('extOptions', { url: x.optionsUrl })));
        item('Uninstall…', 'Brave asks you to confirm', '🗑', act(() => send('extUninstall', { id: x.id })));
        item('Back', '', '←', async () => openExts());
      } else if (mode.kind === 'space') {
        item('Rename…', s.name, '✎', async () => go({ kind: 'rename', space: s, placeholder: 'New name, then Enter' }, s.name));
        item('Change emoji…', s.emoji, s.emoji, async () => go({ kind: 'emoji', space: s, placeholder: 'Type an emoji, then Enter' }, s.emoji));
        item('Change colour…', s.color, '●', async () => go({ kind: 'color', space: s, placeholder: 'Pick a colour' }), { iconColor: COLORS[s.color] });
        item('Delete space, keep its tabs', 'Tabs stay open and loose', '🗑', act(() => send('delete', { id: s.id, closeTabs: false })));
        item('Delete space and close its tabs…', 'Asks for confirmation', '🗑', async () => go({ kind: 'confirm', space: s, placeholder: 'Confirm deletion' }));
        item('Back', '', '←', async () => go({ kind: 'manage', placeholder: 'Choose a space to edit' }));
      } else if (mode.kind === 'rename') {
        const name = q.trim();
        item(name ? `Rename to “${name}”` : 'Type a new name', sName(s), '✎', act(() => name && send('update', { id: s.id, patch: { name } })), { always: true, base: 1000 });
      } else if (mode.kind === 'emoji') {
        const em = (q.trim().match(EMOJI_RE) || [])[1];
        item(em ? `Use ${em}` : 'Type an emoji', sName(s), em || '🙂', act(() => em && send('update', { id: s.id, patch: { emoji: em } })), { always: true, base: 1000 });
      } else if (mode.kind === 'color') {
        for (const [name, hex] of Object.entries(COLORS))
          item(name, name === s.color ? 'Current' : '', '', act(() => send('update', { id: s.id, patch: { color: name } })), { iconColor: hex });
      } else if (mode.kind === 'relaunch') {
        item('Yes, relaunch Brave now', 'Brave restarts and reopens your tabs', '⟳', act(() => send('relaunch')));
        item('Cancel', '', '←', async () => go(null));
      } else if (mode.kind === 'confirm') {
        item(`Yes, delete ${sName(s)} and close its tabs`, 'This cannot be undone', '🗑', act(() => send('delete', { id: s.id, closeTabs: true })));
        item('Cancel', '', '←', async () => go({ kind: 'space', space: s, placeholder: `${sName(s)}: choose an action` }));
      }
      return out;
    }

    const done = () => close();
    let webEntry = null; // the "Search for …" / "Open URL" entry for the current query
    const act = (fn) => async (mods) => {
      let r;
      try {
        r = await fn(mods);
      } catch (e) {
        console.warn('[Orbit]', e);
      }
      if (r !== 'stay') done();
    };

    function buildEntries(q) {
      const out = [];
      webEntry = null;
      const { spaces, cur } = data;
      const curSpace = spaces.find((s) => s.current);
      if (mode) return modeEntries(q);
      const pfx = prefixOf(q);
      const body = pfx ? q.slice(1).trim() : q;

      // "> name" moves the current tab to that space
      if (!mode && q.startsWith('>')) {
        const want = q.slice(1).trim();
        if (!cur || newTab) {
          out.push({ kind: 'Move', title: 'No current page to move', sub: 'Use > from a normal tab', icon: '↪', base: 0, always: true, run: async () => {} });
          return out;
        }
        for (const s of spaces)
          if (!s.current && (!want || score(want, { title: s.name, sub: s.emoji, kind: '', base: 0 }) >= 0))
            out.push({ kind: 'Move', title: `Move tab to ${sName(s)}`, sub: hostOf(cur.url), icon: s.emoji, base: 0, always: true, run: act(() => send('moveCurrent', { id: s.id })) });
        if (!out.length) out.push({ kind: 'Move', title: want ? `No other space matches “${want}”` : 'No other spaces', sub: '', icon: '↪', base: 0, always: true, run: async () => {} });
        return out;
      }

      // "+ Name" creates a space
      if (!mode && q.startsWith('+')) {
        let name = q.slice(1).trim();
        let emoji;
        const m = name.match(EMOJI_RE);
        if (m) {
          emoji = m[1];
          name = name.slice(m[0].length);
        }
        out.push({
          kind: 'Command', title: name ? `Create space “${name}”` : 'Create space…', sub: name ? 'Type an emoji first to pick its icon' : 'Type a name after the +',
          icon: '＋', base: 1000, run: act(() => name && send('create', { space: { name, emoji } })),
        });
        return out;
      }

      for (const s of spaces) {
        const mk = (t, pinned) => ({
          kind: pinned ? 'Pinned' : t.id == null ? 'Saved tab' : 'Tab',
          title: t.title || t.url || 'New tab',
          sub: hostOf(t.url),
          tag: sName(s),
          favicon: t.favIconUrl,
          url: t.url,
          base: s.current ? 30 : 10,
          run: act(() => (t.id != null ? send('focusTab', { tabId: t.id }) : send('switch', { id: s.id }))),
        });
        for (const t of s.pins || []) if (t.id !== newTab?.tabId) out.push(mk(t, true));
        for (const t of s.tabs || []) if (t.id !== newTab?.tabId) out.push(mk(t, false));
        if (!s.current) {
          out.push({
            kind: 'Space', title: `Switch to ${sName(s)}`, sub: `${(s.tabs?.length || 0) + (s.pins?.length || 0)} tabs`,
            icon: s.emoji, base: 25, run: act(() => send('switch', { id: s.id })),
          });
        }
      }

      const cmd = (title, sub, icon, run, base = 20) => out.push({ kind: 'Command', title, sub, icon, base, run: act(run) });
      if (!newTab) cmd('New tab', curSpace ? `In ${sName(curSpace)}` : '', '＋', () => send('openUrl', { url: null }), 22);
      if (cur) cmd('Copy link', hostOf(cur.url), '🔗', () => send('copyLink'), 21);
      if (cur) {
        cmd(cur.pinned ? 'Unpin tab' : 'Pin tab', 'Pins belong to the current space', '📌', () => send('togglePin', { tabId: cur.id }));
        cmd('Close tab', '', '✕', () => send('closeTab', { tabId: cur.id }), 15);
      }
      if (spaces.length > 1) {
        cmd('Next space', '', '→', () => send('cycle', { dir: 1 }), 15);
        cmd('Previous space', '', '←', () => send('cycle', { dir: -1 }), 15);
      }
      for (const s of spaces) {
        if (!s.current && cur)
          cmd(`Move tab to ${sName(s)}`, 'Sends the current tab to that space', '↪', () => send('moveCurrent', { id: s.id }), 12);
      }
      out.push({ kind: 'Command', title: 'Manage spaces…', sub: 'Rename, recolour or delete spaces', icon: '⚙', base: 6,
        run: async () => go({ kind: 'manage', placeholder: 'Choose a space to edit' }) });
      if (curSpace)
        out.push({ kind: 'Command', title: 'Edit current space…', sub: sName(curSpace), icon: '✎', base: 7,
          run: async () => go({ kind: 'space', space: curSpace, placeholder: `${sName(curSpace)}: choose an action` }) });
      out.push({ kind: 'Command', title: 'Manage extensions…', sub: 'Enable, disable, open options or uninstall', icon: '🧩', base: 6, run: async () => openExts() });
      if (cur?.url && /^https?:/.test(cur.url)) {
        if (cur.bookmarked) cmd('Remove bookmark', hostOf(cur.url), '⭐', () => send('unbookmarkCurrent'), 19);
        else cmd('Bookmark this page', hostOf(cur.url), '⭐', () => send('bookmarkCurrent'), 19);
      }
      {
        const th = data.theme || 'auto';
        const nxt = { auto: 'light', light: 'dark', dark: 'auto' }[th];
        cmd(`Theme: ${th}`, `Enter switches to ${nxt}. Auto follows the browser`, '◐', () => send('setSetting', { key: 'theme', value: nxt }), 2);
      }
      // current-tab actions
      if (cur) {
        const ta = (title, sub, icon, action, base = 13) => cmd(title, sub, icon, () => send('tabAction', { action }), base);
        ta('Duplicate tab', '', '⧉', 'duplicate');
        ta('Reload tab', '', '↻', 'reload');
        ta('Hard reload (skip cache)', '', '↻', 'hardReload', 11);
        cmd(cur.muted ? 'Unmute tab' : 'Mute tab', cur.audible ? 'Playing audio' : '', cur.muted ? '🔊' : '🔇', () => send('tabAction', { action: 'mute' }), cur.audible ? 18 : 12);
        ta('Zoom in', '', '＋', 'zoomIn', 10);
        ta('Zoom out', '', '－', 'zoomOut', 10);
        ta('Reset zoom', '', '⌕', 'zoomReset', 10);
        ta('Print / save as PDF', '', '🖨', 'print', 10);
        ta('View page source', '', '‹›', 'source', 10);
        ta('Sleep other tabs (free memory)', 'Brave reloads them when you open them', '💤', 'sleepOthers', 9);
        ta('Close duplicate tabs', 'Keeps one of each address', '🧹', 'closeDuplicates', 9);
        if (cur.url) {
          cmd('Copy link as Markdown', cur.title || hostOf(cur.url), '📋', () => navigator.clipboard.writeText(`[${cur.title || cur.url}](${cur.url})`), 11);
          cmd('Copy page title', cur.title || '', '📋', () => navigator.clipboard.writeText(cur.title || cur.url), 10);
        }
      }
      if (curSpace) {
        const links = [...(curSpace.pins || []), ...(curSpace.tabs || [])].map((t) => t.url).filter((u) => /^https?:/.test(u || ''));
        cmd('Copy all tab links in this space', `${links.length} links`, '📋', () => navigator.clipboard.writeText(links.join('\n')), 9);
        cmd('Bookmark all tabs in this space', 'Creates a folder named after the space', '⭐', () => send('bookmarkSpace', { id: curSpace.id }), 9);
      }
      cmd('Reopen closed tab', '', '↩', () => send('reopenClosed'), 17);
      cmd('New window', '', '🗔', () => send('newWindow'), 8);
      cmd('Toggle fullscreen', '', '⛶', () => send('tabAction', { action: 'fullscreen' }), 8);
      cmd('Check for Brave updates', 'Opens About Brave, which checks and offers to relaunch', '⬆', () => send('openUrl', { url: 'brave://settings/help' }), 4);
      out.push({ kind: 'Command', title: 'Relaunch Brave…', sub: 'Restarts the browser to apply an update; tabs reopen', icon: '⟳', base: 4,
        run: async () => go({ kind: 'relaunch', placeholder: 'Relaunch Brave?' }) });
      cmd('Reload Orbit', 'Reloads this extension', '♻', () => send('reloadExtension'), 3);
      cmd('Turn on vertical tabs', 'Opens the Appearance setting (Brave\'s own switch)', '▥', () => send('openUrl', { url: 'brave://settings/appearance' }), 3);
      cmd('Copy Orbit diagnostics', 'Copies saved/live tab counts and a log to paste into a bug report', '🩺', async () => navigator.clipboard.writeText(await send('diagnostics')), 3);
      cmd('New space', 'Type + followed by a name', '＋', () => send('openUrl', { url: null }), 5);
      out[out.length - 1].keepOpen = true;
      out[out.length - 1].run = async () => {
        input.value = '+';
        input.dispatchEvent(new Event('input'));
      };

      for (const [title, path] of PAGES)
        out.push({ kind: 'Page', title, sub: `brave://${path}`, icon: '🧭', base: 3, run: act(async () => {
          await send('openUrl', { url: `brave://${path}`, current: !!newTab, tabId: newTab?.tabId });
          return newTab ? 'stay' : undefined;
        }) });

      // history + bookmark suggestions (like the address bar), skipping pages that are already open tabs
      if (pfx ? body.length >= 1 : q.trim().length >= 2) {
        const open = new Set(out.filter((e) => e.url).map((e) => e.url));
        for (const s of sugg) {
          if (open.has(s.url)) continue;
          out.push({ kind: s.bookmark ? 'Bookmark' : 'History', title: s.title || s.url, sub: hostOf(s.url), url: s.url, icon: s.bookmark ? '⭐' : '🕘', base: 8, always: true,
            run: act(async (mods) => {
              await send('openUrl', { url: s.url, current: !!newTab || !!mods?.shift, tabId: newTab?.tabId });
              return newTab ? 'stay' : undefined;
            }) });
        }
      }

      // Open as URL / search the web
      // (Shift+Enter runs this entry from any row, so it's kept even when a prefix filters it out of the list.)
      const text = body.trim();
      if (text) {
        const url = looksLikeUrl(text);
        webEntry = {
          kind: url ? 'Open' : 'Search', title: url ? url : `Search for “${text}”`, sub: 'Opens in a new tab · Shift+Enter from any row',
          icon: url ? '🌐' : '🔍', base: url ? 500 : -1, always: true,
          run: act(async () => {
            // as the New Tab page, "new tab" means this (already new) tab
            await send(url ? 'openUrl' : 'search', { url, text, current: !!newTab, tabId: newTab?.tabId });
            return newTab ? 'stay' : undefined;
          }),
        };
        out.push(webEntry);
      }
      return pfx ? out.filter((e) => PFX[pfx].includes(e.kind)) : out;
    }

    function refresh(keep) {
      const q = input.value;
      const keepKey = keep && results[sel] ? results[sel].kind + results[sel].title + (results[sel].url || '') : null;
      const entries = buildEntries(q);
      const pfx = prefixOf(q);
      const body = pfx ? q.slice(1).trim() : q;
      if (mode || q.startsWith('+') || q.startsWith('>')) {
        results = entries.filter((e) => e.always || !q.trim() || score(q, { ...e, base: 0 }) >= 0);
        if (mode && !results.length) results = [];
      } else {
        results = entries
          .map((e) => ({ e, s: e.always ? e.base + 1 : score(body, e) }))
          .filter((x) => x.s >= 0 || x.e.always)
          .sort((a, b) => b.s - a.s)
          .slice(0, 50)
          .map((x) => x.e);
      }
      sel = 0;
      if (keepKey) {
        const k = results.findIndex((e) => e.kind + e.title + (e.url || '') === keepKey);
        if (k >= 0) sel = k;
      }
      draw();
    }

    function draw() {
      list.replaceChildren();
      if (!results.length) {
        list.append(el('div', 'empty', 'No matches'));
        return;
      }
      results.forEach((e, i) => {
        const row = el('div', 'row' + (i === sel ? ' sel' : ''));
        const fav = el('span', 'fav');
        if (e.iconColor) fav.style.background = e.iconColor;
        const srcs = [];
        if (e.url && /^https?:/.test(e.url)) srcs.push(`${chrome.runtime.getURL('/_favicon/')}?pageUrl=${encodeURIComponent(e.url)}&size=32`);
        if (e.favicon) srcs.push(e.favicon);
        if (srcs.length) {
          const img = el('img');
          let k = 0;
          img.src = srcs[0];
          img.onerror = () => {
            if (++k < srcs.length) img.src = srcs[k];
            else {
              img.remove();
              fav.textContent = (e.title || '?')[0].toUpperCase();
            }
          };
          fav.append(img);
        } else fav.textContent = e.icon || (e.title || '?')[0].toUpperCase();
        const txt = el('div', 'txt');
        txt.append(el('div', 't', e.title));
        if (e.sub) txt.append(el('div', 's', e.sub));
        row.append(fav, txt);
        if (e.tag) row.append(el('span', 'tag', e.tag));
        row.append(el('span', 'kind', e.kind));
        row.addEventListener('mousemove', () => {
          if (sel !== i) {
            list.children[sel]?.classList.remove('sel');
            sel = i;
            row.classList.add('sel');
          }
        });
        row.addEventListener('click', (ev) => e.run({ shift: ev.shiftKey }));
        list.append(row);
      });
      list.children[sel]?.scrollIntoView({ block: 'nearest' });
    }

    function move(d) {
      if (!results.length) return;
      list.children[sel]?.classList.remove('sel');
      sel = (sel + d + results.length) % results.length;
      list.children[sel]?.classList.add('sel');
      list.children[sel]?.scrollIntoView({ block: 'nearest' });
    }

    let suggTimer;
    let suggFor = '';
    input.addEventListener('input', () => {
      const q0 = input.value.trim();
      const pf = prefixOf(q0);
      const q = pf ? q0.slice(1).trim() : q0;
      if (!suggFor || !q.startsWith(suggFor)) sugg = [];
      refresh();
      clearTimeout(suggTimer);
      if (mode || q0.startsWith('+') || q0.startsWith('>') || q.length < (pf ? 1 : 2) || (pf && pf !== '#' && pf !== '!')) return;
      suggTimer = setTimeout(async () => {
        try {
          const r = await send('suggest', { q, only: pf === '#' ? 'bookmark' : pf === '!' ? 'history' : undefined });
          if (input.value.trim() !== q0) return; // typed on since
          sugg = r;
          suggFor = q;
          refresh(true);
        } catch {}
      }, 120);
    });
    scrim.addEventListener('mousedown', (e) => {
      if (e.target === scrim) done();
    });
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (mode) go(null);
        else done();
      } else if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) {
        e.preventDefault();
        move(1);
      } else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')) {
        e.preventDefault();
        move(-1);
      } else if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        // Shift+Enter: search the web (or open the typed URL) in a new tab, whatever row is highlighted
        if (e.shiftKey && !mode && webEntry) webEntry.run();
        else results[sel]?.run({ shift: e.shiftKey });
      }
    };
    root.addEventListener('keydown', onKey);

    input.focus();
    send('paletteData')
      .then((d) => {
        data = d;
        if (d.scheme === 'light' || d.scheme === 'dark') scrim.dataset.theme = d.scheme;
        const cs = d.spaces.find((s) => s.current);
        if (cs) {
          spaceChip.hidden = false;
          const dot = el('i');
          dot.style.background = COLORS[cs.color] || '#999';
          spaceChip.replaceChildren(dot, `${cs.emoji} ${cs.name}`);
          input.placeholder = `Search tabs, switch spaces, or type a URL…`;
        }
        refresh();
      })
      .catch(() => {
        list.replaceChildren(el('div', 'empty', 'Could not load tabs'));
      });
    return { focus: () => input.focus(), onKey };
  };
})();
