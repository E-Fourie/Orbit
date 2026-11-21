# Orbit

Arc-style spaces and a command palette for Brave, built on tab groups. Brave stays untouched, so it keeps its own updates and security.

Install: brave://extensions -> enable Developer mode -> Load unpacked -> pick this folder.

- **Command palette:** Cmd+Shift+K (Ctrl+Shift+K elsewhere). Fuzzy-search every tab across all spaces, switch spaces, or type a URL or search. Enter opens in a new tab, Shift+Enter in the current one. `+ 🔬 Name` creates a space. Commands: new tab, copy link, pin/unpin, close tab, next/previous space, move tab to a space. On brave:// pages and the new tab page it opens as a small centred window instead of an overlay.
- Each space = a tab group named "<emoji> <name>". Switching expands that space and collapses the others.
- Pinned tabs are per space: pin a tab (browser menu or the 📌 button) and it belongs to that space; switching swaps the pinned tabs.
- Right-click a page -> "Move tab to space", or use the arrow button in the popup.
- Cmd+Shift+, / Cmd+Shift+. (Ctrl+Shift elsewhere): previous/next space. Change the keys at brave://extensions/shortcuts.
- Folders live inside each space and are real tab groups (titled "<space> › <folder>"), so they appear as collapsible entries in the vertical sidebar. In the popup, use "＋ folder" in the current space and the dropdown on a tab to file it. Collapsing a folder in the sidebar is remembered.
- Existing tab groups are auto-detected as spaces (a group titled "<space> › <name>" becomes a folder of that space). Clicking a tab in another space's group in the sidebar switches to that space and loads its pinned tabs.
- The toolbar icon shows the active space's emoji.
- New tabs (Cmd+T, links) are automatically added to the active space.
- Cmd+Shift+X (Ctrl+Shift+X elsewhere) copies the current tab's link; there's also a 🔗 button in the popup. Change the key at brave://extensions/shortcuts.
- The popup has no default shortcut (Chrome allows only 4 suggested keys); bind "Open the Orbit popup" at brave://extensions/shortcuts if you want one.
- Shift+Space then `,` / `.` still works as an extra chord on normal web pages (not brave:// pages or text fields).
- The pop-out button opens the list in a small floating window you can park beside your tabs.

## License

MIT, see [LICENSE](LICENSE). Icons are regenerated with `python3 tools/make-icons.py` (needs Pillow).
