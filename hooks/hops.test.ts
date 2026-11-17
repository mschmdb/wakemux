import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

import type { Log } from './report-world'
import { fakeWorld, messages, notifications, sent, settle } from './report-world'

// Prompt texts as the engine delivered them to a thread on 17.11.2026, shortened.
const FROM_MAIN_BY_CMUX =
  '<task-notification>\n<summary>Stop hook feedback</summary>\n</task-notification>\n<system-reminder>\nStop hook blocking error from command "Stop": [cmux agent message] from main'
const FROM_MAIN_BY_PEER = 'Another Claude session sent a message:\n<cross-session-message from="uds:/tmp/cc-socks/1.sock" from-name="main">'
const SUBAGENT_DONE = '<task-notification>\n<task-id>a29724c111875e44f</task-id>\n<status>completed</status>'

type Start = { kind: string; text: string }
const fromMain: Start = { kind: 'task-notification', text: FROM_MAIN_BY_CMUX }
const peerFromMain: Start = { kind: 'peer', text: FROM_MAIN_BY_PEER }
const tick: Start = { kind: 'scheduled-trigger', text: 'Watcher tick' }
const subagent: Start = { kind: 'task-notification', text: SUBAGENT_DONE }
const typed: Start = { kind: 'composer', text: 'the last row overlaps' }

// One thread turn as the engine runs it: the prompt that starts it, the turn, its end.
async function turn($: Engine, log: Log, start: Start, answer: string, during?: Start) {
  const turnId = `t-${answer}`
  await $.prompt.submit({ text: start.text, origin: { kind: start.kind } as never, wait: false })
  await $.turn.start({ text: start.text, turnId })
  if (during) await $.prompt.submit({ text: during.text, origin: { kind: during.kind } as never, wait: false, turnId })
  await $.turn.complete({ answer, reason: 'answer', durationMs: 1, isAborted: false, turnId })
  await settle(log)
}

const world = (maxHops: string) => ({ parent: 'workspace:3', sendAnswer: () => sent('delivered'), env: { WAKEMUX_MAX_HOPS: maxHops } })

test('loop ticks with news on one commit never reach the hop limit', async ($, on) => {
  const log = fakeWorld(on, world('2'))
  for (const answer of ['PR 1 merged', 'PR 2 approved', 'PR 3 opened', 'Issue 4 new']) await turn($, log, tick, answer)
  expect(messages(log).length).toBe(4)
  expect(log.texts.some(text => text.includes('reports in a row'))).toBe(false)
  expect(notifications(log)).toEqual([])
})

test('answers to messages from main still escalate and pause, by cmux or by peer message', async ($, on) => {
  const log = fakeWorld(on, world('2'))
  await turn($, log, fromMain, 'Question 1')
  await turn($, log, peerFromMain, 'Question 2')
  await turn($, log, fromMain, 'Question 3')
  await turn($, log, peerFromMain, 'Question 4')
  expect(messages(log).length).toBe(2)
  expect(log.texts[1]).toContain('2 reports in a row without a new commit')
  expect(notifications(log).length).toBe(1)
})

test('subagent results do not count', async ($, on) => {
  const log = fakeWorld(on, world('1'))
  await turn($, log, fromMain, 'Started the review')
  await turn($, log, subagent, 'Review 1 found nothing')
  await turn($, log, subagent, 'Review 2 found nothing')
  expect(messages(log).length).toBe(3)
  expect(notifications(log)).toEqual([])
})

test('a paused thread still reports its ticks, its answers to main stay paused', async ($, on) => {
  const log = fakeWorld(on, world('1'))
  await turn($, log, fromMain, 'Answer 1')
  await turn($, log, fromMain, 'Answer 2')
  await turn($, log, tick, 'PR 5 merged')
  await turn($, log, fromMain, 'Answer 3')
  expect(messages(log).length).toBe(2)
  expect(log.texts[1]).toContain('PR 5 merged')
  expect(notifications(log).length).toBe(1)
})

test('a prompt the user types in the thread lifts a pause and starts the count again', async ($, on) => {
  const log = fakeWorld(on, world('1'))
  await turn($, log, fromMain, 'Answer 1')
  await turn($, log, fromMain, 'Answer 2')
  await turn($, log, fromMain, 'Answer 3')
  await turn($, log, typed, 'Fixed the overlap')
  await turn($, log, fromMain, 'Answer 4')
  expect(messages(log).length).toBe(3)
  expect(log.texts[1]).toContain('Fixed the overlap')
  expect(log.texts[1]).not.toContain('reports in a row')
  expect(log.texts[2]).toContain('1 reports in a row without a new commit')
})

test('a message delivered into a running turn does not change what started the turn', async ($, on) => {
  const log = fakeWorld(on, world('1'))
  await turn($, log, fromMain, 'Answer 1')
  await turn($, log, tick, 'PR 6 merged', fromMain)
  expect(messages(log).length).toBe(2)
  expect(notifications(log)).toEqual([])
})

test('a turn whose start the mod did not see counts, as before', async ($, on) => {
  const log = fakeWorld(on, world('1'))
  await turn($, log, fromMain, 'Answer 1')
  await $.turn.complete({ answer: 'Answer 2', reason: 'answer', durationMs: 1, isAborted: false, turnId: 't-unseen' })
  await settle(log)
  expect(messages(log).length).toBe(1)
  expect(notifications(log).length).toBe(1)
})
