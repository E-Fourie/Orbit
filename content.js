// Shift + Space + , / .  →  previous / next space
// (Browser extension commands can't use Shift+Space chords, so this listens in the page.)
let spaceHeld = false;

const isEditable = (el) =>
  !!el &&
  (el.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));

window.addEventListener(
  'keydown',
  (e) => {
    if (e.code === 'Space') {
      spaceHeld = true;
      // stop Shift+Space (page-up) auto-repeating while you hold it for the chord
      if (e.shiftKey && !isEditable(e.target)) e.preventDefault();
      return;
    }
    if (
      spaceHeld &&
      e.shiftKey &&
      (e.code === 'Comma' || e.code === 'Period') &&
      !isEditable(e.target)
    ) {
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat) return;
      chrome.runtime
        .sendMessage({ type: 'cycle', dir: e.code === 'Period' ? 1 : -1 })
        .catch(() => {});
    }
  },
  true
);

window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') spaceHeld = false;
}, true);
window.addEventListener('blur', () => (spaceHeld = false));
document.addEventListener('visibilitychange', () => (spaceHeld = false));

// Messages from the background: liveness ping and "show the palette here".
chrome.runtime.onMessage.addListener((m, _s, send) => {
  if (m?.type === 'ping') send(true);
  else if (m?.type === 'togglePalette') {
    window.__orbitTogglePalette?.();
    send(true);
  }
});
