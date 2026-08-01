// Development mode no-op Service Worker.
// Overrides the stale production SW (from dist/sw.js) that was registered previously.
// This SW does nothing — it just replaces the old one so it stops intercepting requests.
// The cleanup script in index.html will unregister it on next page load.
self.addEventListener('install', () => {
  self.skipWaiting();
});
self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});
