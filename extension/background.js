// Service worker. Minimal for now — the popup talks to the backend directly. Kept so the
// manifest has a background entry and future push/caching logic has a home.
chrome.runtime.onInstalled.addListener(() => {
  console.log('CineMatch installed.');
});
