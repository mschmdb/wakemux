import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Snapshot, ThreadRow } from '../types'
import type { Config, EnvName } from './config'
import { REPO_FILE, resolveConfig, userConfigPath } from './config'
import type { Report } from './parse'
import {
  handOverPrompt,
  isPrRequiredRemote,
  parseAgentStatus,
  parseCounts,
  parseCwd,
  parseParent,
  parseWorktrees,
  reportText,
  threadSlugOf,
  workspaceRefsByTitle,
} from './parse'

const PANE = 'threads'
const TITLE = 'Threads'
const REFRESH_MS = 10_000

const EMPTY: Snapshot = { repo: '', base: '', prRequired: false, baseDirty: 0, threads: [], updatedAt: 0, error: '', warnings: [] }

// Change a tag when the stored shape changes: an older value is then read as the initial one.
const snapshot = atom({ plugin: 'wakemux', key: 'snapshot' } as const, EMPTY, { shape: 'snapshot-4' })
const confirm = atom({ plugin: 'wakemux', key: 'confirm' } as const, '', { shape: 'confirm-1' })
const message = atom({ plugin: 'wakemux', key: 'message' } as const, '', { shape: 'message-1' })

type Dollar = EngineInterface

type Run = { exitCode: number; stdout: string; stderr: string }

// Module variable: a reload drops it, and session.start starts the timer again.
let timer: { cancel: () => void } | undefined
// The plugin's userConfig values; register receives them on every load.
let pluginOptions: Readonly<Record<string, unknown>> = {}

async function run($: Dollar, argv: string[], cwd?: string, env?: Record<string, string>, stdin?: string): Promise<Run> {
  try {
    return await $.process.run(argv, { cwd, env, stdin, timeoutMs: 20_000 })
  } catch (error) {
    return { exitCode: 127, stdout: '', stderr: String(error) }
  }
}

function git($: Dollar, cwd: string, ...args: string[]) {
  return run($, ['git', '-C', cwd, ...args])
}
function cmux($: Dollar, ...args: string[]) {
  return run($, ['cmux', ...args], undefined, { CMUX_QUIET: '1' })
}

async function mainCheckout($: Dollar): Promise<string> {
  const common = await git($, '.', 'rev-parse', '--path-format=absolute', '--git-common-dir')
  if (common.exitCode !== 0) return ''
  return common.stdout.trim().replace(/\/\.git\/?$/, '')
}

// Threads are run from the main checkout; a thread's own session must not merge itself.
async function isMainSession($: Dollar): Promise<boolean> {
  const repo = await mainCheckout($)
  const top = (await git($, '.', 'rev-parse', '--show-toplevel')).stdout.trim()
  return repo !== '' && top === repo
}

async function dirtyCount($: Dollar, cwd: string, untracked: boolean): Promise<number> {
  const status = await git($, cwd, 'status', '--porcelain', untracked ? '-unormal' : '-uno')
  return status.stdout.split('\n').filter(Boolean).length
}

async function findWorkspace($: Dollar, slug: string, path: string, refs: Map<string, string[]>) {
  for (const ref of refs.get(slug) ?? []) {
    const state = (await cmux($, 'sidebar-state', '--workspace', ref)).stdout
    if (parseCwd(state) === path) return { ref, agent: parseAgentStatus(state) }
  }
  return { ref: '', agent: '' }
}

async function readOptional($: Dollar, path: string): Promise<string | undefined> {
  if (!path || !(await $.fs.exists(path))) return undefined
  try {
    return await $.fs.read(path)
  } catch (error) {
    // An unreadable file must not look like an empty one: hand back text that fails to parse.
    return `unreadable: ${String(error)}`
  }
}

