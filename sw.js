/* Service worker: lets the app install and open quickly. Data always comes live from the backend. */
const CACHE = 'recovery-v2';
const SHELL = ['./', 'index.html', 'styles.css?v=2', 'config.js?v=1', 'app.js?v=2', 'manifest.webmanifest',
  'assets/gst-mark-light.png', 'assets/gst-mark.png', 'assets/gst-lockup-tagline.png', 'assets/icon-192.png', 'assets/favicon-48.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Same-site files: try the network first (so updates show at once), fall back to the saved copy when offline.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request).then((r) => r || caches.match('index.html')))
  );
});
