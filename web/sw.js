// Hace la web instalable y deja abrirla sin conexión: la página y sus archivos salen de la red si se puede y, si no,
// de la caché. Los datos (/api/) no pasan por aquí: la página guarda los últimos en el aparato.
const CACHE = 'panel-1';
const ARCHIVOS = ['/', '/manifest.webmanifest', '/icon-192.png', '/apple-touch-icon.png',
  ...[300, 400, 500, 600, 700].map((p) => `/fuentes/geist-${p}.woff2`)];

self.addEventListener('install', (e) => e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARCHIVOS)).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(
  caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  // Las direcciones con #vista o ?algo son la misma página.
  const clave = e.request.mode === 'navigate' ? '/' : url.pathname;
  e.respondWith(fetch(e.request).then((r) => {
    if (r.ok) { const copia = r.clone(); e.waitUntil(caches.open(CACHE).then((c) => c.put(clave, copia))); }
    return r;
  }).catch(async () => (await caches.match(clave)) ?? Response.error()));
});
