# Pocket Cockpit v0.3 Phase 1 — Review Preparation

Review target: commit `2957605` on `master` (pushed, CI green)
Repo: https://github.com/zetaluolang-cyber/deepseek-harness-phone-remote

This document prepares the read-only cockpit phase for review. Product spec:
`docs/pocket-cockpit-design.md` (v0.3 design, "Pocket Cockpit for DeepSeek Harness").

---

## 1. What was built (Phase 1 scope only)

A zero-app mobile supervision cockpit for DeepSeek Harness:

- `/pocket` RPC namespace, separate from `/remfs` (supervision vs filesystem capability)
- Session aggregation + classification: RUNNING / NEEDS_ATTENTION / FINISHED / FAILED / IDLE
- Away Mode (explicit start/stop, `awaySince`)
- Basic since-away delta counters (files changed, tool calls, errors, approvals, test runs)
- One-tap handoff: `ctx.sessions.open(id)` opens the EXISTING session (never forks/replaces)
- Mobile UI: Cockpit tab in the existing persistent workbench panel
- Device capability model (`files`/`cockpit`/`approval`), default for new + legacy devices

Explicitly NOT in Phase 1: approval response (no `approval.respond`/`approval.list`),
away-delta timeline, LLM summaries, any Phase 2/3/4 feature.

## 2. Architecture changes

```
remfs-persistent/
  lib/
    host.js          registers /remfs AND /pocket; device-auth + cockpit-capability gate
    client.js        Cockpit tab + CockpitPanel + away header + sections + handoff
    security.js      device capabilities (default files+cockpit+approval, legacy migration)
    cockpit/         NEW pure-Node modules (unit-testable, no Cordis/DOM)
      contract.js    stable wire DTOs, STATUS + capability vocabulary, normalizeAwayState
      classify.js    session classification rules
      delta.js       since-away counters (structured events only)
      away.js        away state file (~/.dsh/profiles/web/pocket-away.json, atomic write)
      service.js     host aggregator (DSH capabilities -> cockpit DTOs), fail-closed
    dispatch.js      unchanged (/remfs)
  test/cockpit.test.js   NEW 18 tests
```

Design-doc alignment notes:
- Separate /pocket namespace: implemented
- Away state NOT in remfs-security.json: implemented (own file in profile dir)
- Host-side aggregation into stable DTOs (client never parses raw DSH events): implemented
- Device capability layering: implemented at protocol level (no UI management)
- UI as independent Cockpit page / default home: NOT followed — Phase 1 put Cockpit as a
  third tab inside the existing workbench panel (minimal integration). Known deviation.

## 3. New files

| File | Role |
|---|---|
| `remfs-persistent/lib/cockpit/contract.js` | DTO shapes, STATUS, CAPABILITIES, away normalization |
| `remfs-persistent/lib/cockpit/classify.js` | classification rules (pure) |
| `remfs-persistent/lib/cockpit/delta.js` | delta counters (pure) |
| `remfs-persistent/lib/cockpit/away.js` | away state persistence (pure) |
| `remfs-persistent/lib/cockpit/service.js` | host aggregator over DSH capabilities |
| `remfs-persistent/test/cockpit.test.js` | 18 tests |

Modified: `lib/host.js`, `lib/client.js`, `lib/security.js`,
`test/client-contract.test.js`, `test/security.test.js`, `.github/workflows/ci.yml`,
`test/installer-patch.integration.ps1`, `README.md`.

## 4. DSH capabilities used

- `ctx.sessionQuery.listSessions()` -> SessionRecord[] (header: id, createdAt, cwd)
- `ctx.sessionQuery.listEvents(sessionId)` -> SessionEventRecord[] (seq, type, time)
- `ctx.sessionQuery.readTitle(sessionId)` -> title fallback
- `ctx.sessions.list()` / `ctx.agents.list()` -> live-presence hint for RUNNING
- `ctx.workspaceRegistry.list()` -> workspaceId -> path mapping
- Event vocabulary: `turn/start|end` (reason.kind), `tool/call|result` (error),
  `approval/asked|decided`, `session/title`

No DOM scraping, no CSS-selector reliance for core logic.

## 5. Session classification rules

Priority order (highest first):

