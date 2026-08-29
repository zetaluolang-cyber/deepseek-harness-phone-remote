// push/sw.js — the Service Worker script served at /remfs-sw.js.
//
// Deliberately minimal: it handles ONLY 'push' and 'notificationclick'. There
// is NO fetch handler, so the SW never intercepts GUI traffic (scope '/').
// The host composes the fully-localized title/body (privacy: only paired
// devices receive pushes, and only their stored language is used).
export const SERVICE_WORKER_SOURCE = `'use strict';
// remfs-persistent push service worker (v1).
// Host-composed payload: { title, body, tag, url, sessionId }.
self.addEventListener('push', function (event) {
  var data = {};
  try { data = (event.data && event.data.json()) || {}; } catch (e) { data = {}; }
  var title = data.title || 'DeepSeek Harness';
  var options = {
    body: data.body || '',
    tag: data.tag || 'remfs-push-' + (data.sessionId || ''),
    renotify: true,
    data: { url: data.url || '/' }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        if ('focus' in list[i]) {
          if ('navigate' in list[i]) { try { list[i].navigate(url); } catch (e) {} }
          return list[i].focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
`
