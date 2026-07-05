// Service Worker - 废钢管理系统 PWA
// Enables "Add to Home Screen" and offline access
var CACHE_NAME = 'steel-v2';
var FILES = [
  '/steel-trade-app/mobile.html',
  '/steel-trade-app/sync.js',
  '/steel-trade-app/manifest.json'
];

self.addEventListener('install', function(e) {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return Promise.allSettled(FILES.map(function(url) {
        return fetch(url, {cache: 'reload'}).then(function(resp) {
          if (resp.ok) return cache.put(url, resp);
        }).catch(function() {});
      }));
    })
  );
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.filter(function(k) { return k !== CACHE_NAME; }).map(function(k) { return caches.delete(k); }));
    }).then(function() {
      return self.clients.claim();
    })
  );
});

self.addEventListener('fetch', function(e) {
  if (e.request.method !== 'GET') return;
  if (e.request.url.includes('api.github.com')) return;
  e.respondWith(
    caches.match(e.request).then(function(cached) {
      var networkFetch = fetch(e.request).then(function(resp) {
        if (resp && resp.ok) {
          var clone = resp.clone();
          caches.open(CACHE_NAME).then(function(cache) { cache.put(e.request, clone); });
        }
        return resp;
      });
      return cached || networkFetch;
    })
  );
});
