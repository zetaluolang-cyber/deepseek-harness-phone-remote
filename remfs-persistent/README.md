# @zetaluolang/remfs-persistent

**Secure remote workspace & filesystem bridge for DeepSeek Harness.**

Keep the **native DeepSeek Harness web UI** and use it from your phone: start /
resume an agent in any folder, and browse, preview, edit, upload and download
PC files — over a secure network, with **device-authenticated RPC** and a
**capability-bounded filesystem**.

- **Host half** registers the `/remfs` RPC channel (trusted-host transport
  fence) with **device pairing**: one-time pairing code → per-device 256-bit
  credential (SHA-256 at rest) → list / revoke / revoke-all.
- **Client half** is a persistent loader module — loads on every page, no
  per-session "run". Bilingual (EN/zh), mobile-first workbench.
- **Filesystem capability model**: the allowlist is the primary boundary and can
  only be *narrowed* remotely; protected paths (system dirs, AppData,
  credential/key files, WeChat/WPS data) are host-enforced; `..`/UNC and
  symlink/junction escapes are blocked.

> Full setup — one-click deploy built on **Tailscale** (auto-installs Node.js +
> Tailscale, guides the one-time sign-in, enables HTTPS Serve, walk-on-LAN,
> auto-start) — lives in the GitHub repo:
> https://github.com/zetaluolang-cyber/deepseek-harness-phone-remote

## Requirements

- DeepSeek Harness web profile (`dsh web`)
- For phone access: Tailscale on the PC and phone, **same account**

## Install (manual, 3 steps)

```bash
# 1. install the package into your web profile
dsh plugin --profile web add @zetaluolang/remfs-persistent

# 2. register the loader row — REQUIRED (`dsh plugin add` only installs the dep).
#    Append to %USERPROFILE%\.dsh\profiles\web\cordis.patch.yml:
#
#    - insert:
#        - id: remfs-persistent
#          name: '@zetaluolang/remfs-persistent'
#          inject: [connection, fs, sandboxPolicy, workspaceRegistry]

# 3. restart dsh web, then refresh the GUI
```

The four-service `inject: [connection, fs, sandboxPolicy, workspaceRegistry]`
row is **not optional** — without it the plugin cannot resolve a safe workspace
root and `/remfs` does not register.

## First use on the phone (pairing)

1. Open the phone URL (Tailscale HTTPS, Tailscale IP, or LAN IP).
2. The workbench shows the pairing screen.
3. Read the pairing code from `%USERPROFILE%\.dsh\remfs-pairing.txt` on the PC
   (one-time, 10-minute TTL; restart the harness for a fresh code).
4. Enter the code + device name → paired. The PC stores only a hash.
5. Manage devices in the workbench ⋯ → Devices.

## Security model

- **Tailscale / trusted-host ≠ authentication** — transport only.
- **Device pairing** is the application boundary for `/remfs`; it does not add
  login authentication to the native Harness `/api`.
- **The allowlist** is the file-permission boundary; it can only be narrowed
  remotely (widening requires editing `.remfs-roots.json` on the PC).
- Threat model: https://github.com/zetaluolang-cyber/deepseek-harness-phone-remote/blob/master/SECURITY.md

## Pitfalls (we stepped on these so you don't)

| Symptom | Cause / fix |
|---|---|
| `npm.ps1 cannot be loaded because running scripts is disabled` | PowerShell execution policy — use `npm.cmd`, or `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |
| Plugin never appears after install | Skipped step 2 (loader row) or didn't restart `dsh web` |
| Pairing screen forever | Code expired (10 min) — restart the harness for a fresh code from `remfs-pairing.txt` |
| Phone gets 403 | Access via the Tailscale HTTPS name / Tailscale IP / LAN IP, with those hosts trusted (`--trusted-host`; one-click deploy does it) |
| `npm view` 404s right after a publish | CDN edge cache — wait a minute or query with `Cache-Control: no-cache` |

## License

MIT
