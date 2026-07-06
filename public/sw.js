const CACHE_NAME = 'blissful-faraday-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll([
        '/',
        '/manifest.json',
        '/icon.svg'
      ]).catch(err => {
        console.warn('Caching initial assets failed: ', err);
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // Only intercept HTTP/HTTPS GET requests (bypass POST/PUT/DELETE and chrome-extension://, data:, etc.)
  if (event.request.method !== 'GET' || (url.protocol !== 'http:' && url.protocol !== 'https:')) {
    return;
  }

  // Bypassing caching for all local scanner API requests to ensure real-time photo list and settings syncing
  if (url.pathname.includes('/api/')) {
    return;
  }

  // Use a Network-first falling back to Cache strategy for static assets
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response && response.status === 200 && response.type === 'basic') {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache).catch((err) => {
              console.warn('Caching failed for request:', event.request.url, err);
            });
          });
        }
        return response;
      })
      .catch(() => {
        return caches.match(event.request);
      })
  );
});
