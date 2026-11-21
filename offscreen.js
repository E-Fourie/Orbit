// Offscreen document used to write to the clipboard from the service worker.
chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
  if (msg?.type !== 'offscreen-copy') return;
  const t = document.getElementById('t');
  t.value = msg.text;
  t.select();
  sendResponse({ ok: document.execCommand('copy') });
});

// Reports the browser's light/dark preference as seen from an extension page.
chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
  if (msg?.type !== 'offscreen-theme') return;
  sendResponse({ scheme: matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light' });
});
