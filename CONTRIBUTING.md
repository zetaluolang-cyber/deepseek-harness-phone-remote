# Contributing

Thanks for helping! This project keeps the DeepSeek Harness native web UI and
adds a secure remote workspace & filesystem bridge. Please read the
[architecture](docs/architecture.md) and [positioning](docs/positioning.md)
docs first.

## Development environment

- Windows 10/11 + Node.js ≥ 18 + DeepSeek Harness (`npx @deepseek-ai/dsh web`).
- The plugin lives in `remfs-persistent/`:
  - `lib/host.js` — the /remfs RPC channel (Cordis host half).
  - `lib/client.js` — the phone workbench UI (module-table client half).
  - `lib/security.js` — pure auth + path logic (unit-testable).
  - `test/security.test.js` — node:test suite.
- Deploy scripts at the repo root (`install.ps1`, `start_harness.template.ps1`,
  `tailscale_forward.js`, `keep_awake.ps1`, `restart_harness.ps1`,
  `stop_harness.ps1`).

## Run tests

```bash
cd remfs-persistent
npm test
```

CI discovers the complete `test/**/*.test.js` suite via `node --test`, checks
every JavaScript file under `lib/`, and parses the PowerShell deploy scripts.

## Plugin structure

- The package is a Cordis **loader entry**: `dsh plugin --profile web add
  @zetaluolang/remfs-persistent` installs it; the loader row in
  `cordis.patch.yml` carries
  `inject: [connection, fs, sandboxPolicy, workspaceRegistry]` (required).
- `package.json`'s `dsh.client` manifest registers the client module (served at
  `/plugins/<id>/client.js`, loaded on every page).

## RPC structure

- Channel: `/remfs`, authority `trusted-host` (browser-trust fence).
- Envelope: `{ ok: true, value }` / `{ ok: false, error: { code, message, details } }`.
- Every endpoint except `pair` requires `payload.deviceId` + `payload.credential`.

### Adding an RPC method

1. Add the case to the `switch` in `host.js` `handler` (inside the auth gate).
2. Return data in `value`, errors as `err(code, message, details)`.
3. Call it from `client.js` via the `rpc(method, payload)` helper.
4. Add a unit test in `test/security.test.js` if it touches security logic.
5. `npm test` + a manual check on the live harness.

## Security rules (mandatory)

- Never treat `trusted-host` / Host headers / Origin as authentication.
- Credentials are stored ONLY as SHA-256 hashes — never plaintext, never in
  localStorage on the host side.
- Path checks must use the canonical (realpath) target, not the raw input.
- The allowlist can only be narrowed by remote clients.
- New protected paths go into `DENY_SEGMENTS` / `DENY_FILE` in `security.js`
  with a matching test case.

## Commit workflow

- Small, focused commits; conventional prefixes (`docs:`, `security:`,
  `feat:`, `fix:`, `test:`, `ci:`).
- Run tests + `node --check` before committing; verify no credentials/secrets in
  the diff.
- Do not push without the maintainer asking (this repo is currently push-on-request).

## Release

- Bump `version` in `remfs-persistent/package.json` + `CHANGELOG.md`.
- `cd remfs-persistent && npm publish --access public` (2FA/browser auth).
- Tag on GitHub (`vX.Y.Z`) + `gh release create`.