// $.env.get takes string literals only, so every variable is spelled out.
// Typed by EnvName, so a setting added to config.ts without a line here fails the type check.
async function readEnv($: Dollar): Promise<Record<EnvName, string | undefined>> {
  return {
    HOME: await $.env.get('HOME'),
    XDG_CONFIG_HOME: await $.env.get('XDG_CONFIG_HOME'),
    WAKEMUX_WORKTREE_DIR: await $.env.get('WAKEMUX_WORKTREE_DIR'),
    WAKEMUX_BRANCH_PREFIX: await $.env.get('WAKEMUX_BRANCH_PREFIX'),
    WAKEMUX_COPY_FILES: await $.env.get('WAKEMUX_COPY_FILES'),
    WAKEMUX_DEV_LAYOUT: await $.env.get('WAKEMUX_DEV_LAYOUT'),
    WAKEMUX_DEV_COMMAND: await $.env.get('WAKEMUX_DEV_COMMAND'),
    WAKEMUX_REPORT: await $.env.get('WAKEMUX_REPORT'),
    WAKEMUX_REPORT_MAX_BYTES: await $.env.get('WAKEMUX_REPORT_MAX_BYTES'),
    WAKEMUX_PR_REQUIRED_ORGS: await $.env.get('WAKEMUX_PR_REQUIRED_ORGS'),
    WAKEMUX_MERGE_POLICY: await $.env.get('WAKEMUX_MERGE_POLICY'),
    WAKEMUX_SCRIPT_PATH: await $.env.get('WAKEMUX_SCRIPT_PATH'),
    WAKEMUX_MAX_THREADS: await $.env.get('WAKEMUX_MAX_THREADS'),
    WAKEMUX_MAX_HOPS: await $.env.get('WAKEMUX_MAX_HOPS'),
    WAKEMUX_PR_STATUS: await $.env.get('WAKEMUX_PR_STATUS'),
    WAKEMUX_CROSS_REVIEW: await $.env.get('WAKEMUX_CROSS_REVIEW'),
  }
}

async function loadConfig($: Dollar, repo: string): Promise<{ config: Config; warnings: string[] }> {
  const env = await readEnv($)
  const { config, warnings } = resolveConfig({
    env,
    options: pluginOptions,
    repoFile: repo ? await readOptional($, `${repo}/${REPO_FILE}`) : undefined,
    userFile: await readOptional($, userConfigPath(env)),
  })
  for (const warning of warnings) $.ui.log(`wakemux: ${warning}`, { to: 'debug' })
  return { config, warnings }
}

async function collect($: Dollar): Promise<Snapshot> {
  const repo = await mainCheckout($)
  if (!repo) return { ...EMPTY, error: 'Not a git repository.' }
  const { config, warnings } = await loadConfig($, repo)
  const base = (await git($, repo, 'rev-parse', '--abbrev-ref', 'HEAD')).stdout.trim()
  const worktrees = parseWorktrees((await git($, repo, 'worktree', 'list', '--porcelain')).stdout, repo)
  const refs = workspaceRefsByTitle((await cmux($, 'tree', '--all', '--json')).stdout)

  const threads: ThreadRow[] = []
  for (const tree of worktrees) {
    const counts = tree.branch
      ? parseCounts((await git($, repo, 'rev-list', '--left-right', '--count', `${base}...${tree.branch}`)).stdout)
      : { behind: 0, ahead: 0 }
    const mergeTree = tree.branch ? await git($, repo, 'merge-tree', '--write-tree', '--name-only', base, tree.branch) : undefined
    const merge = mergeTree?.exitCode === 0 ? 'clean' : mergeTree?.exitCode === 1 ? 'conflict' : 'unknown'
    const workspace = await findWorkspace($, tree.slug, tree.path, refs)
    threads.push({
      ...tree,
      ...counts,
      dirty: await dirtyCount($, tree.path, true),
      merge,
      agent: workspace.agent,
      workspaceRef: workspace.ref,
    })
  }
  const baseDirty = await dirtyCount($, repo, false)
  const remote = (await git($, repo, 'remote', 'get-url', 'origin')).stdout.trim()
  const prRequired = isPrRequiredRemote(remote, config.prRequiredOrgs)
  return { repo, base, prRequired, baseDirty, threads, updatedAt: await $.clock.now(), error: '', warnings }
}

async function refresh($: Dollar) {
  const next = await collect($)
  await update($, snapshot, () => next)
  return next
}

function startTimer($: Dollar) {
  timer?.cancel()
  timer = $.clock.every(REFRESH_MS, () => void refresh($))
}

async function openPane($: Dollar) {
  const opened = await $.ui.open({ id: PANE, title: TITLE })
  if (opened.isPlaced) startTimer($)
  return opened
}

function say($: Dollar, text: string) {
  return update($, message, () => text)
}

// Destructive actions take two presses: the first arms `confirm` with the action's key.
async function isConfirmed($: Dollar, key: string, warning: string): Promise<boolean> {
  if ((await read($, confirm)) === key) {
    await update($, confirm, () => '')
    return true
  }
  await update($, confirm, () => key)
  await say($, warning)
  return false
}

