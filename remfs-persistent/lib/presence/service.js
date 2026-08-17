// presence/service.js — AgentPresenceService (Agent Presence 设计书 Phase A).
//
// THE single source of truth for presence state. Phase B (Orb / Tasks /
// Notification) must consume ONLY the task DTOs this service produces; no UI
// re-derives state from raw events (design §25).
//
// Aggregates real DSH capabilities:
//   - ctx.sessionQuery.listSessions() / listEvents(id) / readTitle(id)
//   - ctx.sessions.list() / ctx.agents.list()  (live presence)
//   - ctx.workspaceRegistry.list()             (workspace mapping)
//
// Per session it derives:
//   - system heartbeat   = last event time (log liveness)
//   - progress heartbeat = last MEANINGFUL progress event (heartbeat.js)
//   - pending approval   = approval/asked without matching approval/decided
//   - terminal failure   = last turn ended 'error' OR tool failure in last turn
//   - completed          = last turn ended 'completed' (with no later open turn)
//   - agentRunning       = open turn / live agent / recent activity
//
// State resolution + STALE heuristic + explainable reasons are pure modules
// (state.js / heartbeat.js / summary.js). The service only wires real data in.
import { foldHeartbeats, isSystemAlive, isProgressStale } from './heartbeat.js'
import { resolveState, transition } from './state.js'
import { summarize, staleReasonLines } from './summary.js'
import {
  STATE, STATE_PRIORITY, highestPriorityTask, makeTaskDTO, normalizeStaleMs,
} from './contract.js'
import { API_ENGINE, API_VERSION } from './api.js'

function err(code, message) {
  return { ok: false, error: { code, message, details: {} } }
}

// ── Pure event-derivation helpers ──────────────────────────────────────────
// File-level exports so the Dogfood CLI (scripts/dogfood-board.js) derives
// state from the SAME logic the live service uses (single source of truth,
// design §25). The service wires real ctx data in; these functions only look
// at event records [{ type, time, data }].

/** True when an approval/asked has no matching decided (design §4.4). */
export function hasPendingApproval(events) {
  const asked = new Set()
  for (const e of events) {
    if (e.type === 'approval/asked') {
      const id = e.data && e.data.id != null ? String(e.data.id) : null
      if (id) asked.add(id)
    } else if (e.type === 'approval/decided') {
      const id = e.data && e.data.id != null ? String(e.data.id) : null
      if (id) asked.delete(id)
    }
  }
  return asked.size > 0
}

/** True when the last turn ended 'error' or the last CLOSED turn had a tool
 *  failure. A still-open turn is NOT a failure: the agent is working and an
 *  error may self-recover (design §4.2: FAILED = stopped and cannot
 *  self-recover). */
export function terminalFailure(events) {
  if (hasOpenTurn(events)) return false
  const lastReason = lastTurnEndKind(events)
  if (lastReason === 'error') return true
  if (lastReason === 'completed') return hasToolErrorInLastTurn(events)
  return false
}

/** True when the last turn ended 'completed' and no turn is open. */
export function completed(events) {
  return lastTurnEndKind(events) === 'completed' && !hasOpenTurn(events)
}

/** True when a turn is open or a live agent drives the session. */
export function agentRunning(events, live) {
  if (live) return true
  return hasOpenTurn(events)
}

/** Last turn/end reason.kind (null when none). */
export function lastTurnEndKind(events) {
  let kind = null
  for (const e of events) {
    if (e.type !== 'turn/end') continue
    kind = e.data && e.data.reason && e.data.reason.kind ? String(e.data.reason.kind) : 'completed'
  }
  return kind
}

/** True when the last CLOSED turn contains a tool/result.error. The open
 *  (current) turn is excluded: its errors are recoverable while it runs. */
export function hasToolErrorInLastTurn(events) {
  let endIdx = -1
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type === 'turn/end') { endIdx = i; break }
  }
  if (endIdx < 0) return false
  let startIdx = 0
  for (let i = endIdx - 1; i >= 0; i--) {
    if (events[i].type === 'turn/start') { startIdx = i; break }
  }
  for (let i = startIdx; i < endIdx; i++) {
    const e = events[i]
    if (e.type === 'tool/result' && ((e.data && e.data.error) || e.error)) return true
  }
  return false
}

