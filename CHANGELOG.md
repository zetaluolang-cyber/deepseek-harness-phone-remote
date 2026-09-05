# Changelog

All notable changes to `@zetaluolang/remfs-persistent` and the deploy package.

## [1.4.0] — 2026-08 (push reliability + orb widget hardening)

### Phone push
- **Repeat-event re-notification** — push/browser dedupe is now keyed on
  `sessionId:STATE:turnCycle` (new optional DTO field `turnCycle`, a
  user-message counter) plus a 2-minute per-session cooldown, so a second
  NEEDS_USER (multi-approval) or a FAILED→RUNNING→FAILED cycle in the same
  session is alerted again instead of being silently swallowed by the old
  7-day `sessionId:state` key.
- **Endpoint allowlist** — subscriptions are accepted only for https endpoints
  on known push providers (`fcm.googleapis.com`, `updates.push.services
  .mozilla.com`, `web.push.apple.com`) plus an operator-configured
  `pushEndpointAllow` list in `~/.dsh/remfs-options.json`; arbitrary
  `http(s)://` endpoints are rejected with the frozen `bad-request` code,
  closing the host-side SSRF / task-content exfiltration vector.
- **Delivery health** — the dispatcher stamps every subscription with
  `lastDeliveredAt` / `lastError`; new `files`-gated `push.status` operation
  returns the owning device's per-endpoint health, and the Devices pane
  renders "推送: ✅ x 分钟前 / ❌ reason" so a dead FCM channel is visible
  instead of silent.
- **Subscribe-time reachability probe** — `push.subscribe` OPTIONS-probes the
  endpoint origin (4 s timeout, injectable fetch); unreachable endpoints are
  still stored but the response carries `reachabilityWarning`, surfaced by the
  client, so mainland-FCM problems are discovered at setup time.
- **Click deep-link** — the push payload pins `sessionId`; the service worker
  stashes the target in a Cache-API flag on `notificationclick`, focuses and
  postMessages an open window (or opens the GUI cold), and the client consumes
  the flag once on load and calls `sessions.open` (never creates) — tapping a
  notification lands on the right session. Device click-through is manual-QA.

### Desktop orb widget
- **PS 5.1 argument quoting** — both `notepad.exe` call sites now go through
  the proven `ConvertTo-ArgLine` style (spaced log paths stay one argv).
- **Stale snapshot cache** — when the served `cachedAt` stamp stops advancing
  for ≥ max(30 s, 3×poll interval), the widget shows DISCONNECTED with
  `cache stale` detail instead of presenting stale task states; no toast
  fires.
- **Explicit unauthorized/offline** — 401/403 (and the default non-strict
  "200 with everything redacted" signature when a token is held) now render a
  dedicated 未授权 state with a fix-it tooltip; transport errors render a
  distinct 离线 state; neither toasts.
- **Interaction fix** — clicking the orb while the panel is open now closes it
  (the old double-toggle made it impossible to dismiss); toast dedupe and
  loopback URL usage verified and documented.
- **Testability** — pure decision logic extracted to `scripts/orb-state.ps1`
  (stamp precedence, staleness threshold, unauthorized/offline detection,
  toast gate, task selection) with `test/orb-state.test.ps1` (plain-PS
  assertions) wired into the Windows CI job; `install.ps1` deploys
  `orb-state.ps1` beside the widget.

## [1.3.2] — 2026-08 (push delivery + P0 review hardening)

- **Push dispatcher actually delivers (P0 fix)** — the dispatcher called
  `sendPush` with positional arguments while it takes one options object, so
  every real dispatch threw inside the cycle-level catch: **no push had ever
  been delivered by the periodic dispatcher**. The call is fixed and the
  calling convention is pinned by new dispatcher tests that drive `tick()`
  through the real `sendPush` (fetch faked): delivery, per-session dedupe, and
  gone-endpoint pruning.
- **Test push (`push.test`)** — a Devices-pane button sends an immediate test
  notification to the calling device and reports per-endpoint results, so a
  dead push channel (e.g. FCM unreachable from mainland networks) is
  discovered at setup time instead of when an agent fails. `files`-gated like
  subscribe; new frozen-vocabulary-compatible operation (additions allowed).
