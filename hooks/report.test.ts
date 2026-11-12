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
  inboxStates?: string[]
  parentStatus?: string
  sessionDelivered?: boolean
  env?: Record<string, string>
  head?: string
  mainRef?: string
  mainId?: string
  now?: number
  sessionThrows?: boolean
  threadHead?: string
  ownBranch?: boolean
  // The folder the session started in ($.session.root), and the shell's folder, which cd moves.
  root?: string
  cwdTop?: string
  ownWorkspace?: string
  sessionId?: string
  // Whether the main checkout's workspace shows a Claude Code status; false for a plain terminal.
  mainHasAgent?: boolean
  // A `cmux agent message` that fails: its exit code and stderr.
  sendFails?: string
}

type Log = { cmux: string[][]; sessionSends: { to: unknown; text: string }[]; texts: string[]; calls: number; all: string[]; logs: string[] }

// Answers the process, env, fs, clock and session calls the report makes, from `world`.
function fakeWorld(on: On, world: World): Log {
  const log: Log = { cmux: [], sessionSends: [], texts: [], calls: 0, all: [], logs: [] }
  on('process.run', (_, e) => {
    log.calls++
    log.all.push(e.argv.join(" "))
    const argv = [...e.argv]
    const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
    if (argv[0] === 'git') {
      const args = argv.slice(3).join(' ')
      if (args === 'rev-parse --path-format=absolute --git-common-dir') return ok(`${MAIN}/.git\n`)
      if (args === 'rev-parse --show-toplevel') return ok(`${argv[2] === '.' ? (world.cwdTop ?? THREAD) : argv[2]}\n`)
      if (args === 'rev-parse --absolute-git-dir') return ok(`${GIT_DIR}\n`)
      if (args === 'rev-parse --abbrev-ref HEAD') return ok(argv[2] === MAIN ? 'main\n' : `${world.threadHead ?? 'thread/x'}\n`)
      if (args === 'rev-parse --verify --quiet refs/heads/thread/x') {
        return world.ownBranch === false
          ? { value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
          : ok('aaa\n')
      }
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
        if (world.sendFails) return { value: { exitCode: 1, stdout: '', stderr: world.sendFails, isStdoutTruncated: false, isStderrTruncated: false } }
        return ok(world.sendAnswer ? world.sendAnswer(argv[3] ?? '') : '')
      }
      if (argv[1] === 'agent' && argv[2] === 'messages' && argv[3] === 'status') {
        return ok(JSON.stringify({ id: 'PARENT-SURFACE', scope: 'surface', receiving: true }))
      }
      if (argv[1] === 'agent' && argv[2] === 'inbox') {
        const state = world.inboxStates?.shift() ?? world.inboxState ?? 'queued'
        return ok(JSON.stringify({ messages: [{ id: 'm1', state }] }))
      }
      if (argv[1] === 'tree') return ok(world.mainRef ? JSON.stringify({ ref: world.mainRef, id: world.mainId ?? 'MAIN-ID', title: 'main' }) : '{}')
      if (argv[1] === 'sidebar-state') {
        // The parent's agent status for the delivery check; the main checkout's cwd for findMainRef.
        if (argv[3] === 'workspace:3') return ok(`cwd=/elsewhere\n  claude_code=${world.parentStatus ?? 'Idle'} icon=x\n`)
        return ok(world.mainHasAgent === false ? `cwd=${MAIN}\n` : `cwd=${MAIN}\n  claude_code=Idle icon=x\n`)
      }
      return ok('')
    }
    return { value: { exitCode: 127, stdout: '', stderr: 'unexpected', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('env.get', (_, e) => {
    if (e.name === 'CMUX_WORKSPACE_ID') return { value: world.ownWorkspace }
    return { value: world.env?.[e.name] }
  })
  on('fs.exists', () => ({ value: false }))
  on('clock.sleep', () => ({ value: undefined }))
  on('clock.now', () => ({ value: world.now ?? 1_000_000 }))
  on('session.id', () => ({ value: world.sessionId ?? 'thread-session' }))
  on('session.root', () => ({ value: world.root ?? THREAD }))
  on('env.set', () => ({ value: {} }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.log', (_, e) => {
    log.logs.push(e.text)
    return { value: undefined }
  })
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
  // cmux ignores --workspace when the caller has a workspace of its own; a surface id resolves globally.
  const [call] = notifications(log)
  expect(call?.slice(call.indexOf('--surface'), call.indexOf('--surface') + 2)).toEqual(['--surface', 'S1'])
  expect(call).not.toContain('--workspace')
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

test('a parent message that cmux took without an agent is checked before the fallback', async ($, on) => {
  // cmux can report no agent for a live session and still deliver the message a second later.
  const log = fakeWorld(on, {
    parent: 'workspace:3',
    session: SESSION,
    sendAnswer: () => sent('queued', false),
    inboxState: 'delivered',
    sessionDelivered: true,
  })
  await complete($, log, 'Done.')
  expect(messages(log)).toEqual(['workspace:3'])
  expect(log.sessionSends).toEqual([])
  expect(notifications(log)).toEqual([])
})

test('a parent message without an agent that stays queued still gets the fallback', async ($, on) => {
  const log = fakeWorld(on, {
    parent: 'workspace:3',
    session: SESSION,
    sendAnswer: () => sent('queued', false),
    inboxState: 'queued',
    sessionDelivered: true,
  })
  await complete($, log, 'Done.')
  expect(log.sessionSends.length).toBe(1)
})

test('WAKEMUX_REPORT=0 sends nothing', async ($, on) => {
  const log = fakeWorld(on, { parent: 'workspace:3', sendAnswer: () => sent('delivered'), env: { WAKEMUX_REPORT: '0' } })
  await complete($, log, 'Done.')
  expect(log.cmux.filter(call => call[0] !== 'set-status')).toEqual([])
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
  // No message went out for this report, so the parent's surface comes from cmux agent messages status.
  expect(notifications(log)[0]?.join(' ')).toContain('--surface PARENT-SURFACE')
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


test('an answer that starts with [quiet] sends no report but still sets the pill', async ($, on) => {
  const log = fakeWorld(on, { parent: 'workspace:3', sendAnswer: () => sent('delivered') })
  await complete($, log, '  [quiet] 18:00: nothing new.')
  expect(messages(log)).toEqual([])
  expect(notifications(log)).toEqual([])
  expect(log.cmux.filter(call => call[0] === 'set-status').length).toBe(1)
})

test('quiet turns on one commit never reach the hop limit, and news after them goes out', async ($, on) => {
  const log = fakeWorld(on, { parent: 'workspace:3', sendAnswer: () => sent('delivered'), env: { WAKEMUX_MAX_HOPS: '2' } })
  for (let tick = 0; tick < 5; tick++) await complete($, log, `[quiet] tick ${tick}`)
  await complete($, log, 'PR #12 needs your approval.')
  expect(messages(log).length).toBe(1)
  expect(log.texts[0]).not.toContain('[wakemux]')
})

test('a quiet turn starts the hop count again', async ($, on) => {
  const log = fakeWorld(on, { parent: 'workspace:3', sendAnswer: () => sent('delivered'), env: { WAKEMUX_MAX_HOPS: '2' } })
  await complete($, log, 'News 1')
  await complete($, log, '[quiet] nothing new')
  await complete($, log, 'News 2')
  expect(messages(log).length).toBe(2)
  expect(log.texts[1]).not.toContain('reports in a row')
})

test('a quiet turn does not lift a pause or an escalation', async ($, on) => {
  const log = fakeWorld(on, { parent: 'workspace:3', sendAnswer: () => sent('delivered'), env: { WAKEMUX_MAX_HOPS: '1' } })
  await complete($, log, 'One')
  await complete($, log, 'Two')
  await complete($, log, '[quiet] tick')
  await complete($, log, 'Three')
  expect(messages(log).length).toBe(1)
  expect(notifications(log).length).toBe(1)
  expect(pills(log).at(-2)?.[2]).toBe('reports paused after 2 without a commit')
})

test('[quiet] counts only at the start of the answer', async ($, on) => {
  const log = fakeWorld(on, { parent: 'workspace:3', sendAnswer: () => sent('delivered') })
  await complete($, log, 'Found something. Next tick stays [quiet] unless it changes.')
  expect(messages(log).length).toBe(1)
})

test('a turn that ends in an error reports even when it starts with [quiet]', async ($, on) => {
  const log = fakeWorld(on, { parent: 'workspace:3', sendAnswer: () => sent('delivered') })
  await $.turn.complete({ answer: '[quiet] tick', reason: 'error', durationMs: 1, isAborted: false, turnId: 't-error' })
  await settle(log)
  expect(messages(log).length).toBe(1)
})

const pills = (log: Log) => log.cmux.filter(call => call[0] === 'set-status')

test('each turn end sets the thread pill in the sidebar', async ($, on) => {
  const log = fakeWorld(on, { parent: 'workspace:3', sendAnswer: () => sent('delivered') })
  await complete($, log, 'Done.')
  expect(pills(log)).toEqual([['set-status', 'wakemux', '+1 · clean', '--color', '#34C759', '--priority', '10']])
})

test('the pill updates also when reports are off', async ($, on) => {
  const log = fakeWorld(on, { parent: 'workspace:3', env: { WAKEMUX_REPORT: '0' } })
  await complete($, log, 'Done.')
  expect(pills(log).length).toBe(1)
  expect(messages(log)).toEqual([])
})

test('the pill shows when reports pause', async ($, on) => {
  const log = fakeWorld(on, { parent: 'workspace:3', sendAnswer: () => sent('delivered'), env: { WAKEMUX_MAX_HOPS: '1' } })
  await complete($, log, 'One')
  await complete($, log, 'Two')
  expect(pills(log).at(-1)?.[2]).toBe('reports paused after 2 without a commit')
})

test('a busy parent gets more time instead of the fallback', async ($, on) => {
  const log = fakeWorld(on, {
    parent: 'workspace:3',
    session: SESSION,
    sendAnswer: () => sent('queued'),
    inboxStates: ['queued', 'queued', 'delivered'],
    parentStatus: 'Running',
    sessionDelivered: true,
  })
  await complete($, log, 'Done.')
  expect(log.sessionSends).toEqual([])
  expect(notifications(log)).toEqual([])
})

test('an idle parent with a queued message gets the fallback at once', async ($, on) => {
  const log = fakeWorld(on, {
    parent: 'workspace:3',
    session: SESSION,
    sendAnswer: () => sent('queued'),
    inboxStates: ['queued', 'delivered'],
    parentStatus: 'Idle',
    sessionDelivered: true,
  })
  await complete($, log, 'Done.')
  expect(log.sessionSends.length).toBe(1)
})

test('a thread that switched to another branch still reports and names both branches', async ($, on) => {
  const log = fakeWorld(on, { parent: 'workspace:3', sendAnswer: () => sent('delivered'), threadHead: 'w-1141' })
  await complete($, log, 'Pushed the fixes.')
  expect(messages(log)).toEqual(['workspace:3'])
  expect(log.texts[0]).toContain('Branch w-1141, not its own thread/x')
  expect(pills(log).length).toBe(1)
})

test('a worktree from claude --worktree in the same folder neither reports nor gets a pill', async ($, on) => {
  const log = fakeWorld(on, { parent: 'workspace:3', sendAnswer: () => sent('delivered'), threadHead: 'worktree-x', ownBranch: false })
  await complete($, log, 'Done.')
  expect(log.cmux).toEqual([])
})

test('a session that is not a thread at first is checked again on the next turn', async ($, on) => {
  const world: World = { parent: 'workspace:3', sendAnswer: () => sent('delivered'), threadHead: 'worktree-x', ownBranch: false }
  const log = fakeWorld(on, world)
  await complete($, log, 'First.')
  expect(messages(log)).toEqual([])
  world.threadHead = 'thread/x'
  world.ownBranch = true
  await complete($, log, 'Second.')
  expect(messages(log)).toEqual(['workspace:3'])
})

test('a main session that cds into a thread worktree sends no report', async ($, on) => {
  const log = fakeWorld(on, { root: MAIN, cwdTop: THREAD, parent: 'workspace:3', sendAnswer: () => sent('delivered') })
  await complete($, log, 'Reviewed the thread.')
  expect(log.cmux).toEqual([])
})

test('a session that started in the worktree but is the thread\'s parent workspace sends nothing', async ($, on) => {
  const log = fakeWorld(on, { parent: 'workspace:3', ownWorkspace: 'workspace:3', sendAnswer: () => sent('delivered') })
  await complete($, log, 'Echo.')
  expect(log.cmux).toEqual([])
})

test('a session that is the thread\'s parent session sends nothing', async ($, on) => {
  const log = fakeWorld(on, { parent: 'workspace:3', session: SESSION, sessionId: SESSION, sendAnswer: () => sent('delivered') })
  await complete($, log, 'Echo.')
  expect(log.cmux).toEqual([])
  expect(log.sessionSends).toEqual([])
})

test('a session that moves its root out of the worktree stops reporting', async ($, on) => {
  const world: World = { parent: 'workspace:3', sendAnswer: () => sent('delivered') }
  const log = fakeWorld(on, world)
  await complete($, log, 'In the worktree.')
  expect(messages(log)).toEqual(['workspace:3'])
  world.root = MAIN
  await complete($, log, 'Moved with /cd.')
  expect(messages(log)).toEqual(['workspace:3'])
})

test('a thread reads its state from its worktree, wherever its shell moved', async ($, on) => {
  const log = fakeWorld(on, { parent: 'workspace:3', cwdTop: '/tmp', sendAnswer: () => sent('delivered') })
  await complete($, log, 'Done.')
  expect(messages(log)).toEqual(['workspace:3'])
  expect(log.all).toContain(`git -C ${THREAD} rev-parse HEAD`)
  expect(log.all.some(call => call.startsWith('git -C . '))).toBe(false)
})

test('the main-checkout fallback skips the thread\'s own workspace', async ($, on) => {
  const log = fakeWorld(on, {
    parent: 'workspace:3',
    ownWorkspace: 'own-id',
    mainRef: 'workspace:5',
    mainId: 'OWN-ID',
    sendAnswer: target => (target === 'workspace:3' ? sent('queued', false) : sent('delivered')),
  })
  await complete($, log, 'Done.')
  expect(messages(log)).toEqual(['workspace:3'])
})

test('a parent stored as a workspace ref still counts as the sender\'s own workspace', async ($, on) => {
  const log = fakeWorld(on, { parent: 'workspace:5', ownWorkspace: 'own-id', mainRef: 'workspace:5', mainId: 'OWN-ID', sendAnswer: () => sent('delivered') })
  await complete($, log, 'Echo.')
  expect(messages(log)).toEqual([])
})
