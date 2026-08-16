// Agent Presence Phase B UI pure-logic tests: Orb selection, Quick Peek,
// Task Board grouping, notification rules.
// Run: node --test test/presence-ui.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { STATE, makeTaskDTO } from '../lib/presence/contract.js'
import {
  orbState, quickPeek, groupTasks, boardCounts, shouldNotify,
  normalizeNotifySettings, DEFAULT_NOTIFY, BOARD_GROUPS, STATE_COLOR,
} from '../lib/presence/ui.js'

const t0 = Date.UTC(2026, 7, 17, 0, 0, 0)

function task(id, state, extra = {}) {
  return makeTaskDTO({ taskId: id, sessionId: id, state, title: extra.title || 'task ' + id, summary: extra.summary || '', progressHeartbeatAt: extra.progressHeartbeatAt || null, staleReason: extra.staleReason || null, updatedAt: extra.updatedAt || t0, ...extra })
}

// ------------------------------------------------------------ orb

test('orb: picks the highest-priority task state (NEEDS_USER first)', () => {
  // highestPriorityTask logic is in contract; orbState formats it
  const o = orbState(task('a', STATE.NEEDS_USER))
  assert.equal(o.state, STATE.NEEDS_USER)
  assert.equal(o.icon, '!')
  assert.equal(o.text, 'Needs you')
  assert.equal(o.taskId, 'a')
})

test('orb: state is icon+text, never color-only (all states have labels)', () => {
  for (const s of Object.values(STATE)) {
    const o = orbState(task('x', s))
    assert.ok(o.icon && o.text, 'orb for ' + s + ' must have icon+text')
  }
})

test('orb: no task -> IDLE', () => {
  const o = orbState(null)
  assert.equal(o.state, STATE.IDLE)
  assert.equal(o.taskId, null)
})

test('orb: floating ball accent color exists per state, icon+text still primary', () => {
  for (const s of Object.values(STATE)) {
    assert.ok(STATE_COLOR[s], 'every state needs an accent color, got none for ' + s)
    assert.match(STATE_COLOR[s], /^#[0-9a-fA-F]{6}$/, 'accent must be a hex color')
    const o = orbState(task('y', s))
    assert.equal(o.color, STATE_COLOR[s], 'orbState carries the accent color')
    assert.ok(o.icon && o.text, 'icon+text remain the primary carriers (never color-only)')
  }
  assert.equal(orbState(null).color, STATE_COLOR[STATE.IDLE])
})

// ------------------------------------------------------------ quick peek

test('quick peek: shows state, title, summary, stale reasons, last progress, actions', () => {
  const q = quickPeek(task('s1', STATE.STALE, {
    title: 'Refactor fs layer',
    summary: 'Agent is responsive, but no progress.',
    staleReason: ['No meaningful progress for 34m.', 'The same failure has repeated.'],
    progressHeartbeatAt: new Date(t0 - 34 * 60000).toISOString(),
  }), { now: t0 })
  assert.equal(q.state, STATE.STALE)
  assert.equal(q.title, 'Refactor fs layer')
  assert.ok(q.staleReason.length >= 2)
  assert.equal(q.lastProgressLabel, '34m ago')
  assert.deepEqual(q.actions, ['tasks', 'open'])
})

// ------------------------------------------------------------ task board

test('task board: groups by state; STALE nests under Running', () => {
  const tasks = [
    task('a', STATE.NEEDS_USER),
    task('b', STATE.RUNNING),
    task('c', STATE.STALE),
    task('d', STATE.IDLE),
    task('e', STATE.DONE),
    task('f', STATE.FAILED),
  ]
  const g = groupTasks(tasks)
  assert.equal(g.needsUser.length, 1)
  assert.equal(g.running.length, 2, 'RUNNING + STALE both under Running')
  assert.equal(g.running[0].stalled, true, 'stalled task first in Running group')
  assert.equal(g.notStarted.length, 1)
  assert.equal(g.done.length, 1)
  assert.equal(g.failed.length, 1)
  const counts = boardCounts(g)
  assert.equal(counts.running, 2)
})

test('task board: groups are the design §18 set (no Jira columns)', () => {
  const keys = BOARD_GROUPS.map((g) => g.key)
  assert.deepEqual(keys, ['needsUser', 'running', 'notStarted', 'done', 'failed'])
})

// ------------------------------------------------------------ notification

test('notification: triggers only on NEEDS_USER/FAILED by default', () => {
  const d = DEFAULT_NOTIFY
  assert.equal(d[STATE.NEEDS_USER], true)
  assert.equal(d[STATE.FAILED], true)
  assert.equal(d[STATE.RUNNING], false)
  assert.equal(d[STATE.STALE], false)
  assert.equal(d[STATE.DONE], false)
  assert.equal(d[STATE.IDLE], false)
  assert.equal(d[STATE.DISCONNECTED], false)
  assert.equal(shouldNotify(STATE.RUNNING, STATE.NEEDS_USER), true)
  assert.equal(shouldNotify(STATE.RUNNING, STATE.FAILED), true)
  assert.equal(shouldNotify(STATE.RUNNING, STATE.RUNNING), false, 'same state never notifies')
  assert.equal(shouldNotify(STATE.RUNNING, STATE.STALE), false, 'STALE is not an interrupt')
  assert.equal(shouldNotify(STATE.RUNNING, STATE.DONE), false, 'DONE off by default')
  assert.equal(shouldNotify(STATE.STALE, STATE.RUNNING), false, 'recovery is not an interrupt')
})

test('notification: DONE is user-configurable; unknown settings fail closed', () => {
  assert.equal(shouldNotify(STATE.RUNNING, STATE.DONE, { DONE: true }), true)
  assert.equal(shouldNotify(STATE.RUNNING, STATE.DONE, { DONE: false }), false)
  // junk settings fall back to defaults
  const n = normalizeNotifySettings({ RUNNING: true, nonsense: 1 })
  assert.equal(n[STATE.RUNNING], true)
  assert.equal(n[STATE.NEEDS_USER], true)
  assert.equal(n[STATE.DONE], false)
})