- **Browser notifications restored** — NEEDS_USER/FAILED notifications were
  deleted together with the in-page Orb; they are event delivery, not a
  visual, and now run as a headless presence poll independent of any UI.
  The Task Board error line also surfaces the host error code again.
- **PC toast notifications** — the desktop companion fires a native Windows
  toast on transitions into NEEDS_USER/FAILED (survives fullscreen windows,
  lands in Action Center, respects Focus Assist; zero dependencies).
- **Narrowing stops pushes** — `isDeviceValid` for the dispatcher now also
  requires the `files` capability, so narrowing a device prunes its existing
  subscriptions within a minute (same guarantee as revocation), and
  unsubscribe is deliberately not capability-gated (cleanup is never a
  privilege).
- **Docs: honest delivery notes** — presence-push.md now states the
  mainland-China FCM reachability reality and the Tailscale exit-node
  workaround, next to the existing iOS add-to-home-screen requirement.
- **One desktop companion, no duplicate web Orb** — the in-page floating ball
  is removed; the Task Board remains available as a compact header action. The
  Windows companion is now a true per-pixel-alpha orb with no backing card or
  transparency key. Hover reveals status and task title; click opens a task
  quick panel. Native compositor dragging removes repaint flicker, while
  state-aware orbital sparks, trails, bursts and energy rings provide motion
  without keeping quiet states busy. It also uses an atomic named mutex,
  surfaces malformed/host-error presence responses as disconnected instead of
  false Idle, supports cross-monitor dragging, and has a rendered WinForms
  smoke test in Windows CI.
- **Real clean-user one-click deployment** — the Windows installer now owns a
  private DSH runtime under `~/.dsh/runtime`, creates a missing web profile,
  deploys the complete plugin, writes the launcher before its shortcut, starts
  the stack and verifies both Harness and the plugin route before printing
  `DONE`. Tailscale uses its real device-login flow. CI executes the production
  installer twice against an isolated empty `USERPROFILE` and offline DSH npm
  fixture, proving fresh install and idempotent repair without system changes.
- **/pocket capability gate** — `push.subscribe`/`push.unsubscribe` now
  require the `files` capability (pushes carry task titles/summaries); denial
  uses the frozen `capability-denied` code. The /pocket dispatcher moved to
  `lib/presence/pocket.js` and its authorization rules (read-only fence,
  pocketStrict, capability gate) are unit-tested for the first time.
- **Capability enforcement** — `/remfs` now requires `files` for filesystem and
  workspace operations and `device-admin` for paired-device management. The
  obsolete persisted `approval` capability migrates in memory to
  `device-admin`; existing default behavior is preserved.
- **Complete CI discovery** — both Linux and Windows run every automatically
  discovered Node test and syntax-check every JavaScript module under `lib/`,
  including Web Push encryption/store tests that the old hand-written list
  omitted.
- **Release/documentation hygiene** — manual loader instructions now carry all
  four required injected services, the architecture audit reflects implemented
  pairing, the native `/api` boundary is prominent, and the MIT license text is
  included.
- **Auth-store write guard** — the throttled `lastSeen` path now has a real
  no-write assertion and self-heals future timestamps after clock rollback.
- **P0 review hardening (security)** — the file-access allowlist
  (`.remfs-roots.json` and its writer tmp variants) is now hard-denied on
  every generic read/write/list path, closing the self-widening hole where a
  paired device could rewrite its own root list; new pairings default to
  `files` only (`device-admin` is a PC-side store grant); unauthenticated
  presence responses now redact task titles/summaries while keeping the
  frozen v1 DTO shape; the security store, pairing code file, corrupt-store
  backups and the push store (VAPID key) are written `0o600`, and the
  plaintext pairing code is no longer logged.
- **P0 review hardening (ops)** — `Start-Process -ArgumentList` calls now go
  through `ConvertTo-ArgLine` (one quote pair per token, single string): on
  Windows PowerShell 5.1 raw arrays and doubled-quote styles both split
  paths containing spaces, so a spaced `%USERPROFILE%` would silently break
  the launcher (empirically verified). `install.ps1` now disarms the
  watchdog scheduled task before stopping the live stack and re-arms it on
  success or fatal failure (trap-backed), so a mid-install watchdog relaunch
  can no longer race the deploy.
