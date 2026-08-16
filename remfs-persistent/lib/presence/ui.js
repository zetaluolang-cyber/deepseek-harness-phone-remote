// presence/ui.js — Phase B UI pure logic (Orb / Quick Peek / Task Board /
// notification rules). All pure Node: the client renders ONLY what these
// functions return, so the UI can be unit-tested and never re-derives state
// from raw events (design §25 — Orb/Tasks/Notification share one state source).
import { STATE, STATE_PRIORITY, STATE_LABEL, highestPriorityTask } from './contract.js'

/** Default notification settings (design §14): NEEDS_USER + FAILED always,
 *  DONE user-configurable, RUNNING/STALE never. */
export const DEFAULT_NOTIFY = Object.freeze({
  [STATE.NEEDS_USER]: true,
  [STATE.FAILED]: true,
  [STATE.DONE]: false,
  [STATE.STALE]: false,
  [STATE.RUNNING]: false,
  [STATE.IDLE]: false,
  [STATE.DISCONNECTED]: false,
})

/** Validate notification settings; unknown keys ignored, defaults for all states. */
export function normalizeNotifySettings(raw) {
  const s = raw && typeof raw === 'object' ? raw : {}
  const out = { ...DEFAULT_NOTIFY }
  for (const k of Object.keys(DEFAULT_NOTIFY)) {
    if (typeof s[k] === 'boolean') out[k] = s[k]
  }
  return out
}

/** True when a state transition should trigger a notification (§14). */
export function shouldNotify(prevState, nextState, settings) {
  const cfg = normalizeNotifySettings(settings)
  if (prevState === nextState) return false
  return cfg[nextState] === true
}

/**
 * Orb accent color (design §11): a visual aid ONLY — shape/icon + text remain
 * the primary state carriers, never color alone. Consumed by the floating
 * ball's ring so the ball stays recognizable at a glance.
 */
export const STATE_COLOR = Object.freeze({
  [STATE.IDLE]: '#8a8f98',
  [STATE.RUNNING]: '#4a9df7',
  [STATE.STALE]: '#ffb86b',
  [STATE.NEEDS_USER]: '#e06c6c',
  [STATE.FAILED]: '#d84545',
  [STATE.DONE]: '#2e9e4f',
  [STATE.DISCONNECTED]: '#6b7280',
})

/**
 * Orb state (design §11): shape/icon + text — never color-only.
 * @param {Object|null} task - highest-priority task DTO.
 * @returns {{ icon, text, color, state, taskId, title, summary }}
 */
export function orbState(task) {
  if (!task) {
    return { icon: '○', text: STATE_LABEL[STATE.IDLE].text, color: STATE_COLOR[STATE.IDLE], state: STATE.IDLE, taskId: null, title: '', summary: '' }
  }
  const label = STATE_LABEL[task.state] || STATE_LABEL[STATE.IDLE]
  return {
    icon: label.icon,
    text: label.text,
    color: STATE_COLOR[task.state] || STATE_COLOR[STATE.IDLE],
    state: task.state,
    taskId: task.sessionId || task.taskId || null,
    title: task.title || '',
    summary: task.summary || '',
  }
}

/**
 * Quick Peek mini-card content (design §12):
 *   state line, task title, summary, stale reason / last progress, actions.
 * @param {Object|null} task - highest-priority task DTO.
 * @param {Object} [opts] - { now } for relative "x min ago" strings.
 * @returns {Object} { state, icon, text, title, summary, staleReason,
 *   lastProgressLabel, actions: ['tasks','open'] }
 */
export function quickPeek(task, opts = {}) {
  const orb = orbState(task)
  const now = opts.now != null ? opts.now : Date.now()
  const lastProg = task && task.progressHeartbeatAt ? Date.parse(task.progressHeartbeatAt) : 0
  let lastProgressLabel = ''
  if (lastProg > 0) {
    const mins = Math.max(1, Math.floor((now - lastProg) / 60000))
    lastProgressLabel = mins < 60 ? mins + 'm ago' : Math.floor(mins / 60) + 'h ago'
  }
  return {
    state: orb.state,
    icon: orb.icon,
    text: orb.text,
    title: orb.title,
    summary: orb.summary,
    staleReason: task && task.staleReason ? task.staleReason : [],
    lastProgressLabel,
    actions: ['tasks', 'open'],
  }
}

/** Task Board groups (design §18): STALE nests under Running, not its own column. */
export const BOARD_GROUPS = Object.freeze([
  { key: 'needsUser', label: 'Needs You', states: [STATE.NEEDS_USER] },
  { key: 'running', label: 'Running', states: [STATE.RUNNING, STATE.STALE] },
  { key: 'notStarted', label: 'Not Started', states: [STATE.IDLE] },
  { key: 'done', label: 'Done', states: [STATE.DONE] },
  { key: 'failed', label: 'Failed', states: [STATE.FAILED] },
])

/** Group tasks for the board. STALE tasks carry a `stalled: true` flag. */
export function groupTasks(tasks) {
  const list = Array.isArray(tasks) ? tasks : []
  const groups = {}
  for (const g of BOARD_GROUPS) groups[g.key] = []
  for (const t of list) {
    const g = BOARD_GROUPS.find((x) => x.states.includes(t.state))
    const key = g ? g.key : 'notStarted'
    groups[key].push(t.state === STATE.STALE ? { ...t, stalled: true } : t)
  }
  for (const g of BOARD_GROUPS) {
    groups[g.key].sort((a, b) => {
      // within a group: stalled first (it needs a glance), then by updatedAt
      if (!!a.stalled !== !!b.stalled) return a.stalled ? -1 : 1
      return (b.updatedAt || 0) - (a.updatedAt || 0)
    })
  }
  return groups
}

/** Per-group summary counts for the board header (design §35-style). */
export function boardCounts(groups) {
  const out = {}
  for (const g of BOARD_GROUPS) out[g.key] = (groups[g.key] || []).length
  return out
}
