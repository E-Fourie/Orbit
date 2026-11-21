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
  color: var(--fg);
}
@media (prefers-color-scheme: dark) {
  .scrim { --bg: #1f2126; --fg: #ececf0; --dim: #9aa0aa; --line: rgba(255,255,255,.09); --sel: rgba(152,198,195,.20); --accent: #98c6c3; --chip: rgba(255,255,255,.09); }
}
.box { width: min(640px, 92vw); max-height: 70vh; display: flex; flex-direction: column; background: var(--bg);
  border-radius: 14px; box-shadow: 0 24px 70px rgba(0,0,0,.35), 0 0 0 1px var(--line); overflow: hidden; }
.in { display: flex; align-items: center; gap: 10px; padding: 14px 16px; border-bottom: 1px solid var(--line); }
.in .ico { font-size: 16px; opacity: .6; }
input { all: unset; flex: 1; font-size: 17px; color: var(--fg); min-width: 0; }
input::placeholder { color: var(--dim); }
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

  const EMOJI_RE = /^(\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*)\s*/u;

  function looksLikeUrl(q) {
    if (/\s/.test(q)) return null;
    if (/^[a-z][a-z0-9+.-]*:\/\/\S+$/i.test(q)) return q;
    if (/^(localhost|(\d{1,3}\.){3}\d{1,3})(:\d+)?(\/\S*)?$/i.test(q)) return 'http://' + q;
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

  window.orbitPalette = function mount(root, { close }) {
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
    input.placeholder = 'Search tabs, switch spaces, run a command, or type a URL…';
    input.spellcheck = false;
    input.autocomplete = 'off';
    inRow.append(input);
    const list = el('div', 'list');
    const foot = el('div', 'foot');
    for (const [k, v] of [['↑↓', 'move'], ['↵', 'select'], ['⇧↵', 'open in this tab'], ['+ name', 'new space'], ['esc', 'close']]) {
      const s = el('span');
      s.append(el('b', null, k), ' ' + v);
      foot.append(s);
    }
    box.append(inRow, list, foot);
    scrim.append(box);
    root.append(style, scrim);

    let data = { spaces: [], cur: null };
    let results = [];
    let sel = 0;

    const done = () => close();
    const act = (fn) => async (mods) => {
      try {
        await fn(mods);
      } catch (e) {
        console.warn('[Orbit]', e);
      }
      done();
    };

    function buildEntries(q) {
      const out = [];
      const { spaces, cur } = data;
      const curSpace = spaces.find((s) => s.current);
      const sName = (s) => `${s.emoji} ${s.name}`;

      // "+ Name" creates a space
      if (q.startsWith('+')) {
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
          base: s.current ? 30 : 10,
          run: act(() => (t.id != null ? send('focusTab', { tabId: t.id }) : send('switch', { id: s.id }))),
        });
        for (const t of s.pins || []) out.push(mk(t, true));
        for (const t of s.tabs || []) out.push(mk(t, false));
        if (!s.current) {
          out.push({
            kind: 'Space', title: `Switch to ${sName(s)}`, sub: `${(s.tabs?.length || 0) + (s.pins?.length || 0)} tabs`,
            icon: s.emoji, base: 25, run: act(() => send('switch', { id: s.id })),
          });
        }
      }

      const cmd = (title, sub, icon, run, base = 20) => out.push({ kind: 'Command', title, sub, icon, base, run: act(run) });
      cmd('New tab', curSpace ? `In ${sName(curSpace)}` : '', '＋', () => send('openUrl', { url: null }), 22);
      cmd('Copy link', cur?.url ? hostOf(cur.url) : 'Current tab', '🔗', () => send('copyLink'), 21);
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
      cmd('New space', 'Type + followed by a name', '＋', () => send('openUrl', { url: null }), 5);
      out[out.length - 1].keepOpen = true;
      out[out.length - 1].run = async () => {
        input.value = '+';
        input.dispatchEvent(new Event('input'));
      };

      // Open as URL / search the web
      const text = q.trim();
      if (text) {
        const url = looksLikeUrl(text);
        out.push({
          kind: url ? 'Open' : 'Search', title: url ? url : `Search for “${text}”`, sub: 'Enter: new tab · Shift+Enter: this tab',
          icon: url ? '🌐' : '🔍', base: url ? 500 : -1, always: true,
          run: act((mods) => send(url ? 'openUrl' : 'search', { url, text, current: !!mods?.shift })),
        });
      }
      return out;
    }

    function refresh() {
      const q = input.value;
      const entries = buildEntries(q);
      if (q.startsWith('+')) {
        results = entries;
      } else {
        results = entries
          .map((e) => ({ e, s: e.always ? e.base + 1 : score(q, e) }))
          .filter((x) => x.s >= 0 || x.e.always)
          .sort((a, b) => b.s - a.s)
          .slice(0, 50)
          .map((x) => x.e);
      }
      sel = 0;
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
        if (e.favicon) {
          const img = el('img');
          img.src = e.favicon;
          img.onerror = () => {
            img.remove();
            fav.textContent = (e.title || '?')[0].toUpperCase();
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

    input.addEventListener('input', refresh);
    scrim.addEventListener('mousedown', (e) => {
      if (e.target === scrim) done();
    });
    root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        done();
      } else if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) {
        e.preventDefault();
        move(1);
      } else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')) {
        e.preventDefault();
        move(-1);
      } else if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        results[sel]?.run({ shift: e.shiftKey });
      }
    });

    input.focus();
    send('paletteData')
      .then((d) => {
        data = d;
        refresh();
      })
      .catch(() => {
        list.replaceChildren(el('div', 'empty', 'Could not load tabs'));
      });
    return { focus: () => input.focus() };
  };
})();
