# Security Policy

## Reporting a vulnerability

If you find a security issue in this project, please **do not open a public
issue**. Report it privately:

- Open a **private vulnerability report** on GitHub:
  https://github.com/zetaluolang-cyber/deepseek-harness-phone-remote/security/advisories/new
- Or email the maintainer (address in the GitHub profile).

Please include:

- Affected version(s) and component (host RPC / pairing / filesystem / launcher).
- A minimal reproduction (OS, steps, expected vs actual).
- Impact assessment (what a remote attacker could do).

We aim to acknowledge reports within 3 business days and to ship a fix
reasonably quickly. If you can, avoid automated scans against running instances.

## What this project protects against

- **Unauthenticated remote RPC** — `/remfs` requires a per-device credential;
  pairing is one-time and time-limited.
- **Over-broad paired-device authority** — `/remfs` enforces `files` on
  filesystem/workspace operations and `device-admin` on device management;
  `/pocket` push **subscribe** also requires `files` (push payloads carry task
  titles/summaries — content strictly weaker than what `files` already
  grants); unsubscribe is never gated, since removing your own subscription
  only reduces data flow. Narrowing a device away from `files` also prunes
  its EXISTING push subscriptions within a minute (same guarantee as
  revocation). New devices receive both capabilities for backward-compatible
  behavior; remote clients cannot grant capabilities. To narrow a device, edit its entry in
  `%USERPROFILE%\.dsh\remfs-security.json` **while the harness is stopped**
  (the host process is the single writer) and remove capabilities from its
  list, e.g. a browse-only device:

  ```json
  { "id": "…", "name": "old-tablet", "capabilities": ["files"] }
  ```

  An empty list (`[]`) locks the device out of every capability-gated endpoint
  while keeping it paired. Deleting the `capabilities` field entirely restores
  the defaults (legacy migration).
- **Remote allowlist widening** — a client can never add `C:\` or unrelated
  roots over the wire; that requires PC-local config edits.
- **Path escape** — `..`, UNC, symlink/junction escapes are rejected/checked.
- **Credential theft at rest** — only SHA-256 hashes are stored.
- **Accidental wildcard-interface exposure** — the GUI keeps binding 127.0.0.1;
  only explicit forwarders expose selected Tailscale/LAN addresses. Plugin RPC
  is then protected by the trust fence and device auth; the native GUI `/api`
  limitation below still applies.
- **Data corruption via non-UTF-8 remote writes** — the write path rejects
  files that are not UTF-8 (UTF-16 BOM, GBK/ANSI bytes) and preserves the
  UTF-8 BOM + dominant newline style (CRLF/LF) on write-back, so a remote
  edit can never mangle an existing file's encoding.
- **Unprotected read-only presence** — by default `/pocket` STATUS/TASKS are
  readable without a credential (inside the browser-trust fence). Set
  `pocketStrict: true` in `~/.dsh/remfs-options.json` to require a valid
  device credential for every `/pocket` call.

## What it does NOT protect against (threat model)

- **The GUI `/api` surface itself is not user-authenticated.** Once a device can
  reach the harness (tailnet member or LAN device that passes the Host fence),
  the Harness GUI's own API is reachable. Device pairing protects `/remfs`, not
  the GUI. Do not expose the harness to untrusted networks; Tailscale membership
  and your LAN are the boundary here.
- **Compromised host/PC** — if the PC itself is compromised, nothing in this
  plugin helps.
- **Tailscale account compromise** — a device that joins your tailnet reaches
  the harness; revoke devices and review tailnet membership regularly. Harden
  the tailnet with a phone-only ACL on 443/3080 (see
  [docs/tailscale-acls.md](docs/tailscale-acls.md)); even with `pocketStrict`
  enabled the GUI `/api` itself stays unauthenticated, so keep untrusted
  devices out of the tailnet entirely.
- **Malicious workspace content** — an agent running in a workspace can do
  whatever the harness allows; workspace access grants agent execution.
- **Time-of-check/time-of-use on the allowlist file** — the allowlist is read
  per request; a concurrent PC-side edit is honored immediately.

## Responsible disclosure

We will credit reporters (unless anonymity is requested), fix the issue, and
note it in the changelog. Security fixes are released as patch/minor versions.
