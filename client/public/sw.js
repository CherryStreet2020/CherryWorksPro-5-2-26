self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', async (event) => {
  event.waitUntil(
    (async () => {
      await self.registration.unregister();
      const keys = await caches.keys();
      await Promise.all(keys.map(k => caches.delete(k)));
      await self.clients.claim();
      const allClients = await self.clients.matchAll({ type: 'window' });
      allClients.forEach(client => client.navigate(client.url));
    })()
  );
});
