import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

// The test environment has timers; the plugin typings leave them out because hooks use $.clock.
declare const setTimeout: (callback: () => void, ms: number) => unknown

const SURFACE = 'A1F46742-427C-42DC-9773-A0ACE004570B'
// clock.now is in milliseconds, cmux's delivered_at in seconds.
const NOW_MS = 2_000_000
const TURN_MS = 60_000
const TURN_START_S = (NOW_MS - TURN_MS) / 1000

type World = { surface?: string; inbox?: Record<string, unknown>[]; sendFails?: number }
type Log = { messages: { argv: string[]; text: string }[]; inboxCalls: string[][]; calls: number }

const report = (id: string, deliveredAt: number) => ({
  id,
  state: 'read',
  body: `[Thread ${id}] waiting for input. Branch thread/${id}, 1 commit, clean.\n\nDone.`,
  delivered_at: deliveredAt,
})

// A main session: not in a worktree, so the thread report part of the mod does nothing.
function fakeWorld(on: On, world: World): Log {
  const log: Log = { messages: [], inboxCalls: [], calls: 0 }
  on('process.run', (_, e) => {
    log.calls++
    const argv = [...e.argv]
    const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (argv[0] === 'cmux' && argv[1] === 'agent' && argv[2] === 'inbox') {
      log.inboxCalls.push(argv.slice(3))
      return ok(JSON.stringify({ messages: world.inbox ?? [] }))
    }
    if (argv[0] === 'cmux' && argv[1] === 'agent' && argv[2] === 'message') {
      log.messages.push({ argv: argv.slice(3), text: e.init?.stdin ?? '' })
      if ((world.sendFails ?? 0) > 0) {
        world.sendFails = (world.sendFails ?? 0) - 1
        return { value: { exitCode: 1, stdout: '', stderr: 'socket closed', isStdoutTruncated: false, isStderrTruncated: false } }
      }
      return ok(JSON.stringify({ id: 'nudge', state: 'queued', recipient_has_agent: true }))
    }
    return { value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('env.get', (_, e) => ({ value: e.name === 'CMUX_SURFACE_ID' ? world.surface : undefined }))
  on('env.set', () => ({ value: {} }))
  on('clock.now', () => ({ value: NOW_MS }))
  on('clock.sleep', () => ({ value: undefined }))
  on('session.id', () => ({ value: 'main-session' }))
  on('session.root', () => ({ value: '/r' }))
  on('fs.exists', () => ({ value: false }))
  on('turn.complete', () => ({ text: '' }))
  return log
}

async function complete($: Engine, log: Log, turn: string, agentId?: string) {
  await end($, turn, agentId)
  await settle(log)
}

function end($: Engine, turn: string, agentId?: string) {
  return $.turn.complete({ answer: 'ok', reason: 'answer', durationMs: TURN_MS, isAborted: false, turnId: turn, ...(agentId ? { agentId } : {}) })
}

async function settle(log: Log) {
  let quiet = 0
  let seen = log.calls
  for (let round = 0; round < 5000 && quiet < 30; round++) {
    await new Promise<void>(resolve => setTimeout(resolve, 0))
    quiet = log.calls === seen ? quiet + 1 : 0
    seen = log.calls
  }
}

test('a report that arrived mid-turn makes the session nudge itself once the turn ends', async ($, on) => {
  const log = fakeWorld(on, { surface: SURFACE, inbox: [report('late', TURN_START_S + 30), report('starter', TURN_START_S)] })
  await complete($, log, 't1')
  expect(log.inboxCalls[0]).toEqual(['--surface', SURFACE, '--json', '--limit', '50'])
  expect(log.messages.length).toBe(1)
  expect(log.messages[0]?.argv.slice(0, 3)).toEqual([SURFACE, '--from', 'wakemux'])
  expect(log.messages[0]?.text).toContain('[Thread late] waiting for input.')
  expect(log.messages[0]?.text).not.toContain('[Thread starter]')
})

test('each report is nudged about once, even when it shows up in later turns', async ($, on) => {
  const log = fakeWorld(on, { surface: SURFACE, inbox: [report('late', TURN_START_S + 30)] })
  await complete($, log, 't1')
  await complete($, log, 't2')
  expect(log.messages.length).toBe(1)
})

test('the report that started the turn needs no nudge', async ($, on) => {
  const quiet = fakeWorld(on, { surface: SURFACE, inbox: [report('starter', TURN_START_S + 1)] })
  await complete($, quiet, 't1')
  expect(quiet.messages).toEqual([])
})

test('outside cmux the inbox is not read', async ($, on) => {
  const log = fakeWorld(on, { inbox: [report('late', TURN_START_S + 30)] })
  await complete($, log, 't1')
  expect(log.inboxCalls).toEqual([])
  expect(log.messages).toEqual([])
})

test('a subagent ending its turn nudges nothing', async ($, on) => {
  const log = fakeWorld(on, { surface: SURFACE, inbox: [report('late', TURN_START_S + 30)] })
  await complete($, log, 't1', 'agent-1')
  expect(log.inboxCalls).toEqual([])
  expect(log.messages).toEqual([])
})

test('two turns ending at once nudge about a report once', async ($, on) => {
  const log = fakeWorld(on, { surface: SURFACE, inbox: [report('late', TURN_START_S + 30)] })
  await Promise.all([end($, 't1'), end($, 't2')])
  await settle(log)
  expect(log.messages.length).toBe(1)
})

test('a nudge cmux could not send is tried again at the next turn end', async ($, on) => {
  const log = fakeWorld(on, { surface: SURFACE, inbox: [report('late', TURN_START_S + 30)], sendFails: 1 })
  await complete($, log, 't1')
  await complete($, log, 't2')
  await complete($, log, 't3')
  expect(log.messages.length).toBe(2)
})
