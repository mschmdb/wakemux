import { expect, test } from 'claude-code/testing'

import {
  escalationNote,
  forwardText,
  hopAction,
  isDuplicate,
  messageState,
  nextHops,
  notifyBody,
  parseSent,
  parseSessionId,
  keepWaiting,
  reportKey,
} from './delivery'

const SENT = JSON.stringify({
  id: 'cdb622b5-f362-4cea-9122-f2943403d63c',
  state: 'queued',
  recipient_has_agent: true,
  recipient_surface_id: '9969F17D-E8A9-4964-8F25-A3C0619120E2',
  recipient_workspace_ref: 'workspace:7',
})

test('parseSent reads id, state, recipient and whether an agent runs there', () => {
  expect(parseSent(SENT)).toEqual({
    id: 'cdb622b5-f362-4cea-9122-f2943403d63c',
    state: 'queued',
    hasAgent: true,
    surfaceId: '9969F17D-E8A9-4964-8F25-A3C0619120E2',
  })
})

test('parseSent treats a missing agent flag as no agent and rejects junk', () => {
  expect(parseSent(JSON.stringify({ id: 'a', state: 'queued', recipient_surface_id: 's' }))?.hasAgent).toBe(false)
  expect(parseSent('not json')).toBe(null)
  expect(parseSent('[]')).toBe(null)
  expect(parseSent(JSON.stringify({ state: 'queued' }))).toBe(null)
})

test('messageState finds a message by id in the inbox listing', () => {
  const inbox = JSON.stringify({ messages: [{ id: 'x', state: 'delivered' }, { id: 'y', state: 'queued' }] })
  expect(messageState(inbox, 'y')).toBe('queued')
  expect(messageState(inbox, 'x')).toBe('delivered')
  expect(messageState(inbox, 'z')).toBe('')
  expect(messageState('broken', 'x')).toBe('')
  expect(messageState(JSON.stringify({ messages: 'no' }), 'x')).toBe('')
})

test('nextHops counts reports in a row on the same commit and restarts on a new one', () => {
  const first = nextHops({ head: '', count: 0 }, 'aaa')
  expect(first).toEqual({ head: 'aaa', count: 1 })
  const second = nextHops(first, 'aaa')
  expect(second).toEqual({ head: 'aaa', count: 2 })
  expect(nextHops(second, 'bbb')).toEqual({ head: 'bbb', count: 1 })
})

test('hopAction sends below the limit, escalates at it and only notifies above it', () => {
  expect(hopAction(1, 3)).toBe('send')
  expect(hopAction(2, 3)).toBe('send')
  expect(hopAction(3, 3)).toBe('escalate')
  expect(hopAction(4, 3)).toBe('notify')
  expect(hopAction(5, 3)).toBe('silent')
})

test('maxHops 0 turns the limit off', () => {
  expect(hopAction(1, 0)).toBe('send')
  expect(hopAction(500, 0)).toBe('send')
})

test('maxHops 1 escalates on the first report without a new commit', () => {
  expect(hopAction(1, 1)).toBe('escalate')
  expect(hopAction(2, 1)).toBe('notify')
})

test('escalationNote tells the main session to stop answering and ask the user', () => {
  const note = escalationNote(6)
  expect(note).toContain('6 reports in a row without a new commit')
  expect(note).toContain('ask the user')
})

test('the same report within a minute is a duplicate, a changed one is not', () => {
  const report = { slug: 's', branch: 'b', ahead: 1, dirty: 0, reason: 'answer' as const, answer: 'Done.' }
  const key = reportKey(report)
  expect(isDuplicate({ key, at: 1_000 }, key, 30_000)).toBe(true)
  expect(isDuplicate({ key, at: 1_000 }, key, 61_001)).toBe(false)
  expect(isDuplicate({ key, at: 1_000 }, reportKey({ ...report, answer: 'Done!' }), 2_000)).toBe(false)
  expect(isDuplicate({ key, at: 1_000 }, reportKey({ ...report, ahead: 2 }), 2_000)).toBe(false)
  expect(isDuplicate({ key: '', at: 0 }, key, 2_000)).toBe(false)
  expect(isDuplicate({ key, at: 1_000 }, reportKey(report, 'other-head'), 2_000)).toBe(false)
  expect(isDuplicate({ key, at: 1_000 }, reportKey({ ...report, branch: 'c' }), 2_000)).toBe(false)
})

test('reportKey tells long answers apart that differ only in the middle', () => {
  const base = { slug: 's', branch: 'b', ahead: 0, dirty: 0, reason: 'answer' as const }
  const a = 'x'.repeat(500) + 'A' + 'x'.repeat(500)
  const b = 'x'.repeat(500) + 'B' + 'x'.repeat(500)
  expect(reportKey({ ...base, answer: a })).not.toBe(reportKey({ ...base, answer: b }))
})

test('forwardText marks the copy so the main session answers once', () => {
  const text = forwardText('[Thread s] waiting for input.')
  expect(text).toContain('[Thread s] waiting for input.')
  expect(text).toContain('same report')
})

test('notifyBody takes the first line of the answer, shortened', () => {
  expect(notifyBody('[Thread s] waiting for input. Branch b.\n\nWhich colour?\nMore')).toBe('Which colour?')
  expect(notifyBody('[Thread s] aborted.\n\n')).toBe('[Thread s] aborted.')
  expect(notifyBody('[Thread s] x.\n\n' + 'y'.repeat(500)).length).toBeLessThanOrEqual(200)
})

test('parseSessionId accepts session ids and rejects anything else', () => {
  expect(parseSessionId('8c4667e8-d867-4c6b-b592-663cf1c845b2\n')).toBe('8c4667e8-d867-4c6b-b592-663cf1c845b2')
  expect(parseSessionId('session_01YRnNFqVZhHnDBD6icYZkHz')).toBe('session_01YRnNFqVZhHnDBD6icYZkHz')
  expect(parseSessionId('$(rm -rf ~)')).toBe('')
  expect(parseSessionId('')).toBe('')
})

test('keepWaiting waits while the receiving session works, up to ten minutes', () => {
  expect(keepWaiting('Running', 15_000)).toBe(true)
  expect(keepWaiting('Running', 599_000)).toBe(true)
  expect(keepWaiting('Running', 600_000)).toBe(false)
  expect(keepWaiting('Idle', 15_000)).toBe(false)
  expect(keepWaiting('', 15_000)).toBe(false)
})
