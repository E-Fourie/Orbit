// Orbit as the New Tab page: Cmd+T opens the command palette full-page.
// Picking a URL/search navigates this tab; any other choice runs and closes this blank tab.
(async () => {
  const self = await chrome.tabs.getCurrent();
  const closeSelf = async () => {
    const others = await chrome.tabs.query({ windowId: self.windowId });
    if (others.length > 1) chrome.tabs.remove(self.id);
  };
  const why = decodeURIComponent(location.hash.slice(1));
  if (why) {
    const note = document.createElement('div');
    note.textContent = 'Overlay unavailable here: ' + why;
    note.style.cssText = 'position:fixed;bottom:10px;left:0;right:0;text-align:center;font:12px system-ui;opacity:.6;color:#888';
    document.body.append(note);
  }
  window.orbitPalette(document.body, { close: closeSelf, newTab: { tabId: self.id } });
  // Chrome tends to focus the address bar on new tabs; claim focus for the palette.
  const grab = () => document.querySelector('input')?.focus();
  grab();
  setTimeout(grab, 50);
  setTimeout(grab, 250);
})();
