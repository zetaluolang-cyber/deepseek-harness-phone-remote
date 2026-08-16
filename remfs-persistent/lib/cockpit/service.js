// cockpit/service.js — host-side Pocket Cockpit aggregator (v0.3 Phase 1).
//
// Adapts real DSH capabilities into the stable Pocket Cockpit contract:
//   - ctx.sessionQuery.listSessions()       -> SessionRecord[] (header, live, persisted)
//   - ctx.sessionQuery.listEvents(id)       -> SessionEventRecord[] (lightweight)
//   - ctx.sessionQuery.readTitle(id)        -> SessionTitleSnapshot (goal/title)
//   - ctx.sessions.list() / ctx.agents.list() -> live presence (RUNNING hint)
//   - ctx.workspaceRegistry.list()          -> workspace id/path mapping
//
// It NEVER parses the DSH DOM and never scrapes the web UI. If a capability
// is unavailable at apply time, the aggregator fails closed (returns an empty
// cockpit with an error flag) instead of inventing data.
//
// The service is parameterized over the DSH context so it stays unit-testable
// with a fake capability set.
import { classifySession } from './classify.js'
import { computeDelta } from './delta.js'
import { loadAwayState, startAway, stopAway } from './away.js'
import { loadLastCheckState, markChecked } from './check.js'
import {
  STATUS, STATUS_ORDER, makeSessionDTO, awaySinceMs,
} from './contract.js'

function err(code, message) {
  return { ok: false, error: { code, message, details: {} } }
}

/**
 * Build the host aggregator.
 * @param {Object} ctx - DSH context (ctx.get used defensively).
 * @param {Object} [opts] - { awayFile, checkFile } overrides for tests.
 */