async function cleanUp($: Dollar, slug: string) {
  const warning = `${slug}: press again to close the workspace and remove the worktree.`
  if (await isConfirmed($, `clean:${slug}`, warning)) await removeThread($, slug)
}

// Merging is the main session's job: it knows the repo's rules and can resolve conflicts.
async function handOver($: Dollar, thread: ThreadRow) {
  if (!(await isMainSession($))) return say($, 'Hand-over works only from the main checkout\'s session.')
  const state = await read($, snapshot)
  await say($, `${thread.slug}: handed over to Claude.`)
  void $.prompt.submit({ text: handOverPrompt(thread, state.base, state.prRequired) })
}

async function removeThread($: Dollar, slug: string) {
  const state = await refresh($)
  const thread = state.threads.find(one => one.slug === slug)
  if (!thread) return say($, `${slug}: no longer exists.`)
  if (thread.dirty > 0) return say($, `${slug}: ${thread.dirty} uncommitted changes, commit them first.`)
  if (thread.workspaceRef) {
    await cmux($, 'close-workspace', '--workspace', thread.workspaceRef, '--force')
    await $.clock.sleep(2000)
  }
  const { config } = await loadConfig($, state.repo)
  const script = config.scriptPath || $.plugin.root + '/bin/wakemux'
  const done = await run($, [script, 'done', slug, '--repo', state.repo])
  await say($, `${slug}: ${(done.stdout + done.stderr).trim().split('\n').pop() ?? ''}`)
  await refresh($)
}

// ---- Report back: a thread session tells the main session whenever its turn ends ----
// cmux delivers `agent message` through the receiver's hooks: an idle main session wakes up,
// a busy one reads it at its next step. Target: the spawning session, else the main checkout's.
// Opt out with the setting report (WAKEMUX_REPORT=0).

type ThreadContext = { slug: string; main: string }
let context: ThreadContext | null | undefined
let mainRef = ''

async function threadContext($: Dollar): Promise<ThreadContext | null> {
  if (context !== undefined) return context
  const main = await mainCheckout($)
  const top = (await git($, '.', 'rev-parse', '--show-toplevel')).stdout.trim()
  const slug = threadSlugOf(top, main)
  context = slug ? { slug, main } : null
  return context
}

// The main session is the workspace whose cwd is the main checkout. Titles like "main" repeat across projects.
async function findMainRef($: Dollar, main: string): Promise<string> {
  const refs = [...workspaceRefsByTitle((await cmux($, 'tree', '--all', '--json')).stdout).values()].flat()
  for (const ref of refs) {
    if (parseCwd((await cmux($, 'sidebar-state', '--workspace', ref)).stdout) === main) return ref
  }
  return ''
}

async function sendReport($: Dollar, reason: Report['reason'], answer: string) {
  const ctx = await threadContext($)
  if (!ctx) return
  const { config } = await loadConfig($, ctx.main)
  if (!config.report) return
  const base = (await git($, ctx.main, 'rev-parse', '--abbrev-ref', 'HEAD')).stdout.trim()
  const branch = (await git($, '.', 'rev-parse', '--abbrev-ref', 'HEAD')).stdout.trim()
  const ahead = Number((await git($, '.', 'rev-list', '--count', `${base}..HEAD`)).stdout.trim()) || 0
  const text = reportText({ slug: ctx.slug, branch, ahead, dirty: await dirtyCount($, '.', true), reason, answer }, config.reportMaxBytes)
  // First choice: the session that started the thread (may sit in another repo). Fallback: the main checkout's session.
  const gitDir = (await git($, '.', 'rev-parse', '--absolute-git-dir')).stdout.trim()
  const parent = gitDir ? parseParent((await run($, ['/bin/cat', gitDir + '/wakemux-parent'])).stdout) : ''
  if (parent) {
    const sent = await run($, ['cmux', 'agent', 'message', parent, '--from', ctx.slug, '-'], undefined, { CMUX_QUIET: '1' }, text)
    if (sent.exitCode === 0) return
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!mainRef) mainRef = await findMainRef($, ctx.main)
    if (!mainRef) break
    const sent = await run($, ['cmux', 'agent', 'message', mainRef, '--from', ctx.slug, '-'], undefined, { CMUX_QUIET: '1' }, text)
    if (sent.exitCode === 0) return
    mainRef = ''
  }
  $.ui.log(`wakemux: report from ${ctx.slug} not delivered (no main session found).`, { to: 'debug' })
}

