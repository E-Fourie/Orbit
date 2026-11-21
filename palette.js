// Defines window.__orbitTogglePalette: shows the palette overlay on this page, or closes it if already showing.
// Loaded as a content script (after palette-core.js) and, as a fallback, injected on demand.
window.__orbitTogglePalette = () => {
  const existing = window.__orbitPaletteHost;
  if (existing?.isConnected) {
    existing.__close();
    return;
  }
  const host = document.createElement('div');
  host.style.cssText = 'all: initial; position: fixed; z-index: 2147483647;';
  const root = host.attachShadow({ mode: 'open' });
  const prevFocus = document.activeElement;
  const close = () => {
    host.remove();
    window.__orbitPaletteHost = null;
    try { prevFocus?.focus?.(); } catch {}
  };
  host.__close = close;
  // keep keystrokes away from the page's own hotkeys
  for (const t of ['keydown', 'keyup', 'keypress']) host.addEventListener(t, (e) => e.stopPropagation());
  (document.documentElement || document.body).append(host);
  window.__orbitPaletteHost = host;
  window.orbitPalette(root, { close });
};
