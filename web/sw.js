// Hace la web instalable. Sin caché: los datos siempre llegan de /api/panel.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  if (e.request.mode !== 'navigate') return;
  e.respondWith(fetch(e.request).catch(() => new Response('<meta charset=utf-8><p style="font-family:system-ui;padding:16px">Sin conexión. Vuelve a abrir el panel cuando tengas internet.</p>', { headers: { 'content-type': 'text/html; charset=utf-8' } })));
});
