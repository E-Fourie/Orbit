# Spaces for Brave

Install: brave://extensions -> enable Developer mode -> Load unpacked -> pick this folder.

- Each space = a tab group named "<emoji> <name>". Switching expands that space and collapses the others.
- Settings (gear): "Suspend inactive spaces" closes other spaces' tabs and restores them on switch.
- Pinned tabs are per space: pin a tab (browser menu or the 📌 button) and it belongs to that space; switching swaps the pinned tabs.
- Right-click a page -> "Move tab to space", or use the arrow button in the popup.
- Shift+Space then `,` / `.` (hold Shift+Space, tap the key): previous/next space. Works on normal web pages, not on brave:// pages or inside text fields.
- Folders: "New folder" in the popup, then pick a folder in a space's editor (✎). Shortcut switching follows list order (folders first, then ungrouped spaces).
- Fallback shortcuts (change at brave://extensions/shortcuts): Alt+Shift+. / Alt+Shift+, next/prev space; Alt+Shift+S opens the popup.
- The pop-out button opens the list in a small floating window you can park beside your tabs.

## License

MIT, see [LICENSE](LICENSE). Icons are regenerated with `python3 tools/make-icons.py` (needs Pillow).
