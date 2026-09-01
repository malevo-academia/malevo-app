/* ═══════════════════════════════════════════════════════════════════════
   Malevo — Service Worker: instalabilidad de la PWA + notificaciones push.
   Se registra desde el portal (portal.js → _registrarServiceWorker(), ya
   desde el primer arranque sin esperar login; _inicializarPush() reutiliza
   ese mismo registro para pedir permiso y suscribirse a push) con el
   scope raíz ('/'), así puede recibir pushes aunque el alumno no tenga
   el portal abierto en ese momento.

   Por qué existe el listener de 'fetch' de más abajo aunque no cachea
   nada: Chrome/Android (y la mayoría de navegadores basados en Chromium)
   solo activan el instalador nativo de PWA ("Instalar app") cuando hay un
   Service Worker registrado que además escucha 'fetch' — sin eso, el
   navegador se queda en el modo antiguo de "Crear acceso directo" (que
   abre la web con la barra de direcciones visible, el síntoma exacto que
   reportó el admin). Se deja como un passthrough puro (deja pasar la
   petición tal cual, sin interceptar ni cachear nada) a propósito: esta
   app no tiene build ni versión de assets y server.js ya sirve todo con
   Cache-Control:no-store para evitar servir versiones viejas — cachear
   aquí rompería esa misma garantía.
   ═══════════════════════════════════════════════════════════════════ */

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: 'Malevo', body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'Malevo';
  const options = {
    body: data.body || '¡Tienes una novedad en Malevo!',
    icon: data.icon || '/assets/icons/icon-512.png',
    badge: data.badge || '/assets/icons/icon-192.png',
    tag: data.tag || 'malevo-notificacion',
    renotify: true,
    data: { url: data.url || '/portal.html' }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/portal.html';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes('portal.html') && 'focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
