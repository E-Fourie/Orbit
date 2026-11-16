# Spaces for Brave

Install: brave://extensions -> enable Developer mode -> Load unpacked -> pick this folder.

- Each space = a tab group named "<emoji> <name>". Switching expands that space and collapses the others.
- Pinned tabs are per space: pin a tab (browser menu or the 📌 button) and it belongs to that space; switching swaps the pinned tabs.
- Right-click a page -> "Move tab to space", or use the arrow button in the popup.
- Shift+Space then `,` / `.` (hold Shift+Space, tap the key): previous/next space. Works on normal web pages, not on brave:// pages or inside text fields.
- Folders live inside each space and are real tab groups (titled "<space> › <folder>"), so they appear as collapsible entries in the vertical sidebar. In the popup, use "＋ folder" in the current space and the dropdown on a tab to file it. Collapsing a folder in the sidebar is remembered.
- Existing tab groups are auto-detected as spaces (a group titled "<space> › <name>" becomes a folder of that space). Clicking a tab in another space's group in the sidebar switches to that space and loads its pinned tabs.
- The toolbar icon shows the active space's emoji.
- New tabs (Cmd+T, links) are automatically added to the active space.
- Cmd+Alt+C (Alt+Shift+C elsewhere) copies the current tab's link; there's also a 🔗 button in the popup. Change the key at brave://extensions/shortcuts.
- Fallback shortcuts (change at brave://extensions/shortcuts): Alt+Shift+. / Alt+Shift+, next/prev space; Alt+Shift+S opens the popup.
- The pop-out button opens the list in a small floating window you can park beside your tabs.

## License

MIT, see [LICENSE](LICENSE). Icons are regenerated with `python3 tools/make-icons.py` (needs Pillow).
