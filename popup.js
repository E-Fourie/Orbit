const $ = (s) => document.querySelector(s);
const COLORS = {
  grey: '#5f6368', blue: '#1a73e8', red: '#d93025', yellow: '#f9ab00', green: '#188038',
  pink: '#d01884', purple: '#9334e6', cyan: '#007b83', orange: '#e8710a',
};
const DEFAULT_EMOJIS = ['💼', '🏠', '🔬', '📚', '🎮', '💡', '🛒', '🎵'];
const isPopout = location.search.includes('window');
if (isPopout) document.body.classList.add('popout');

let view = { spaces: [], settings: {} };
let editing = null; // space being edited, or null for new
let color = 'blue';

async function send(type, payload = {}) {
  const r = await chrome.runtime.sendMessage({ type, ...payload });
  if (!r?.ok) {
    toast(r?.error || 'Something went wrong');
    throw new Error(r?.error);
  }
  return r.data;
}
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  setTimeout(() => (t.hidden = true), 4000);
}
function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null) e.append(c);
  return e;
}
const afterAction = () => (isPopout ? refresh() : window.close());

async function refresh() {
  view = await send('getView');
  render();
}

function render() {
  const list = $('#list');
  list.replaceChildren();
  if (!view.spaces.length) {
    list.append(el('p', { class: 'empty' }, 'No spaces yet. Create one and your current tabs will be moved into it.'));
    return;
  }
  const buildCard = (s) => {
    const status = s.current ? '' : s.open ? 'open' : 'saved';
    const n = s.tabs.length + (s.pins?.length || 0);
    const row = el(
      'div',
      { class: 'row', onclick: async () => { await send('switch', { id: s.id }); afterAction(); } },
      el('span', { class: 'emoji' }, s.emoji),
      el('span', { class: 'name' }, s.name),
      el('span', { class: 'meta' }, `${n} tab${n === 1 ? '' : 's'}${status ? ' · ' + status : ''}`),
      s.current
        ? null
        : el('button', {
            title: 'Move current tab here',
            onclick: async (e) => { e.stopPropagation(); await send('moveCurrent', { id: s.id }); afterAction(); },
          }, '↪'),
      el('button', { title: 'Edit space', onclick: (e) => { e.stopPropagation(); openEditor(s); } }, '✎')
    );
    const card = el('div', { class: 'space' + (s.current ? ' current' : ''), style: `--c:${COLORS[s.color] || '#999'}` }, row);
    if (s.current) {
      const mk = (t, pinned) =>
        el('div', {
          class: 'tab' + (t.active ? ' active' : ''),
          onclick: () => t.id != null && send('focusTab', { tabId: t.id }).then(afterAction),
        },
          t.favIconUrl
            ? el('img', { src: t.favIconUrl, onerror: (e) => e.target.replaceWith(el('span', { class: 'ph' })) })
            : el('span', { class: 'ph' }),
          el('span', { class: 'title' }, t.title || t.url || 'New tab'),
          t.id != null
            ? el('button', { class: 'x', title: pinned ? 'Unpin' : 'Pin in this space',
                onclick: (e) => { e.stopPropagation(); send('togglePin', { tabId: t.id }); } }, pinned ? '📍' : '📌')
            : null,
          t.id != null
            ? el('button', { class: 'x', title: 'Close tab',
                onclick: (e) => { e.stopPropagation(); send('closeTab', { tabId: t.id }); } }, '×')
            : null
        );
      const pins = s.pins || [];
      const folders = s.folders || [];
      const mkTab = (t, pinned) => {
        const row = mk(t, pinned);
        if (!pinned && t.id != null && folders.length) {
          const sel = el('select', { class: 'fsel', title: 'Move to folder', onclick: (e) => e.stopPropagation(),
            onchange: (e) => send('setTabFolder', { tabId: t.id, folderId: e.target.value || null }).then(refresh) },
            el('option', { value: '' }, '—'), ...folders.map((f) => el('option', { value: f.id }, f.name)));
          sel.value = t.folderId || '';
          row.insertBefore(sel, row.querySelector('.x'));
        }
        return row;
      };
      const loose = s.tabs.filter((t) => !folders.some((f) => f.id === t.folderId));
      const kids = [];
      if (pins.length) kids.push(el('div', { class: 'sect' }, 'Pinned'), ...pins.map((t) => mk(t, true)));
      kids.push(el('div', { class: 'sect sect-row' }, 'Tabs',
        el('button', { class: 'mini', title: 'New folder in this space', onclick: () => openFolderEditor(null, s.id) }, '＋ folder')));
      for (const f of folders) {
        const inF = s.tabs.filter((t) => t.folderId === f.id);
        const open = !f.collapsed;
        kids.push(el('div', { class: 'folder' },
          el('div', { class: 'folder-head', onclick: () => send('updateFolder', { spaceId: s.id, id: f.id, patch: { collapsed: open } }).then(refresh) },
            el('span', { class: 'caret' }, open ? '▼' : '▶'),
            el('span', { class: 'fname' }, '📁 ' + f.name),
            el('span', { class: 'meta' }, String(inF.length)),
            el('button', { title: 'Edit folder', onclick: (e) => { e.stopPropagation(); openFolderEditor(f, s.id); } }, '✎')),
          open ? el('div', { class: 'folder-body' }, inF.length ? inF.map((t) => mkTab(t, false)) : el('div', { class: 'none' }, 'Empty — use the dropdown on a tab to add it')) : null));
      }
      kids.push(...(loose.length ? loose.map((t) => mkTab(t, false)) : folders.length ? [] : [el('div', { class: 'none' }, 'No tabs')]));
      card.append(el('div', { class: 'tabs' }, kids));
    }
    return card;
  };
  for (const s of view.spaces) list.append(buildCard(s));
}

