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
  (document.documentElement || document.body).append(host);
  window.__orbitPaletteHost = host;
  host.__key = window.orbitPalette(root, { close }).onKey;
};

// Keep keystrokes away from the page while the palette is open. Pages like Google listen on window in the
// capture phase and, because the palette's input sits in a shadow root (document.activeElement is just a
// <div>), think nothing is focused and pull the typing into their own search box. Registered at
// document_start so it runs before the page's listeners; it stops the event and hands keydown to the
// palette itself. Default actions (typing into the input) are untouched.
if (!window.__orbitKeyGuard) {
  window.__orbitKeyGuard = true;
  for (const type of ['keydown', 'keyup', 'keypress']) {
    window.addEventListener(type, (e) => {
      const host = window.__orbitPaletteHost;
      if (!host?.isConnected) return;
      e.stopImmediatePropagation();
      if (type === 'keydown') host.__key?.(e);
    }, true);
  }
}
