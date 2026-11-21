// Cmd+T lands here (New Tab override). Ask the background to return to the previous tab and draw the palette
// over it. If that isn't possible, show the palette in this tab and say why.
const fallback = (reason) =>
  location.replace(chrome.runtime.getURL('palette-tab.html') + (reason ? '#' + encodeURIComponent(reason) : ''));
chrome.runtime
  .sendMessage({ type: 'ntp' })
  .then((r) => { if (r?.data?.fallback !== false) fallback(r?.data?.reason || r?.error || 'no response'); })
  .catch((e) => fallback(String(e?.message || e)));
