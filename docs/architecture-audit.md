# Architecture Audit (2026-08)

Analysis of this project against the DeepSeek Harness upstream plugin model and
the closest community project, `zhu1090093659/dsh-web-ui`.

## 1. Our project today

- **Transport**: Tailscale (WireGuard) + `tailscale serve` (HTTPS) + a local TCP
  forwarder (`tailscale_forward.js`) for the tailnet-IP HTTP path. The harness
  itself keeps binding `127.0.0.1` — nothing is exposed to LAN/public.
- **Plugin**: `@zetaluolang/remfs-persistent`, a Cordis loader entry (persistent,
  no per-session "run"). Host half registers the `/remfs` Connection RPC channel
  (authority `trusted-host`); client half is a module-table entry served on every
  page. Mobile-first workbench (New Session / Files tabs) with bilingual UI.
- **Filesystem**: allowlist file (`.remfs-roots.json`, PC-local) + host-enforced
  protected-path deny list (system dirs, credential/key files, private data dirs).
  `fs.processPath()` returns the realpath, so symlink/junction escapes already
  fail the within-allowlist check.
- **Workspace**: uses the harness's own `workspaceRegistry` (list / resolveByPath
  / create) — no reimplementation.
- **Deploy**: `install.ps1` auto-installs Node.js + Tailscale, guides the one-time
  sign-in, enables HTTPS Serve, installs the plugin, registers auto-start.

## 2. DeepSeek Harness upstream (deepseek-ai/deepseek-harness)

- **Plugin model**: profiles (`dsh --profile web`) + loader patch layers
  (`cordis.patch.yml`, `insert` rows) + npm packages. `dsh plugin add <pkg>`
  forwards to pnpm inside the profile. Client modules via the `dsh.client`
  manifest; host half via the package main. Verified in this project.
- **Trust model**: `/api` browser-trust fence — Host header must be loopback or a
  `--trusted-host` authority; cross-site blocked. The docs (api-gateway.md,
  defensive-patterns.md) state clearly this is **not** an auth layer.
- **Docs**: mature (architecture, capability-seams, defensive-patterns,
  cordis-primer, examples/web-cordis …). No dedicated "remote access security /
  pairing" guide exists yet.

## 3. Competitor: zhu1090093659/dsh-web-ui

A plugin & skin collection. Its mobile story is a **separate mobile frontend**:
QR pairing (one-time token, revocation), own chat UI, model/permission controls,
cloudflared tunnel support, SSE-with-polling fallback. Plus skins, task board,
git graph, SSH remote ops, image understanding, live token stats.

## 4. Comparison

| Axis | dsh-web-ui | this project |
|---|---|---|
| Mobile experience | **replacement UI** (its own mobile frontend) | **native DSH web UI** kept, workbench bridge only |
| Pairing / device auth | yes (QR, one-time token, revoke) | **implemented** (one-time code, per-device credential, revoke/revoke-all) |
| File management | desktop right-panel file tree | phone-side filesystem bridge (browse/edit/upload/download) |
| Workspace control | sessions + messages | start/resume agent in any folder, manage workspaces |
| Network | LAN QR + cloudflared | Tailscale (HTTPS + IP) |
| Positioning | UI/skin enhancement suite | **secure remote workspace & filesystem bridge** |

## 5. What we must NOT reimplement

- A separate mobile chat UI (their territory; we keep the native UI).
- Skins, task board, git graph, SSH terminal, image understanding (out of scope).
- Their pairing UX wholesale — we need pairing, but designed for our
  native-UI + filesystem bridge model.

## 6. Most valuable next investments

1. **Native `/api` boundary** — pairing protects this plugin's RPC surfaces,
   not the upstream Harness API. Keep transport access narrow and pursue an
   upstream authentication seam rather than implying the plugin can wrap it.
2. **Automated browser compatibility** — add a small real-browser smoke suite
   for upstream selector and mobile interaction changes; source-contract tests
   alone cannot prove runtime integration.
3. **Client modularity** — split authentication, push, presence and file UI out
   of the single client module before adding another major feature area.