// ----- editor -----
function renderSwatches() {
  const box = $('#swatches');
  box.replaceChildren();
  for (const [name, hex] of Object.entries(COLORS)) {
    box.append(el('button', {
      type: 'button', title: name, class: 'sw' + (name === color ? ' sel' : ''), style: `background:${hex}`,
      onclick: () => { color = name; renderSwatches(); },
    }));
  }
}
function openEditor(space) {
  editing = space || null;
  $('#edTitle').textContent = space ? 'Edit space' : 'New space';
  $('#edName').value = space?.name || '';
  $('#edEmoji').value = space?.emoji || DEFAULT_EMOJIS[view.spaces.length % DEFAULT_EMOJIS.length];
  color = space?.color || 'cyan';
  $('#edDanger').hidden = !space;
  renderSwatches();
  $('#editor').hidden = false;
  $('.addrow').hidden = true;
  $('#edName').focus();
}
function closeEditor() {
  editing = null;
  $('#editor').hidden = true;
  $('.addrow').hidden = false;
}

$('#add').addEventListener('click', () => openEditor(null));

// ----- folder editor -----
let editingFolder = null;
let folderSpace = null;
function openFolderEditor(f, spaceId) {
  editingFolder = f || null;
  folderSpace = spaceId;
  $('#fdTitle').textContent = f ? 'Edit folder' : 'New folder';
  $('#fdName').value = f?.name || '';
  $('#fdDanger').hidden = !f;
  $('#folderEditor').hidden = false;
  $('.addrow').hidden = true;
  $('#fdName').focus();
}
function closeFolderEditor() {
  editingFolder = null;
  $('#folderEditor').hidden = true;
  $('.addrow').hidden = false;
}
$('#fdCancel').addEventListener('click', closeFolderEditor);
$('#folderEditor').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('#fdName').value;
  if (editingFolder) await send('updateFolder', { spaceId: folderSpace, id: editingFolder.id, patch: { name } });
  else await send('createFolder', { spaceId: folderSpace, name });
  closeFolderEditor();
  refresh();
});
$('#fdDelete').addEventListener('click', async () => {
  const id = editingFolder.id; closeFolderEditor();
  await send('deleteFolder', { spaceId: folderSpace, id });
  refresh();
});
$('#edCancel').addEventListener('click', closeEditor);
$('#editor').addEventListener('submit', async (e) => {
  e.preventDefault();
  const data = { name: $('#edName').value, emoji: $('#edEmoji').value, color };
  if (editing) await send('update', { id: editing.id, patch: data });
  else await send('create', { space: data });
  closeEditor();
  if (editing === null && !isPopout) window.close();
  else refresh();
});
$('#edDelKeep').addEventListener('click', async () => {
  const id = editing.id; closeEditor();
  await send('delete', { id, closeTabs: false });
  refresh();
});
$('#edDelClose').addEventListener('click', async () => {
  const id = editing.id; closeEditor();
  await send('delete', { id, closeTabs: true });
  refresh();
});

// ----- header buttons -----
$('#popout').addEventListener('click', async () => {
  await chrome.windows.create({ url: chrome.runtime.getURL('popup.html?window'), type: 'popup', width: 340, height: 640 });
  window.close();
});
if (isPopout) $('#popout').hidden = true;

// ----- live refresh -----
let t;
const later = () => { clearTimeout(t); t = setTimeout(refresh, 250); };
[
  chrome.tabs.onCreated, chrome.tabs.onUpdated, chrome.tabs.onRemoved, chrome.tabs.onMoved,
  chrome.tabs.onActivated, chrome.tabs.onAttached, chrome.tabs.onDetached,
  chrome.tabGroups.onUpdated, chrome.tabGroups.onRemoved, chrome.tabGroups.onCreated,
].forEach((ev) => ev.addListener(later));
chrome.storage.onChanged.addListener(later);

refresh();