- **P0 review hardening (presence engine)** — the system heartbeat now means
  "the harness process is alive and answering" (marked on every successful
  presence call) instead of "the last session event was recent": quiet
  NEEDS_USER / FAILED / DONE sessions no longer decay to DISCONNECTED after
  ~60 s, empty and old persisted sessions read IDLE while the system is
  alive, and DISCONNECTED is reserved for a stale engine heartbeat or a
  genuinely orphaned session loop. The Task Board gains a real Disconnected
  group instead of lumping those sessions under "Not Started".

## [1.3.1] — 2026-08 (orb polish + instant presence)

- **Brand DSH ball** — the PC orb now mirrors the in-page Orb: blue gradient
  ball + white brand whale (same SVG path as the web Orb), state shown as a
  colored ring + small corner badge instead of a full-ball glyph; quiet states
  dim the ball, NEEDS_USER/FAILED pulse.
- **Snapshotted presence route** — `presence.tasks()` decompresses every
  persisted session log (zstd) and can take tens of seconds; the push
  dispatcher caches its task snapshot and `GET /remfs-presence.json` serves
  the cache, so the orb widget (and any script) gets an instant response
  instead of timing out.
- **Orb auto-start at logon** — `install.ps1` registers a Startup-folder
  entry (`dsh-orb-widget.cmd`); the widget is single-instance (a second start
  exits), so the auto-start and the double-click .cmd never stack. Remove the
  Startup entry to disable.

## [1.3.0] — 2026-08 (PC topmost Orb + phone Web Push)

- **PC always-on-top Orb widget** — `scripts/orb-widget.ps1` (+
  `start-orb-widget.cmd`, deployed to `~/.dsh/launcher/` by `install.ps1`): a
  zero-dependency WinForms ball that stays above every window. Shows the
  highest-priority agent state (same task DTOs as the in-page Orb, via the new
  `GET /remfs-presence.json` route), drag-to-move with persisted position,
  click-to-open the harness, right-click menu, hover tooltip with the task
  title. State colors/glyphs mirror the web Orb; NEEDS_USER/FAILED pulse.
- **Phone Web Push with the page closed** — an opt-in, per-paired-device push
  path: the host serves the service worker at `/remfs-sw.js` (same origin,
  registered through the harness `webServer`; the SW has no fetch handler) and
  the VAPID public key at `/remfs-push-vapid.json`. The Devices pane gains a
  "Push notifications" toggle that subscribes through `/pocket push.subscribe`
  (auth-required) and reports the subscription to `~/.dsh/remfs-push.json`.
  A host dispatcher polls `presence.tasks()` and pushes NEEDS_USER / FAILED
  (always) and DONE (when `remfs-options.json` `push.done` is true), deduped
  per `sessionId:STATE` (persisted, 7-day prune). Revoked devices are pruned
  within a minute. Requires a secure context (Tailscale HTTPS or localhost).
- **RFC 8291 / 8292 from scratch, zero dependencies** — `lib/push/vapid.js`
  (VAPID ES256 JWT), `lib/push/webpush.js` (aes128gcm; exact RFC 8291 §3.4 key
  schedule + RFC 8188 wire format with empty AAD), `lib/push/store.js`
  (durable store, atomic writes, corrupt-file quarantine), `lib/push/http.js`
  (route handlers), `lib/push/controller.js` (presence-driven dispatcher).
  Verified **byte-for-byte against the RFC 8291 Appendix A / §5 official test
  vector** and cross-checked with the reference `web-push` package
  (`scripts/interop-webpush-check.mjs`).
- **Read-only presence over plain HTTP** — `GET /remfs-presence.json` serves
  the same task DTOs the Orb renders (useful for scripts/widgets); respects
  `pocketStrict` via `x-remfs-device-id` / `x-remfs-credential` headers.
- **Docs** — new [docs/presence-push.md](docs/presence-push.md) (architecture,
  privacy, operator switches, platform notes, troubleshooting); README (EN/zh)
  features/security/troubleshooting/roadmap updated.
- Tests: 143 green (was 128), including the RFC vector, push-store lifecycle,
  and the extended remfs-options contract.

## [1.2.1] — 2026-08 (presence-orb UX polish)

