// Agent Presence Phase C (Dogfood): session dump tool — compaction never
// loses history; scripts/dump-session.js can always export the FULL dialogue
// straight from the persisted session log.
// Run: node --test test/dump-session.test.js
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractDialogue, renderDialogue } from '../scripts/dump-session.js'

const t = Date.now()
const ev = (type, data, time = t) => ({ seq: 0, type, time, data })

test('dump: extractDialogue picks user/assistant/tool/meta messages', () => {
  const lines = extractDialogue([
    ev('session/title', { title: 'my task' }, t),
    ev('user/message', { text: 'hello there' }, t + 1),
    ev('assistant/message', {
      message: { role: 'assistant', content: [
        { type: 'text', text: 'sure, doing it' },
        { type: 'tool-call', name: 'pwsh' },
      ] },
    }, t + 2),
    ev('tool/result', { name: 'pwsh', message: { role: 'tool', content: 'ok' } }, t + 3),
    ev('tool/result', { name: 'pwsh', error: { code: '1' } }, t + 4),
    ev('assistant/chunk', { chunk: { type: 'text', text: 'x' } }, t + 5), // not a message
  ])
  assert.equal(lines.length, 5, 'chunk is not a message and must be skipped')
  assert.equal(lines[0].role, 'meta')
  assert.match(lines[0].text, /my task/)
  assert.equal(lines[1].role, 'user')
  assert.equal(lines[1].text, 'hello there')
  assert.equal(lines[2].role, 'assistant')
  assert.match(lines[2].text, /sure, doing it/)
  assert.match(lines[2].text, /\[tool: pwsh\]/)
  assert.equal(lines[3].role, 'tool')
  assert.match(lines[3].text, /ok/)
  assert.equal(lines[4].role, 'tool')
  assert.match(lines[4].text, /error/)
})

test('dump: renderDialogue produces readable labeled output', () => {
  const out = renderDialogue([
    { time: null, role: 'user', text: 'hi' },
    { time: t, role: 'assistant', text: 'two\nlines' },
  ])
  assert.match(out, /YOU/)
  assert.match(out, /AGENT/)
  assert.match(out, /two\n\s+lines/)
})
