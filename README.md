# Orbit

Arc-style **spaces** and a **command palette** for Brave, built on native tab groups. Brave itself stays untouched, so it keeps its own updates and security patches.

## Install

1. Open `brave://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and pick this folder.
3. Turn on vertical tabs once: `brave://settings/appearance`, or right-click the tab strip and choose **Use vertical tab strip**.

Extensions can't change browser settings, so Orbit opens that settings page on first install, and the palette has a command for it later.

## Quick reference

| Key (macOS / elsewhere) | Action |
| --- | --- |
| `Cmd+Shift+K` / `Ctrl+Shift+K` | Open the command palette |
| `Cmd+T` | Palette over the current page (see [below](#cmdt-opens-the-palette)) |
| `Cmd+Shift+.` / `Cmd+Shift+,` | Next / previous space |
| `Cmd+Shift+X` / `Ctrl+Shift+X` | Copy the current tab's link |
| `Shift+Space`, then `,` or `.` | Extra chord for previous / next space (normal web pages only) |

Rebind any of these at `brave://extensions/shortcuts`.

## Command palette

Fuzzy-search every tab across all spaces, plus matching bookmarks and your most-visited history (like the address bar). You can also switch spaces, run commands, or type a URL or search.

- **Enter** runs the highlighted row.
- **Shift+Enter** always searches the web (or opens the typed URL) in a new tab.
- **Esc** or a click outside closes it.
- It follows the browser's light/dark preference. Use the **Theme** command to force light or dark.

### Prefixes

Start your query with a prefix to narrow the list.

| Prefix | Shows / does |
| --- | --- |
| `@` | Open tabs |
| `/` | Spaces |
| `:` | Commands |
| `~` | Browser pages (`brave://…`) |
| `#` | Bookmarks |
| `!` | History |
| `?` | Web search |
| `+ 🔬 Name` | Create a space with that emoji and name |
| `> name` | Move the current tab to that space |

### Commands

- **Tabs:** new tab, duplicate, reload, mute, zoom, pin / unpin, close, reopen closed tab, close duplicate tabs, sleep other tabs
- **Page:** print, view source, copy link, copy link as Markdown, bookmark / remove bookmark for this page
- **Spaces:** next / previous space, move tab to a space, copy all links in the space, bookmark all tabs in the space, manage spaces
- **Browser:** new window, fullscreen, check for Brave updates, relaunch Brave, vertical tabs setting
- **Extensions:** enable, disable, options, uninstall, reload Orbit

On `brave://` pages and the new tab page, the palette opens as a small centred window instead of an overlay.

### Cmd+T opens the palette

Extensions can't rebind `Cmd+T` (it's a reserved browser key), so Orbit replaces the New Tab page. When it loads, Orbit switches straight back to your previous tab and draws the palette over it, with a brief flicker. Esc or a click outside returns you to the page.

On pages that can't host an overlay (`brave://`, the web store), or when there's no previous tab, the palette shows in the new tab instead. Brave may need **New Tab Page** set to its default in `brave://settings/newTab` for the override to apply.

## Spaces

Each space is a tab group named `<emoji> <name>`.

- **Switching** expands the chosen space and collapses the others. New tabs (`Cmd+T`, links) are added to the active space automatically.
- **Existing tab groups** are auto-detected as spaces. Clicking a tab in another space's group in the sidebar switches to that space.
- **Pinned tabs are per space.** Pin a tab (browser menu or the 📌 button) and it belongs to that space. Switching swaps the pinned tabs.
- **Moving tabs:** right-click a page and choose **Move tab to space**, or use **Move tab to…** in the palette.
- **Managing:** rename, recolour or delete spaces via **Manage spaces…** in the palette.
- **Toolbar icon** shows the active space's emoji. Clicking it opens the palette.
- The popup's pop-out button opens the list in a small floating window you can park beside your tabs.

### What switching does to inactive spaces

Extensions can't hide a tab group, only collapse it, so Orbit removes inactive spaces from the sidebar by closing them. Their tabs (name, icon, URL) are saved, backed up, and relaunched from the saved list when you switch back.

**Page state isn't kept:** scroll position, unsent forms and playing media are lost.

## Permissions

Orbit asks for broad permissions because the palette runs on every page and manages tabs, bookmarks and history.

| Permission | Used for |
| --- | --- |
| `tabs`, `tabGroups`, `sessions` | Spaces, tab search, reopening closed tabs |
| `bookmarks`, `history` | Palette suggestions and bookmark commands |
| `storage` | Saving space contents and backups |
| `scripting`, `activeTab`, `<all_urls>` | Drawing the palette overlay on pages |
| `contextMenus` | "Move tab to space" |
| `management` | Extension commands in the palette |
| `search` | Web search from the palette |
| `favicon`, `offscreen` | Icons and clipboard access |

## Development

Plain JavaScript, no build step. Edit a file, then run **Reload Orbit** from the palette (or click reload on `brave://extensions`).

| File | Role |
| --- | --- |
| `background.js` | Service worker: spaces, shortcuts, commands |
| `palette-core.js`, `palette.js` | Palette UI and logic |
| `content.js` | Content script that hosts the overlay |
| `newtab.*`, `newtab-redirect.js` | New Tab override for `Cmd+T` |
| `offscreen.*` | Offscreen document for clipboard |

Regenerate icons with `python3 tools/make-icons.py` (needs Pillow).

## License

MIT, see [LICENSE](LICENSE).
