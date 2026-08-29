# Web Push Notifications (phone, page closed)

The in-page Orb only lives inside the harness page. For the phone to get
"Needs you / Failed" (and optionally "Done") **with the page closed**, the
plugin adds a standards Web Push path. Everything here is opt-in and
device-authenticated.

## How it works

```
phone browser (Tailscale HTTPS)          PC host (harness process)
┌─────────────────────────────┐          ┌──────────────────────────────┐
│ page loads                   │          │ webServer routes:           │
│  → registers /remfs-sw.js    │ ───────► │  /remfs-sw.js  (SW script)  │
│  → Device pane toggle ON     │          │  /remfs-push-vapid.json     │
│  → pushManager.subscribe()   │          │  /remfs-presence.json       │
│    (VAPID public key)        │          │                            │
│  → /pocket push.subscribe    │ ───────► │  store in ~/.dsh/remfs-push.json
│    (deviceId+credential)     │          │                            │
└─────────────────────────────┘          │ push dispatcher (10s):      │
        ▲                                │  poll presence.tasks()      │
        │ FCM / Mozilla autopush         │  NEEDS_USER / FAILED → send │
        │ (internet)                     │  DONE → only if push.done   │
        └────────────────────────────────┤  dedupe per session+state   │
                                         └──────────────────────────────┘
```

1. **Transport** — the phone reaches the harness over Tailscale HTTPS
   (`https://<pc>.<tailnet>.ts.net`), or `http://localhost` on the PC itself.
   A service worker requires a secure context, so plain `http://192.168.x.x`
   (walk-on-LAN) or Tailscale-IP HTTP **cannot** register one — push is
   HTTPS-only. The SW is served same-origin by the plugin at `/remfs-sw.js`
   (registered via the harness `webServer` service; the SW has **no fetch
   handler**, so it never intercepts GUI traffic).
2. **Subscription** — after pairing, the phone opens the Devices pane and
   flips **Push notifications** on. It requests notification permission,
   subscribes with the VAPID public key from `/remfs-push-vapid.json`, and
   reports the subscription to the host via `/pocket push.subscribe` (this RPC
   sits in the auth-required branch — only a **paired** device can register a
   subscription). The host stores it in `~/.dsh/remfs-push.json` keyed by
   device.
3. **Delivery** — a host-side dispatcher polls `presence.tasks()` (the same
   single source of truth the Orb uses, ~10s) and, on a **new**
   `sessionId:STATE`, sends a Web Push to every stored subscription:
   - `NEEDS_USER` / `FAILED` — always
   - `DONE` — only when `~/.dsh/remfs-options.json` has `{"push":{"done":true}}`
   - deduped per `sessionId:STATE` (map persisted in the push file, pruned
     after 7 days) so restarts never re-notify
4. **Service worker** — on `push` it shows the notification (title/body are
   composed host-side in the device's UI language); on `notificationclick` it
   focuses/opens the harness.

## Crypto

Implemented from scratch in `lib/push/` with **zero npm dependencies**
(`node:crypto` only):

- `vapid.js` — VAPID (RFC 8292): P-256 keypair, ES256 JWT (raw r||s).
- `webpush.js` — RFC 8291 aes128gcm: the exact §3.4 key schedule
  (`PRK_key = HMAC(auth_secret, ecdh_secret)`, `key_info = "WebPush: info" ||
  0x00 || ua_public || as_public`, …) and RFC 8188 wire format (empty AAD,
  padding delimiter appended). **Verified byte-for-byte against the RFC 8291
  Appendix A / §5 official test vector** (`test/webpush.test.js`) and
  cross-checked against the reference `web-push` package
  (`scripts/interop-webpush-check.mjs`).
- `store.js` — durable state (VAPID keypair, subscriptions, dedupe map) with
  atomic writes; a corrupt file is quarantined, never trusted.
- `http.js` / `controller.js` — route handlers and the presence-driven
  dispatcher.

## Privacy & security

- Subscriptions are **paired-device-only** (RPC requires a device
  credential). Task titles/summaries are pushed only to those devices.
- A **revoked** device's subscriptions are pruned by the dispatcher (checked
  against the device store every minute), so revoked devices stop receiving
  task content.
- `~/.dsh/remfs-push.json` contains the VAPID private key — same protection
  expectations as `remfs-security.json` (user-profile file, never in the
  repo).
- The read-only `/remfs-presence.json` route serves the same DTOs the Orb
  already shows unauthenticated inside the browser-trust fence; with
  `pocketStrict: true` it requires device headers
  (`x-remfs-device-id` / `x-remfs-credential`).

## Operator switches (`~/.dsh/remfs-options.json`)

```json
{
  "pocketStrict": false,
  "push": {
    "done": false,
    "intervalSeconds": 10
  }
}
```

- `push.done` — also notify on `DONE` transitions (default off).
- `push.intervalSeconds` — dispatcher poll interval (clamped 5..60).

## Platform notes

- **Android Chrome**: works with Google Play services present; the
  notification arrives even when the tab is closed. **Without GMS** (some
  China-market phones), `pushManager` may be unavailable — the toggle then
  shows "needs HTTPS" and you fall back to in-page notifications while the
  tab is open.
- **iOS Safari**: Web Push requires iOS 16.4+ and the page installed as a
  PWA ("Add to Home Screen"); the harness page must be served over HTTPS
  (Tailscale HTTPS qualifies).
- **Desktop**: browsers show these as OS notifications.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Toggle disabled ("needs HTTPS") | Open the harness via the Tailscale HTTPS URL (`https://<pc>.<tailnet>.ts.net`) or `http://localhost:3080`; plain-LAN HTTP cannot host a service worker |
| No notifications with the page closed | Check `%USERPROFILE%\.dsh\remfs-push.json` has your subscription; check harness log lines `[remfs-persistent] push:`; confirm the phone OS allows notifications for the browser |
| Duplicate notifications after a restart | Dedupe is persisted — if you still see one, the state was re-entered before the dispatcher polled; it will not repeat after the first mark |
| Push stops after revoking a device | Expected — subscriptions of revoked devices are pruned within a minute |
