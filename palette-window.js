// Standalone palette window: used on pages we can't inject into (brave://, new tab page, web store, PDFs).
let focused = false;
window.addEventListener('focus', () => (focused = true));
// Close when the user clicks away, but only once the window has actually had focus.
window.addEventListener('blur', () => {
  if (focused) setTimeout(() => window.close(), 150);
});
window.orbitPalette(document.body, { close: () => window.close() });
