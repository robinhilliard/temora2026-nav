// sw.js — service worker. Precaches the app shell so the iPad keeps working
// when you fly out of cell range.

const VERSION = 'bobnav-v8';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './nav.js',
  './geo.js',
  './wake.js',
  './flash.js',
  './route.js',
  './quiz.js',
  './manifest.webmanifest',
  './assets/yankee.jpg',
  './assets/recon-page8.jpg',
  './assets/recon-page9.jpg',
  './assets/icon-192.png',
  './assets/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION).then((cache) =>
      Promise.all(SHELL.map((url) =>
        cache.add(url).catch(() => null) // ignore individual failures (e.g. missing optional assets)
      ))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return;
  event.respondWith(
    caches.match(event.request).then((cached) =>
      cached || fetch(event.request).then((res) => {
        if (res.ok && event.request.method === 'GET') {
          const clone = res.clone();
          caches.open(VERSION).then((c) => c.put(event.request, clone));
        }
        return res;
      }).catch(() => cached)
    )
  );
});
