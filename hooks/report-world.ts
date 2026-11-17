// The fake cmux, git and session world the report tests run against, shared by the test files.

import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

// The test environment has timers; the plugin typings leave them out because hooks use $.clock.
declare const setTimeout: (callback: () => void, ms: number) => unknown

export const MAIN = '/r'
export const THREAD = '/r/.claude/worktrees/x'
export const GIT_DIR = '/r/.git/worktrees/x'
export const SESSION = '8c4667e8-d867-4c6b-b592-663cf1c845b2'

export type World = {
  parent?: string
  session?: string
  sendAnswer?: (target: string) => string
  inboxState?: string
  inboxStates?: string[]
  // Per message id, for reports that went to more than one session.
  inboxById?: Record<string, string>
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

export type Log = { cmux: string[][]; sessionSends: { to: unknown; text: string }[]; texts: string[]; calls: number; all: string[]; logs: string[] }

// Answers the process, env, fs, clock and session calls the report makes, from `world`.
export function fakeWorld(on: On, world: World): Log {
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
        if (world.inboxById) return ok(JSON.stringify({ messages: Object.entries(world.inboxById).map(([id, state]) => ({ id, state })) }))
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
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
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
export async function complete($: Engine, log: Log, answer: string) {
  await $.turn.complete({ answer, reason: 'answer', durationMs: 1, isAborted: false, turnId: `t-${answer}` })
  await settle(log)
}

export async function settle(log: Log) {
  let quiet = 0
  let seen = log.calls
  for (let round = 0; round < 5000 && quiet < 30; round++) {
    await new Promise<void>(resolve => setTimeout(resolve, 0))
    quiet = log.calls === seen ? quiet + 1 : 0
    seen = log.calls
  }
}

export const sent = (state: string, hasAgent = true, id = 'm1', surface = 'S1') =>
  JSON.stringify({ id, state, recipient_has_agent: hasAgent, recipient_surface_id: surface })

export const messages = (log: Log) => log.cmux.filter(call => call[0] === 'agent' && call[1] === 'message').map(call => call[2])
export const notifications = (log: Log) => log.cmux.filter(call => call[0] === 'notify')

