// 6SEG SCRIPT v0.3.8 intentionally disables old cache-first service workers.
self.addEventListener('install', event => { self.skipWaiting(); });
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(key => caches.delete(key)));
    await self.registration.unregister();
    const clientsList = await self.clients.matchAll({ type: 'window' });
    for (const client of clientsList) client.navigate(client.url);
  })());
});
self.addEventListener('fetch', event => { event.respondWith(fetch(event.request)); });