export function hasOpenTurn(events) {
  let open = false
  for (const e of events) {
    if (e.type === 'turn/start') open = true
    else if (e.type === 'turn/end') open = false
  }
  return open
}

/** Count file-mutation tool calls (for STALE facts). */
export function fileChangeCount(events) {
  let n = 0
  for (const e of events) {
    if (e.type !== 'tool/call') continue
    const name = String((e.data && e.data.name) || e.name || '')
    if (/(^|\/)(write|edit)(_|$)/.test(name)) n += 1
  }
  return n
}

/** Title from the LAST session/title event ("" when absent). */
export function titleFromEvents(events) {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (e.type === 'session/title' && e.data && e.data.title) return String(e.data.title)
  }
  return ''
}

/** First event time (ms epoch; 0 when none). */
export function firstTime(events) {
  for (const e of events) if (e && Number(e.time)) return Number(e.time)
  return 0
}

/** Last event time (ms epoch; 0 when none). */
export function lastTime(events) {
  let t = 0
  for (const e of events) if (e && Number(e.time)) t = Number(e.time)
  return t
}

/**
 * Build the presence aggregator.
 * @param {Object} ctx - DSH context (ctx.get used defensively).
 * @param {Object} [opts] - { staleMinutes } threshold override.
 */
export function createPresenceService(ctx, opts = {}) {
  const staleMs = normalizeStaleMs(opts.staleMinutes)
  // seen-map persists across reconciles so repeated events across calls are
  // suppressed from progress (design §6: duplicate does not advance).
  // Per-SESSION maps: an identical tool call in a DIFFERENT session is
  // independent progress (dogfood finding: a shared map suppressed the
  // second session's identical call and misjudged it STALE).
  const seenBySession = new Map()

  /** Lightweight event records for one session (fail-closed). */
  async function sessionEvents(sessionId) {
    const sq = ctx.get && ctx.get('sessionQuery')
    if (!sq || typeof sq.listEvents !== 'function') return []
    try {
      const records = await sq.listEvents(sessionId)
      return Array.isArray(records) ? records : []
    } catch {
      return []
    }
  }

  /** Workspace id → path map. */
  function workspaceIndex() {
    const wr = ctx.get && ctx.get('workspaceRegistry')
    if (!wr || typeof wr.list !== 'function') return new Map()
    try {
      const map = new Map()
      for (const w of wr.list() || []) if (w && w.id && w.path) map.set(String(w.id), String(w.path))
      return map
    } catch { return new Map() }
  }

  /** Live session ids (agentRunning hint). */
  function liveSessionIds() {
    const out = new Set()
    const sessions = ctx.get && ctx.get('sessions')
    if (sessions && typeof sessions.list === 'function') {
      try { for (const s of sessions.list() || []) if (s && s.id) out.add(String(s.id)) } catch { /* ignore */ }
    }
    const agents = ctx.get && ctx.get('agents')
    if (agents && typeof agents.list === 'function') {
      try { for (const a of agents.list() || []) { const sid = a && (a.sessionId || a.id); if (sid) out.add(String(sid)) } } catch { /* ignore */ }
    }
    return out
  }

  /** Title from session/title event or readTitle(). */
  async function titleOf(sessionId, events) {
    const t = titleFromEvents(events)
    if (t) return t
    const sq = ctx.get && ctx.get('sessionQuery')
    if (sq && typeof sq.readTitle === 'function') {
      try {
        const r = await sq.readTitle(sessionId)
        if (r && r.title) return String(r.title)
      } catch { /* fall through */ }
    }
    return ''
  }

  /** Aggregate ONE session into a presence task DTO. */
  async function aggregateSession(record, wsMap, live, now, prevStates) {
    const id = String(record.id || record.sessionId || '')
    if (!id) return null
    const events = await sessionEvents(id)
    let seen = seenBySession.get(id)
    if (!seen) { seen = new Map(); seenBySession.set(id, seen) }
    const hb = foldHeartbeats(events, { now, seen })
    const pending = hasPendingApproval(events)
    const failed = terminalFailure(events)
    const done = completed(events)
    const running = agentRunning(events, live.has(id))

    const staleReasons = []
    const state = resolveState({
      systemHeartbeatAt: hb.systemHeartbeatAt,
      progressHeartbeatAt: hb.progressHeartbeatAt,
      pendingApproval: pending,
      terminalFailure: failed,
      completed: done,
      agentRunning: running,
      now,
      staleMs,
      observedErrorCount: hb.errorCount,
    }, staleReasons)
    const prev = prevStates.get(id)
    // design §21: DONE/FAILED only leave via a NEW task. Phase A has no task
    // identity, so a freshly OPENED turn is the new-task signal: the agent is
    // clearly working again (dogfood finding: a turn opened after a restart
    // or a new user message must recover to RUNNING, not stay FAILED forever).
    const finalState = (prev === STATE.DONE || prev === STATE.FAILED) && hasOpenTurn(events)
      ? state
      : transition(prev, state)

    const title = await titleOf(id, events)
    const summary = summarize(events, finalState)
    const startedAt = (record.header && record.header.createdAt)
      ? Number(record.header.createdAt)
      : (firstTime(events) || now)
    const updatedAt = hb.systemHeartbeatAt || lastTime(events) || startedAt
    const wsId = record.workspaceId || (record.header && record.header.workspaceId) || null
    const wsPath = wsId ? (wsMap.get(String(wsId)) || null) : ((record.header && record.header.cwd) || null)

    const task = makeTaskDTO({
      taskId: id,
      sessionId: id,
      workspaceId: wsId ? String(wsId) : null,
      title,
      state: finalState,
      summary,
      systemHeartbeatAt: hb.systemHeartbeatAt ? new Date(hb.systemHeartbeatAt).toISOString() : null,
      progressHeartbeatAt: hb.progressHeartbeatAt ? new Date(hb.progressHeartbeatAt).toISOString() : null,
      startedAt,
      updatedAt,
      attention: finalState === STATE.NEEDS_USER ? { kind: 'approval', summary: 'Agent is waiting for you' } : null,
      staleReason: finalState === STATE.STALE ? staleReasonLines({
        progressMins: hb.progressHeartbeatAt ? Math.max(1, Math.floor((now - hb.progressHeartbeatAt) / 60000)) : 0,
        errorCount: hb.errorCount,
        repeatedError: hb.errorCount > 1,
        fileChanges: fileChangeCount(events),
        taskTransitions: 0,
      }) : null,
    })
    return task
  }

  return {
    /**
     * presence.status — presence engine availability + stale threshold.
     * Frozen v1 shape (docs/presence-api-v1.md): engine + apiVersion.
     * @param {Object} device - verified device.
     */
    async status(device) {
      return {
        ok: true,
        value: {
          engine: API_ENGINE,
          apiVersion: API_VERSION,
          staleMinutes: Math.round(staleMs / 60000),
          serverTime: new Date().toISOString(),
          capabilities: (device && device.capabilities) || [],
        },
      }
    },

    /**
     * presence.tasks — the full task snapshot (single source of truth).
     * Includes the highest-priority task for a single-Orb display.
     */
    async tasks() {
      const sq = ctx.get && ctx.get('sessionQuery')
      if (!sq || typeof sq.listSessions !== 'function') {
        return err('capability-unavailable', 'sessionQuery capability unavailable (presence disabled)')
      }
      let records
      try {
        records = await sq.listSessions()
      } catch (e) {
        return err('sessions-unavailable', String((e && e.message) || e))
      }
      const list = Array.isArray(records) ? records : []
      const now = Date.now()
      const wsMap = workspaceIndex()
      const live = liveSessionIds()
      const prevStates = new Map(this._lastStates || [])
      const tasks = []
      for (const record of list) {
        const t = await aggregateSession(record, wsMap, live, now, prevStates)
        if (t) tasks.push(t)
      }
      // remember states for the next reconcile (transition guard)
      this._lastStates = new Map(tasks.map((t) => [t.sessionId, t.state]))
      tasks.sort((a, b) => {
        const pa = STATE_PRIORITY[a.state] ?? 99
        const pb = STATE_PRIORITY[b.state] ?? 99
        if (pa !== pb) return pa - pb
        return b.updatedAt - a.updatedAt
      })
      const orb = highestPriorityTask(tasks)
      return { ok: true, value: { tasks, orb } }
    },
  }
}