async function openWorkspace($: Dollar, thread: ThreadRow) {
  if (!thread.workspaceRef) return say($, `${thread.slug}: no open workspace.`)
  await cmux($, 'select-workspace', '--workspace', thread.workspaceRef)
}

export const register: Register = (on, options) => {
  pluginOptions = options
  // Only the main loop reports; a subagent's end inside the thread is not the thread's answer.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (!e.agentId) void sendReport($, e.reason, e.answer)
    return result
  })

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({ name: 'threads', description: 'Show or hide the threads pane' })
    const state = await refresh($)
    const isMainCheckout = await isMainSession($)
    const wasOpen = (await $.ui.panes()).some(pane => pane.id === PANE)
    if (wasOpen) startTimer($)
    else if (isMainCheckout && state.threads.length > 0) void openPane($)
    return started
  })

  on('command.run', { command: 'threads' }, async $ => {
    if (!(await isMainSession($))) {
      return { text: 'The threads pane runs only in the main checkout\'s session (workspace "main").' }
    }
    // A pane opened unasked on a narrow terminal is listed but waits undrawn: open it then, don't close.
    const pane = (await $.ui.panes()).find(one => one.id === PANE)
    if (pane?.isPlaced && pane.isShown) {
      await $.ui.close({ id: PANE })
      return { text: 'Threads pane hidden.' }
    }
    await refresh($)
    await openPane($)
    return { text: 'Threads pane opened.' }
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) {
      timer?.cancel()
      timer = undefined
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const state = await read($, snapshot)
    const note = await read($, message)
    const pending = await read($, confirm)
    const time = state.updatedAt ? new Date(state.updatedAt).toTimeString().slice(0, 8) : '–'

    if (state.error) return <Text>{state.error}</Text>

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text>
            Base <Text bold>{state.base}</Text>
            {state.baseDirty > 0 ? ` · ${state.baseDirty} uncommitted` : ''}
          </Text>
          <Text dimColor>
            {state.threads.length} {state.threads.length === 1 ? 'thread' : 'threads'} · updated {time}
          </Text>
          <Button key="refresh" hotkey="r" onPress={() => void refresh($)}>
            Refresh
          </Button>
        </Box>
        {note !== '' && <Text color="yellow">{note}</Text>}
        {state.warnings.map(warning => (
          <Text key={warning} color="yellow">
            Settings: {warning}
          </Text>
        ))}
        {state.threads.length === 0 && <Text dimColor>No threads. Ask Claude to run a task as a thread.</Text>}
        {state.threads.map(thread => {
          const canHandOver = thread.dirty === 0 && thread.ahead > 0
          const mergeLabel =
            thread.ahead === 0 ? 'nothing to merge' : thread.merge === 'clean' ? 'mergeable' : thread.merge === 'conflict' ? 'conflicts' : 'merge unknown'
          return (
            <Box key={thread.slug} flexDirection="column">
              <Text>
                <Text bold>{thread.slug}</Text> · {thread.agent || (thread.workspaceRef ? 'no agent' : 'workspace closed')}
              </Text>
              <Text dimColor>
                {thread.branch || '(no branch)'} · +{thread.ahead} / −{thread.behind}
                {thread.dirty > 0 ? ` · ${thread.dirty} uncommitted` : ' · clean'} · {mergeLabel}
              </Text>
              <Box flexDirection="row" gap={1}>
                {thread.workspaceRef !== '' && (
                  <Button key={`open-${thread.slug}`} onPress={() => void openWorkspace($, thread)}>
                    Open
                  </Button>
                )}
                {canHandOver && (
                  <Button key={`both-${thread.slug}`} onPress={() => void handOver($, thread)}>
                    Hand over & clean up → Claude
                  </Button>
                )}
                {thread.dirty === 0 && (
                  <Button key={`clean-${thread.slug}`} onPress={() => void cleanUp($, thread.slug)}>
                    {pending === `clean:${thread.slug}` ? 'Really clean up?' : 'Clean up'}
                  </Button>
                )}
              </Box>
            </Box>
          )
        })}
      </Box>
    )
  })
}