- **Calm by default** — the Orb no longer glows/bobs permanently: IDLE / DONE /
  DISCONNECTED render as a quiet, dimmed ball; only NEEDS_USER / FAILED get the
  breathing glow (+ bobbing whale), and RUNNING keeps its dashed spin ring.
  `prefers-reduced-motion` still disables everything.
- **Position persistence** — the drag position is saved to `localStorage`
  (`remfs-orb-pos`) and restored on reload; the ball stays where the user put
  it instead of snapping back over the composer.
- **First-run hint** — the Quick Peek opens once on first load so the ball
  explains itself; dismissed by the next click.
- **Title privacy by default** — task titles and summaries (user content) are
  shown only to paired devices; an unpaired viewer sees state + icon + "Pair to
  view task details" in the peek, the board, and the ball tooltip.
- **Faster task access** — the Quick Peek title is now clickable (paired only)
  and opens the existing session directly.

## [1.2.0] — 2026-08 (self-healing + data-integrity release)

- **Self-healing watchdog** — scheduled task (`dsh_harness_watchdog`, every 5
  minutes) verifies by process ownership (never a bare port) that the harness
  owns 127.0.0.1:3080, and headlessly restarts it when down; foreign listeners
  are logged and left alone. Consecutive-failure escalation: after 3 failed
  recoveries a `watchdog.failed` marker is written so a silently broken
  recovery cannot hide in the log.
- **Startup quarantine** — corrupt `demo-presence-*` session folders (and
  nested stray workspace directories) are moved aside before launch instead of
  bricking the dsh workspace plugin (recursive scan, never deletes).
- **Session size hints** — phone UI shows each session size and flags >10 MB
  with "建议归档 / suggest archiving".
