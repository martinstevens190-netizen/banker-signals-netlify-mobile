self.addEventListener('install', (event) => {
  event.waitUntil(caches.open('banker-signals-live-v1').then((cache) => cache.addAll([
    '/', '/index.html', '/styles.css', '/app.js', '/manifest.json', '/icons/icon-192.png', '/icons/icon-512.png'
  ])));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});

self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : { title: 'Banker Signals Live', body: 'New betting alert ready.', url: '/' };
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: data.url || '/' }
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientsList) => {
    for (const client of clientsList) {
      if ('focus' in client) return client.focus();
    }
    if (clients.openWindow) return clients.openWindow(targetUrl);
  }));
});
