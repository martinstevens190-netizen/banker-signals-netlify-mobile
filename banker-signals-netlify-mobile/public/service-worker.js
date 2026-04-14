self.addEventListener('install', (event) => {
  event.waitUntil(caches.open('banker-signals-functional-v3').then((cache) => cache.addAll([
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
  const data = event.data ? event.data.json() : { title: 'Banker Signals', body: 'New banker alert ready.', url: '/#alerts', alertId: '' };
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: data.url || '/#alerts', alertId: data.alertId || '' }
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/#alerts';
  const alertId = event.notification.data?.alertId || '';
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clientsList) => {
    for (const client of clientsList) {
      if ('focus' in client) await client.focus();
      if (alertId) {
        client.postMessage({ type: 'OPEN_ALERT', alertId, url: targetUrl });
      }
      if ('navigate' in client) {
        return client.navigate(targetUrl);
      }
      return client;
    }
    if (clients.openWindow) return clients.openWindow(targetUrl);
  }));
});