export function createCockpitService(ctx, opts = {}) {
  const awayFile = opts.awayFile
  const checkFile = opts.checkFile

  /** Resolve one session's title: session/title event, else readTitle(). */
  async function sessionTitle(sessionId, events) {
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i]
      if (e.type === 'session/title' && e.data && e.data.title) return String(e.data.title)
    }
    const sq = ctx.get && ctx.get('sessionQuery')
    if (sq && typeof sq.readTitle === 'function') {
      try {
        const t = await sq.readTitle(sessionId)
        if (t && t.title) return String(t.title)
      } catch { /* fall through */ }
    }
    return ''
  }

  /** Workspace mapping: workspaceId -> path. */
  function workspaceIndex() {
    const wr = ctx.get && ctx.get('workspaceRegistry')
    if (!wr || typeof wr.list !== 'function') return new Map()
    try {
      const map = new Map()
      const list = wr.list() || []
      for (const w of list) {
        if (w && w.id && w.path) map.set(String(w.id), String(w.path))
      }
      return map
    } catch { return new Map() }
  }

  /** Live session ids (presence hints for RUNNING). */
  function liveSessionIds() {
    const out = new Set()
    const sessions = ctx.get && ctx.get('sessions')
    if (sessions && typeof sessions.list === 'function') {
      try {
        for (const s of sessions.list() || []) if (s && s.id) out.add(String(s.id))
      } catch { /* ignore */ }
    }
    const agents = ctx.get && ctx.get('agents')
    if (agents && typeof agents.list === 'function') {
      try {
        for (const a of agents.list() || []) {
          const sid = a && (a.sessionId || a.id)
          if (sid) out.add(String(sid))
        }
      } catch { /* ignore */ }
    }
    return out
  }

  /** Lightweight event records for one session (fail-closed on error). */
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

  /** Aggregate ONE session into a cockpit DTO with an explicit delta window. */
  async function aggregateSession(record, wsMap, live, sinceMs) {
    const id = String(record.id || record.sessionId || '')
    if (!id) return null
    const events = await sessionEvents(id)
    const status = classifySession(events, { liveAgent: live.has(id) })
    const title = await sessionTitle(id, events)
    const delta = computeDelta(events, sinceMs)
    const startedAt = record.header && record.header.createdAt
      ? Number(record.header.createdAt)
      : (firstTime(events) || 0)
    const lastActivityAt = lastTime(events) || startedAt
    const wsId = record.workspaceId || (record.header && record.header.workspaceId) || null
    const wsPath = wsId
      ? (wsMap.get(String(wsId)) || null)
      : ((record.header && record.header.cwd) || null)

    return makeSessionDTO({
      sessionId: id,
      workspaceId: wsId ? String(wsId) : null,
      workspacePath: wsPath,
      title,
      goal: title,
      status,
      startedAt,
      lastActivityAt,
      lastAction: lastActionOf(events),
      attention: status === STATUS.NEEDS_ATTENTION
        ? { kind: 'approval', summary: 'Agent is waiting for your approval' }
        : null,
      delta,
    })
  }

  return {
    /**
     * cockpit.status — away + last-check + device capabilities.
     * @param {Object} device - verified device (has capabilities).
     */
    async status(device) {
      const away = await loadAwayState(awayFile)
      const check = await loadLastCheckState(checkFile)
      return {
        ok: true,
        value: {
          away: away.away,
          awaySince: away.awaySince,
          lastCockpitViewedAt: check.lastCockpitViewedAt,
          lastCheckAt: check.lastCheckAt,
          serverTime: new Date().toISOString(),
          capabilities: (device && device.capabilities) || [],
        },
      }
    },

    /**
     * cockpit.sessions — aggregated, classified, sorted cockpit DTOs.
     * Delta anchor (design §10): awaySince when Away Mode is active, else the
     * automatic lastCockpitViewedAt — the user never has to Start Away first.
     */
    async sessions() {
      const sq = ctx.get && ctx.get('sessionQuery')
      if (!sq || typeof sq.listSessions !== 'function') {
        return err('capability-unavailable', 'sessionQuery capability unavailable (pocket cockpit disabled)')
      }
      let records
      try {
        records = await sq.listSessions()
      } catch (e) {
        return err('sessions-unavailable', String((e && e.message) || e))
      }
      const list = Array.isArray(records) ? records : []
      const wsMap = workspaceIndex()
      const live = liveSessionIds()
      const away = await loadAwayState(awayFile)
      const check = await loadLastCheckState(checkFile)
      const sinceMs = away.away && awaySinceMs(away.awaySince) > 0
        ? awaySinceMs(away.awaySince)
        : check.lastCockpitViewedAt

      const dtos = []
      for (const record of list) {
        const dto = await aggregateSession(record, wsMap, live, sinceMs)
        if (dto) dtos.push(dto)
      }
      // Attention-first order: NEEDS YOU > FAILED > RUNNING > FINISHED > IDLE.
      dtos.sort((a, b) => {
        const order = STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
        if (order !== 0) return order
        return b.lastActivityAt - a.lastActivityAt
      })
      return {
        ok: true,
        value: {
          sessions: dtos,
          away: away.away,
          awaySince: away.awaySince,
          lastCockpitViewedAt: check.lastCockpitViewedAt,
        },
      }
    },

    /** cockpit.away.start — enter Away Mode (explicit; no presence detection). */
    async awayStart() {
      const state = await startAway(awayFile)
      return { ok: true, value: { away: state.away, awaySince: state.awaySince } }
    },

    /** cockpit.away.stop — leave Away Mode. */
    async awayStop() {
      const state = await stopAway(awayFile)
      return { ok: true, value: { away: state.away, awaySince: state.awaySince } }
    },

    /** cockpit.check — record an automatic "since last check" anchor. */
    async check() {
      const state = await markChecked(checkFile)
      return { ok: true, value: { lastCockpitViewedAt: state.lastCockpitViewedAt, lastCheckAt: state.lastCheckAt } }
    },
  }
}

/** First event time (ms). */
function firstTime(events) {
  for (const e of events) if (e && Number(e.time)) return Number(e.time)
  return 0
}

/** Last event time (ms). */
function lastTime(events) {
  let t = 0
  for (const e of events) if (e && Number(e.time)) t = Number(e.time)
  return t
}

/** Last meaningful action: last tool/call summary, else last user message. */
function lastActionOf(events) {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (!e) continue
    if (e.type === 'tool/call') {
      const name = String((e.data && e.data.name) || e.name || 'tool')
      const args = String((e.data && e.data.arguments) || e.arguments || '')
      let summary = name
      if (args) {
        try {
          const parsed = JSON.parse(args)
          if (parsed && parsed.command) summary = name + ' ' + String(parsed.command).slice(0, 120)
        } catch { /* keep raw name */ }
      }
      return { type: 'tool', name, summary }
    }
    if (e.type === 'user/message') {
      const text = String((e.data && e.data.content) || e.content || 'user message').slice(0, 120)
      return { type: 'user', name: 'user', summary: text }
    }
  }
  return null
}
