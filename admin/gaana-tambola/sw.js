/* Gaana Tambola no longer works offline (audio is streamed, nothing is stored on the device).
   This replaces the earlier offline worker: it clears what that worker cached and removes itself. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('gaana-tambola')) await caches.delete(k);
    await self.registration.unregister();
  })());
});