- **Session archiving** — `scripts/archive-sessions.ps1` moves oversized
  sessions to `~/.dsh/sessions-archive\<date>\` and prunes their registry
  references (with backups); refuses while the harness is up unless forced.
- **demo-presence guardrails** — fixed `cwd` in headers (was `process.cwd()`,
  which produced header/cwd-identify corruptions), idempotent `--add`
  (cleans first), harness-running warning, `REMF_DEMO_SESSIONS_ROOT` test
  escape hatch, real restart hint, behavior tests.
- **Presence engine** — 7-state agent presence (Orb + Task Board) over the
  `/pocket` channel; read-only status/tasks visible without pairing, everything
  else device-authenticated; dump-session tool for full conversation export.
- **UTF-8 encoding guard** — upload/edit rejects UTF-16 BOMs and invalid
  UTF-8 (GBK/ANSI) writes with a clear message; preserves BOM and dominant
  newline style on write-back.
- **/pocket strict mode** — opt-in via `~/.dsh/remfs-options.json`
  (`pocketStrict: true`) makes status/tasks require a valid device credential
  too.
- **Docs & tooling** — Tailscale ACL hardening guide, upgrade checklist,
  desktop shortcut managed by `install.ps1`, install deploys
  `restart_harness_once.ps1` and `watchdog.ps1`, CI covers watchdog syntax and
  the new tests (128 tests green).

## [1.1.2] — 2026-08 (regression-fix pass, CI green)

- **Revoke protocol** — client now sends `targetDeviceId`; added a true
  client-source → RPC payload → dispatcher contract test.
- **No maintainer paths** — launcher/template derive profile paths from
  `$env:USERPROFILE`; CI scans for `C:\Users\<name>` literals.
- **stop_harness** — ownership-verified (harness-common); a foreign :3080
  listener survives.
- **start_harness** — missing/broken `harness-common.ps1` is fatal (no
  fail-open fallback, no forwarder without ownership checks).
- **restart_harness** — derives the owned forwarder IP from the launcher
  (was an empty list); restart-kill regression test added.
- **CI** — `node --check` on every lib file (incl. dispatch.js), all
  `*.test.js` run via glob (directory form was broken), path-scan step.
- **Store corruption** — `loadStore` distinguishes ENOENT (fresh) from
  corruption/permission errors; corrupt stores are backed up
  (`<file>.corrupt-<ts>`), kept in place, and fail closed with
  `store-corrupt` instead of silently resetting device/pairing state.
- **refresh_pairing.ps1** — implemented and deployed (pairing code rotation
  without a harness restart); instruction in dispatch errors is now real.
- **Docs** — README/SECURITY clarify: Harness stays loopback-only (LAN
  exposure only via opt-in forwarders); pairing protects `/remfs`, not the
  native `/api`.

## [1.1.1] — 2026-08 (bug-fix pass)

### Fixes
- **Deploy ships the whole `lib/`** — install.ps1 now copies the `lib`
  directory recursively (security.js/dispatch.js were missing from the old
  per-file list); added a deployment smoke test.
- **Revoke protocol** — host reads `targetDeviceId` (the caller's `deviceId` is
  the auth identity); added an A-revokes-B integration test.
- **Store concurrency** — all security-store operations are serialized per file
  and persisted via atomic tmp+rename; concurrent verify/revoke can no longer
  resurrect a revoked credential; pairing is strictly single-use under the lock.
- **Pairing lifecycle** — consumed codes are marked `CONSUMED` in
  `remfs-pairing.txt`; a fresh code is regenerated after use/expiry; distinct
  `pairing-used` / `pairing-expired` errors.
- **Allowlist fail-closed** — a corrupt/unreadable `.remfs-roots.json` now
  denies access instead of silently expanding to the workspace root.
- **Walk-on-LAN is opt-in** — off by default (`%USERPROFILE%\.dsh\lan-on` or
  `DSH_REMFS_LAN=1`); docs updated.
- **Launcher process ownership** — "3080 listening" is no longer treated as
  "our harness running": every check/kill matches the owning process's command
  line (`harness-common.ps1`); foreign 3080 services are never exposed or
  killed; added a dummy-:3080 regression test.
- **DNSName honesty** — install.ps1 re-reads `tailscale status --json` after
  sign-in and never fabricates `COMPUTERNAME.tailnet.ts.net` as a trusted host.
- **Node version validated** — the installer checks `node --version` against
  `^22.19.0 || >=24.0.0` (upstream requirement), not just the executable's
  existence.
- **Breadcrumb closure** — each crumb captures its own prefix path.

### Tests
- `test/dispatch.test.js` (protocol/integration, temp-dir fs adapter),
  `test/install-smoke.ps1` (deployment), `test/launcher-ownership.ps1`
  (dummy :3080). CI now runs a Windows job for the PowerShell tests.

## [1.1.0] — 2026-08 (security release)

### Security
- **Device authentication for `/remfs`** — every endpoint except `pair` now
  requires a per-device credential. `trusted-host` remains the transport fence;
  application authentication is now device credentials.
- **Pairing flow** — one-time 128-bit pairing code (10-minute TTL, single use),
  SHA-256 hashed at rest; long-term device credentials are 256-bit and stored
  only as hashes.
- **Device management** — list / revoke / revoke all devices.
- **Capability-bounded allowlist** — remote clients can only *narrow* the
  approved roots; widening (`C:\`, new drives) requires editing
  `.remfs-roots.json` on the PC.
- **Path hardening** — `..` and UNC paths rejected before resolution;
  symlink/junction escapes already fail the realpath-based allowlist check;
  protected paths extended (`.env`, `.aws`, `.gnupg`, `.config/gcloud`, AppData).

### Features
- **Walk-on-LAN** — a second forwarder binds the PC's LAN IP, the harness trusts
  it, and the launcher prints the LAN URL; the phone on the same Wi-Fi can skip
  Tailscale. `/remfs` stays device-authenticated.
- Bilingual UI; pairing and device-management screens in the workbench.

### Tests
- `test/security.test.js` — path traversal, absolute-path bypass, credential
  protection, allowlist capability, pairing single-use/expiry, auth/revocation
  (12 cases, `node --test`).

### Docs / CI
- Architecture audit, positioning, threat model, CONTRIBUTING, SECURITY.
- GitHub Actions CI (syntax, security tests, package smoke).

## [1.0.1] — 2026-08
- npm package README with install steps and a pitfalls table.
- Renamed scope to `@zetaluolang/remfs-persistent`.

## [1.0.0] — 2026-08
- Initial release: persistent loader plugin, `/remfs` RPC channel, phone
  workbench (session + files), Tailscale one-click deploy, protected paths.
