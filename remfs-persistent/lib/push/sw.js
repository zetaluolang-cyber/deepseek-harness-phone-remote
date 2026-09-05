// push/sw.js — the Service Worker script served at /remfs-sw.js.
//
// Deliberately minimal: it handles ONLY 'push' and 'notificationclick'. There
// is NO fetch handler, so the SW never intercepts GUI traffic (scope '/').
// The host composes the fully-localized title/body (privacy: only paired
// devices receive pushes, and only their stored language is used).
//
// Deep-link (1.5): a Service Worker cannot touch page localStorage, so on
// notificationclick the target sessionId is stashed in a Cache-API flag
// (same-origin, readable by the page) under cache 'remfs-persistent-push-v1'
// key '/remfs-push-target'. client.js reads that flag on page load and opens
// the session via ctx.sessions.open(id), then deletes the flag. When a GUI
// window is already open it is focused and told via postMessage instead of
// being navigated (no reload / no URL routing).
export const SERVICE_WORKER_SOURCE = `'use strict';
// remfs-persistent push service worker (v1).
// Host-composed payload: { title, body, tag, url, sessionId }.
var REMFS_CACHE = 'remfs-persistent-push-v1';
var REMFS_TARGET_KEY = '/remfs-push-target';

function stashPushTarget(sessionId) {
  if (!sessionId) return Promise.resolve();
  return caches.open(REMFS_CACHE).then(function (cache) {
    return cache.put(REMFS_TARGET_KEY, new Response(String(sessionId)));
  });
}

self.addEventListener('push', function (event) {
  var data = {};
  try { data = (event.data && event.data.json()) || {}; } catch (e) { data = {}; }
  var title = data.title || 'DeepSeek Harness';
  var options = {
    body: data.body || '',
    tag: data.tag || 'remfs-push-' + (data.sessionId || ''),
    renotify: true,
    data: { url: data.url || '/', sessionId: data.sessionId || '' }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var url = (event.notification.data && event.notification.data.url) || '/';
  var sessionId = (event.notification.data && event.notification.data.sessionId) || '';
  event.waitUntil(
    stashPushTarget(sessionId).then(function () {
      return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
        for (var i = 0; i < list.length; i++) {
          if ('focus' in list[i]) {
            // Window already open: tell it which session to enter. No navigate
            // call - reloading the SPA would lose the user's place.
            if (sessionId) { try { list[i].postMessage({ type: 'remfs-push-target', sessionId: sessionId }); } catch (e) {} }
            return list[i].focus();
          }
        }
        // Cold start: open the GUI; client.js reads the stash on load.
        return self.clients.openWindow(url);
      });
    })
  );
});
`
