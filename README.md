# Orbit

Arc-style spaces and a command palette for Brave, built on tab groups. Brave stays untouched, so it keeps its own updates and security.

Install: brave://extensions -> enable Developer mode -> Load unpacked -> pick this folder.
Turn on vertical tabs once in brave://settings/appearance (or right-click the tab strip -> "Use vertical tab strip"). Extensions can't change browser settings, so Orbit opens that page on first install and has a palette command for it.

- **Command palette:** Cmd+Shift+K (Ctrl+Shift+K elsewhere). Follows the browser's light/dark preference (palette → "Theme" to force light or dark). Fuzzy-search every tab (plus matching bookmarks and your most-visited history, like the address bar) across all spaces, switch spaces, or type a URL or search. Enter opens in a new tab, Shift+Enter in the current one. `+ 🔬 Name` creates a space, and `> name` moves the current tab to that space. Other prefixes narrow the list: `@` open tabs, `/` spaces, `:` commands, `~` browser pages, `#` bookmarks, `!` history, `?` web search. Commands include: duplicate, reload, mute, zoom, print, view source, close duplicate tabs, sleep other tabs, copy link as Markdown / all links in the space, bookmark all tabs in the space, reopen closed tab, new window, fullscreen, check for Brave updates, relaunch Brave, reload Orbit, bookmark / remove bookmark for this page, manage extensions (enable, disable, options, uninstall), new tab, copy link, pin/unpin, close tab, next/previous space, move tab to a space. On brave:// pages and the new tab page it opens as a small centred window instead of an overlay.
- **Cmd+T opens the palette over the page you're on.** Extensions can't rebind Cmd+T itself (it's a reserved browser key), so Orbit replaces the New Tab page: when it loads, Orbit switches straight back to your previous tab and draws the palette over it (a brief flicker). Esc or a click outside returns you to the page. On pages that can't host an overlay (brave://, web store) or with no previous tab, the palette shows in the new tab instead. Brave may need New Tab Page set to its default in brave://settings/newTab for the override to apply.
- Clicking the toolbar icon opens the palette (it shows which space you're in). Rename, recolour or delete spaces via "Manage spaces…" in the palette.
- Switching spaces hides the others completely: their tabs (name, icon, URL) are saved, backed up and closed, then relaunched from the saved list when you switch back. Page state (scroll, unsent forms, playing media) isn't kept. Extensions can't hide a tab group, only collapse it, so closing is the only way to remove a space from the sidebar.
- Each space = a tab group named "<emoji> <name>". Switching expands that space and collapses the others.
- Pinned tabs are per space: pin a tab (browser menu or the 📌 button) and it belongs to that space; switching swaps the pinned tabs.
- Right-click a page -> "Move tab to space", or use "Move tab to…" in the palette.
- Cmd+Shift+, / Cmd+Shift+. (Ctrl+Shift elsewhere): previous/next space. Change the keys at brave://extensions/shortcuts.
- Existing tab groups are auto-detected as spaces Clicking a tab in another space's group in the sidebar switches to that space and loads its pinned tabs.
- The toolbar icon shows the active space's emoji.
- New tabs (Cmd+T, links) are automatically added to the active space.
- Cmd+Shift+X (Ctrl+Shift+X elsewhere) copies the current tab's link; there's also a 🔗 button in the popup. Change the key at brave://extensions/shortcuts.
- Shift+Space then `,` / `.` still works as an extra chord on normal web pages (not brave:// pages or text fields).
- The pop-out button opens the list in a small floating window you can park beside your tabs.

## License

MIT, see [LICENSE](LICENSE). Icons are regenerated with `python3 tools/make-icons.py` (needs Pillow).
