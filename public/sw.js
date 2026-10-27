// Service worker de AGRYN Monitoreo: deja la pantalla lista para abrirse rápido y sin conexión.
// Los datos nunca se guardan: /api/ siempre va a la red, así cada lectura y alerta es la del momento.
const VERSION = 'agryn-v1';
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png', '/logos/agryn-hoja.png', '/logos/agryn-hoja-reversa.png', '/logos/agryn-logo.png'];

// Además de la pantalla, guarda el JavaScript y el CSS que pide el index.html (sus nombres cambian en cada build).
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then(async (c) => {
    await c.addAll(SHELL);
    const html = await (await fetch('/index.html', { cache: 'no-store' })).text();
    const archivos = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
    return c.addAll(archivos);
  }));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((claves) => Promise.all(claves.filter((c) => c !== VERSION).map((c) => caches.delete(c)))));
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  // Pantallas: primero la red; si no hay conexión, la última copia de la app.
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('/index.html')));
    return;
  }

  // Archivos de la app (JS, CSS, íconos): primero la copia guardada, que es segura porque sus nombres cambian con cada versión.
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/') || url.pathname.startsWith('/logos/') || url.pathname === '/manifest.webmanifest') {
    e.respondWith(caches.match(req).then((guardado) => guardado || fetch(req).then((r) => {
      const copia = r.clone();
      caches.open(VERSION).then((c) => c.put(req, copia));
      return r;
    })));
  }
});

// Notificaciones push: llegan aunque la app esté cerrada. Las críticas no se cierran solas.
self.addEventListener('push', (e) => {
  let aviso = {};
  try { aviso = e.data ? e.data.json() : {}; } catch (err) { aviso = { titulo: 'AGRYN Monitoreo', detalle: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(aviso.titulo || 'AGRYN Monitoreo', {
    body: aviso.detalle || 'Hay un aviso nuevo. Revisá la app.',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    requireInteraction: aviso.nivel === 'crit',
    data: { url: aviso.url || '/' }
  }));
});

// Al tocar la notificación: se enfoca la app si ya está abierta, o se abre.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((ventanas) => {
    const abierta = ventanas.find((w) => 'focus' in w);
    if (abierta) return abierta.focus();
    return self.clients.openWindow(e.notification.data.url);
  }));
});
