// Offscreen document used to write to the clipboard from the service worker.
chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
  if (msg?.type !== 'offscreen-copy') return;
  const t = document.getElementById('t');
  t.value = msg.text;
  t.select();
  sendResponse({ ok: document.execCommand('copy') });
});
