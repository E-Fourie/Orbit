// Injected into the active page by the "open-palette" command (after palette-core.js).
// Runs again on each press: if the palette is already showing, it toggles it closed.
(() => {
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
})();