| Status | Rule |
|---|---|
| NEEDS_ATTENTION | pending approval: `approval/asked` with no matching `approval/decided` |
| RUNNING | open turn (`turn/start` without later `turn/end`) OR live agent exists |
| FAILED | last `turn/end` reason.kind === 'error', no newer open turn |
| FINISHED | last `turn/end` reason.kind === 'completed', no newer open turn |
| IDLE | empty session, or last turn ended aborted/blocked/interrupted/max-tokens |

## 6. Away Mode data model

File: `~/.dsh/profiles/web/pocket-away.json` (project profile state dir — NOT
remfs-security.json; security vs product state deliberately separated).

```json
{ "away": true, "awaySince": "2026-08-16T15:30:00+09:00" }
{ "away": false, "awaySince": null }
```

- Explicit `cockpit.away.start` / `cockpit.away.stop` only; no presence detection
- Atomic write (tmp + rename); missing/corrupt file fails closed (not away)

## 7. RPC contract (/pocket)

All ops require a verified device credential AND the `cockpit` capability
(legacy devices without a capabilities field get the default set).

- `cockpit.status` -> { away, awaySince, serverTime, capabilities }
- `cockpit.sessions` -> { sessions: CockpitSessionDTO[], away, awaySince }
  DTO: { sessionId, workspaceId, workspacePath, title, goal, status, startedAt,
  lastActivityAt, lastAction {type,name,summary}, attention, delta
  {filesChanged, toolCalls, errors} }
- `cockpit.away.start` -> { away, awaySince }
- `cockpit.away.stop` -> { away, awaySince }

Envelope: { ok: true, value } | { ok: false, error: { code, message, details } }
(auth-invalid / capability-denied / capability-unavailable / bad-request).

## 8. Tests

Total node tests: **68/68 pass** (security 26, dispatch 11, client-contract 13,
cockpit 18). CI (5 jobs incl. real-DSH smoke) green on `2957605`.

Cockpit test coverage:
- classify: running -> RUNNING, finished -> FINISHED, failed -> FAILED,
  pending approval -> NEEDS_ATTENTION (and resolved approval -> not blocked),
  empty/aborted/interrupted -> IDLE, live-agent hint -> RUNNING
- away: start stores awaySince, stop clears, corrupt/missing fails closed,
  file lives in profile dir not the security store
- delta: counters + since-away windowing, empty log
- contract: DTO defaults, capability default/migration/gating, away normalization
- service: aggregation + classification + NEEDS_ATTENTION-first sort,
  away start/stop wiring, capability-unavailable fails closed
- security: new pair gets files+cockpit+approval, legacy device migration
- contract: host registers /pocket, capability gate, no approval ops in Phase 1,
  client handoff uses sessions.open (never fork/create)

## 9. Known limitations / deviations

1. UI placement: Cockpit is a third tab inside the existing workbench panel, not
   the design doc's "independent Pocket Cockpit page / default home". This is the
   main deviation; polish is deferred to Phase 4 pending review.
2. `title`/`goal`: sourced from `session/title` event or `readTitle()`; sessions
   without a title show "Untitled".
3. Delta `filesChanged`/`testRuns` are best-effort heuristics over tool names
   (write/edit/str-replace-editor; test-like names/args). No filesystem watcher,
   no DOM scraping. Git-diff supplement explicitly NOT implemented (Phase 3).
4. `NEEDS_ATTENTION` only covers pending approvals in Phase 1 (per spec: approval
   pending / question pending / failure needing intervention — questions and
   failure-intervention are deferred).
5. No UI for capability management (protocol layers only; default all).
6. Away mode is explicit-only (no presence detection by design).
7. Real-device end-to-end acceptance (spec section 17) not yet executed on a phone.

## 10. Review focus questions

1. Is the /pocket auth+capability gate correct and fail-closed?
2. Are the classification rules safe (no false NEEDS_ATTENTION / false FINISHED)?
3. Is separating away state from the security store the right call?
4. Is the Cockpit-as-tab placement acceptable for Phase 1, or should it become an
   independent page/default home now (deviation from the design doc)?
5. Delta heuristics: acceptable for Phase 1, or does anything need tightening?
6. Any event-vocabulary compatibility risk with upstream DSH changes?
