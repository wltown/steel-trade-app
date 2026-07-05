// Service Worker for 废钢管理系统 PWA
// Provides offline caching for the mobile app
var CACHE = 'steel-v1';
var URLS = [
  'mobile.html',
  'sync.js',
  'manifest.json',
  'index.html'
];

self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE).then(function(cache) {
      return cache.addAll(URLS).catch(function() {});
    })
  );
});

self.addEventListener('fetch', function(e) {
  // Only cache GET requests, skip API calls
  if (e.request.method !== 'GET') return;
  if (e.request.url.includes('api.github.com')) return;

  e.respondWith(
    caches.match(e.request).then(function(cached) {
      var fetched = fetch(e.request).then(function(response) {
        if (response && response.status === 200) {
          var clone = response.clone();
          caches.open(CACHE).then(function(cache) {
            cache.put(e.request, clone);
          });
        }
        return response;
      }).catch(function() {
        return cached || new Response('Offline', { status: 503 });
      });
      return cached || fetched;
    })
  );
});
