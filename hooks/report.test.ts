import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

// The test environment has timers; the plugin typings leave them out because hooks use $.clock.
declare const setTimeout: (callback: () => void, ms: number) => unknown

const MAIN = '/r'
const THREAD = '/r/.claude/worktrees/x'
const GIT_DIR = '/r/.git/worktrees/x'
const SESSION = '8c4667e8-d867-4c6b-b592-663cf1c845b2'

type World = {
  parent?: string
  session?: string
  sendAnswer?: (target: string) => string
  inboxState?: string
  sessionDelivered?: boolean
  env?: Record<string, string>
  head?: string
  mainRef?: string
  now?: number
  sessionThrows?: boolean
}

type Log = { cmux: string[][]; sessionSends: { to: unknown; text: string }[]; texts: string[]; calls: number; all: string[] }

// Answers the process, env, fs, clock and session calls the report makes, from `world`.
function fakeWorld(on: On, world: World): Log {
  const log: Log = { cmux: [], sessionSends: [], texts: [], calls: 0, all: [] }
  on('process.run', (_, e) => {
    log.calls++
    log.all.push(e.argv.join(" "))
    const argv = [...e.argv]
    const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (argv[0] === 'git') {
      const args = argv.slice(3).join(' ')
      if (args === 'rev-parse --path-format=absolute --git-common-dir') return ok(`${MAIN}/.git\n`)
      if (args === 'rev-parse --show-toplevel') return ok(`${THREAD}\n`)
      if (args === 'rev-parse --absolute-git-dir') return ok(`${GIT_DIR}\n`)
      if (args === 'rev-parse --abbrev-ref HEAD') return ok(argv[2] === MAIN ? 'main\n' : 'thread/x\n')
      if (args === 'rev-parse HEAD') return ok(`${world.head ?? 'aaa'}\n`)
      if (args.startsWith('rev-list --count')) return ok('1\n')
      if (args.startsWith('status')) return ok('')
      return ok('')
    }
    if (argv[0] === '/bin/cat') {
      if (argv[1] === `${GIT_DIR}/wakemux-parent`) return ok(world.parent ?? '')
      if (argv[1] === `${GIT_DIR}/wakemux-parent-session`) return ok(world.session ?? '')
      return { value: { exitCode: 1, stdout: '', stderr: 'missing', isStdoutTruncated: false, isStderrTruncated: false } }
    }
    if (argv[0] === 'cmux') {
      log.cmux.push(argv.slice(1))
      if (argv[1] === 'agent' && argv[2] === 'message') {
        log.texts.push(e.init?.stdin ?? '')
        return ok(world.sendAnswer ? world.sendAnswer(argv[3] ?? '') : '')
      }
      if (argv[1] === 'agent' && argv[2] === 'inbox') {
        return ok(JSON.stringify({ messages: [{ id: 'm1', state: world.inboxState ?? 'queued' }] }))
      }
      if (argv[1] === 'tree') return ok(world.mainRef ? JSON.stringify({ ref: world.mainRef, title: 'main' }) : '{}')
      if (argv[1] === 'sidebar-state') return ok(`cwd=${MAIN}\n`)
      return ok('')
    }
    return { value: { exitCode: 127, stdout: '', stderr: 'unexpected', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('env.get', (_, e) => ({ value: world.env?.[e.name] }))
  on('fs.exists', () => ({ value: false }))
  on('clock.sleep', () => ({ value: undefined }))
  on('clock.now', () => ({ value: world.now ?? 1_000_000 }))
  on('session.id', () => ({ value: 'thread-session' }))
  on('env.set', () => ({ value: {} }))
  on('turn.complete', () => ({ text: '' }))
  on('session.send', (_, e) => {
    log.sessionSends.push({ to: e.to, text: e.text })
    if (world.sessionThrows) throw new Error('session gone')
    return world.sessionDelivered ? { isDelivered: true } : { isDelivered: false, reason: 'not running' }
  })
  return log
}

// The mod sends the report after the turn ends, without holding up the turn, so the test waits
// for the calls it makes to settle.
// It waits until no new process call came for 30 rounds.
async function complete($: Engine, log: Log, answer: string) {
  await $.turn.complete({ answer, reason: 'answer', durationMs: 1, isAborted: false, turnId: `t-${answer}` })
  await settle(log)
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

const sent = (state: string, hasAgent = true) =>
  JSON.stringify({ id: 'm1', state, recipient_has_agent: hasAgent, recipient_surface_id: 'S1' })

const messages = (log: Log) => log.cmux.filter(call => call[0] === 'agent' && call[1] === 'message').map(call => call[2])
const notifications = (log: Log) => log.cmux.filter(call => call[0] === 'notify')

test('a report goes to the parent workspace and stops there once delivered', async ($, on) => {
  const log = fakeWorld(on, { parent: 'workspace:3', sendAnswer: () => sent('delivered') })
  await complete($, log, 'Done. Which colour?')
  expect(messages(log)).toEqual(['workspace:3'])
  expect(log.texts[0]).toContain('[Thread x] waiting for input.')
  expect(log.sessionSends).toEqual([])
  expect(notifications(log)).toEqual([])
})

test('a queued message that cmux delivers within the wait needs no fallback', async ($, on) => {
  const log = fakeWorld(on, { parent: 'workspace:3', session: SESSION, sendAnswer: () => sent('queued'), inboxState: 'delivered' })
  await complete($, log, 'Done.')
  expect(log.sessionSends).toEqual([])
  expect(notifications(log)).toEqual([])
})

test('a message still queued after the wait goes through Claude Code to the parent session', async ($, on) => {
  const log = fakeWorld(on, {
    parent: 'workspace:3',
    session: SESSION,
    sendAnswer: () => sent('queued'),
    inboxState: 'queued',
    sessionDelivered: true,
  })
  await complete($, log, 'Done.')
  expect(log.sessionSends.length).toBe(1)
  expect(log.sessionSends[0]?.text).toContain('[Thread x]')
  expect(log.sessionSends[0]?.text).toContain('answer once')
  expect(notifications(log)).toEqual([])
})

test('when Claude Code cannot deliver either, the user gets a desktop notification', async ($, on) => {
  const log = fakeWorld(on, { parent: 'workspace:3', session: SESSION, sendAnswer: () => sent('queued'), inboxState: 'queued' })
  await complete($, log, 'Done. Which colour?')
  expect(log.sessionSends.length).toBe(1)
  const [call] = notifications(log)
  expect(call).toContain('workspace:3')
  expect(call).toContain('Done. Which colour?')
})

test('without a stored session the fallback is the notification', async ($, on) => {
  const log = fakeWorld(on, { parent: 'workspace:3', sendAnswer: () => sent('queued'), inboxState: 'queued' })
  await complete($, log, 'Done.')
  expect(log.sessionSends).toEqual([])
  expect(notifications(log).length).toBe(1)
})

test('a parent without an agent is skipped for the main checkout session', async ($, on) => {
  const log = fakeWorld(on, {
    parent: 'workspace:3',
    sendAnswer: target => (target === 'workspace:3' ? sent('queued', false) : sent('delivered')),
    mainRef: 'workspace:1',
  })
  await complete($, log, 'Done.')
  expect(messages(log)).toEqual(['workspace:3', 'workspace:1'])
  expect(notifications(log)).toEqual([])
})

test('WAKEMUX_REPORT=0 sends nothing', async ($, on) => {
  const log = fakeWorld(on, { parent: 'workspace:3', sendAnswer: () => sent('delivered'), env: { WAKEMUX_REPORT: '0' } })
  await complete($, log, 'Done.')
  expect(log.cmux).toEqual([])
})

test('the same report twice within a minute is sent once', async ($, on) => {
  const log = fakeWorld(on, { parent: 'workspace:3', sendAnswer: () => sent('delivered') })
  await complete($, log, 'Done.')
  await complete($, log, 'Done.')
  expect(messages(log).length).toBe(1)
})

test('reports on one commit escalate at maxHops and pause after one notification', async ($, on) => {
  const log = fakeWorld(on, { parent: 'workspace:3', sendAnswer: () => sent('delivered'), env: { WAKEMUX_MAX_HOPS: '2' } })
  await complete($, log, 'Question 1')
  await complete($, log, 'Question 2')
  await complete($, log, 'Question 3')
  await complete($, log, 'Question 4')
  expect(messages(log).length).toBe(2)
  expect(log.texts[0]).not.toContain('[wakemux]')
  expect(log.texts[1]).toContain('2 reports in a row without a new commit')
  expect(notifications(log).length).toBe(1)
  expect(notifications(log)[0]?.join(' ')).toContain('Reports pause until the thread commits')
})

test('a new commit starts the hop count again', async ($, on) => {
  const world: World = { parent: 'workspace:3', sendAnswer: () => sent('delivered'), env: { WAKEMUX_MAX_HOPS: '1' } }
  const log = fakeWorld(on, world)
  await complete($, log, 'First')
  world.head = 'bbb'
  await complete($, log, 'Second')
  expect(messages(log).length).toBe(2)
  expect(log.texts[1]).toContain('1 reports in a row')
})

test('a failing Claude Code send still ends in a desktop notification', async ($, on) => {
  const log = fakeWorld(on, { parent: 'workspace:3', session: SESSION, sendAnswer: () => sent('queued'), inboxState: 'queued', sessionThrows: true })
  await complete($, log, 'Done.')
  expect(log.sessionSends.length).toBe(1)
  expect(notifications(log).length).toBe(1)
})

test('two turns that end at once still count two hops', async ($, on) => {
  const log = fakeWorld(on, { parent: 'workspace:3', sendAnswer: () => sent('delivered'), env: { WAKEMUX_MAX_HOPS: '2' } })
  await Promise.all([
    $.turn.complete({ answer: 'One', reason: 'answer', durationMs: 1, isAborted: false, turnId: 't1' }),
    $.turn.complete({ answer: 'Two', reason: 'answer', durationMs: 1, isAborted: false, turnId: 't2' }),
  ])
  await settle(log)
  expect(log.texts.filter(text => text.includes('2 reports in a row')).length).toBe(1)
})

test('the same answer on a new commit is not a duplicate', async ($, on) => {
  const world: World = { parent: 'workspace:3', sendAnswer: () => sent('delivered') }
  const log = fakeWorld(on, world)
  await complete($, log, 'Done.')
  world.head = 'amended'
  await complete($, log, 'Done.')
  expect(messages(log).length).toBe(2)
})
