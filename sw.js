// Service Worker for 废钢管理系统
// Minimal SW to enable PWA install on Chrome Android
var CACHE = 'steel-v3';
var URLS = [
  '/steel-trade-app/mobile.html',
  '/steel-trade-app/sync.js',
  '/steel-trade-app/manifest.json',
  '/steel-trade-app/icon-192.png',
  '/steel-trade-app/icon-512.png'
];

self.addEventListener('install', function(e) {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(function(cache) {
      return Promise.all(URLS.map(function(url) {
        return fetch(url, {cache: 'reload'}).then(function(r) {
          if (r.ok) return cache.put(url, r);
        }).catch(function() {});
      }));
    })
  );
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.map(function(k) {
        if (k !== CACHE) return caches.delete(k);
      }));
    }).then(function() { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function(e) {
  if (e.request.method !== 'GET') return;
  if (e.request.url.indexOf('api.github.com') !== -1) return;
  e.respondWith(
    caches.match(e.request).then(function(r) {
      return r || fetch(e.request).then(function(resp) {
        if (resp && resp.status === 200) {
          var clone = resp.clone();
          caches.open(CACHE).then(function(c) { c.put(e.request, clone); });
        }
        return resp;
      });
    })
  );
});
