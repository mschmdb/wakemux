import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Snapshot, ThreadRow } from '../types'
import type { Dollar } from './engine'
import { cmux, dirtyCount, git, isMainSession, loadConfig, mainCheckout, run, setPluginOptions } from './engine'
import { handOverPrompt, isPrRequiredRemote, parseAgentStatus, parseCounts, parseCwd, parseWorktrees, workspaceRefsByTitle } from './parse'
import { publishSessionId, sendReport } from './report'

const PANE = 'wakemux'
const TITLE = 'Threads'
const REFRESH_MS = 10_000

const EMPTY: Snapshot = { repo: '', base: '', prRequired: false, baseDirty: 0, threads: [], updatedAt: 0, error: '', warnings: [] }

// Change a tag when the stored shape changes: an older value is then read as the initial one.
const snapshot = atom({ plugin: 'wakemux', key: 'snapshot' } as const, EMPTY, { shape: 'snapshot-4' })
const confirm = atom({ plugin: 'wakemux', key: 'confirm' } as const, '', { shape: 'confirm-1' })
const message = atom({ plugin: 'wakemux', key: 'message' } as const, '', { shape: 'message-1' })

// Module variable: a reload drops it, and session.start starts the timer again.
let timer: { cancel: () => void } | undefined

async function findWorkspace($: Dollar, slug: string, path: string, refs: Map<string, string[]>) {
  for (const ref of refs.get(slug) ?? []) {
    const state = (await cmux($, 'sidebar-state', '--workspace', ref)).stdout
    if (parseCwd(state) === path) return { ref, agent: parseAgentStatus(state) }
  }
  return { ref: '', agent: '' }
}

async function collect($: Dollar): Promise<Snapshot> {
  const repo = await mainCheckout($)
  if (!repo) return { ...EMPTY, error: 'Not a git repository.' }
  const { config, warnings } = await loadConfig($, repo)
  const base = (await git($, repo, 'rev-parse', '--abbrev-ref', 'HEAD')).stdout.trim()
  const worktrees = parseWorktrees((await git($, repo, 'worktree', 'list', '--porcelain')).stdout, repo, config.worktreeDir, config.branchPrefix)
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
  const remote = (await git($, state.repo, 'remote')).stdout.trim()
  void $.prompt.submit({ text: handOverPrompt(thread, state.base, { prRequired: state.prRequired, hasRemote: remote !== '' }) })
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

async function openWorkspace($: Dollar, thread: ThreadRow) {
  if (!thread.workspaceRef) return say($, `${thread.slug}: no open workspace.`)
  await cmux($, 'select-workspace', '--workspace', thread.workspaceRef)
}

export const register: Register = (on, options) => {
  setPluginOptions(options)
  // Only the main loop reports; a subagent's end inside the thread is not the thread's answer.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (!e.agentId) {
      publishSessionId($).catch(() => undefined)
      sendReport($, e.reason, e.answer).catch(error => $.ui.log(`wakemux: report failed: ${String(error)}`, { to: 'debug' }))
    }
    return result
  })

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await publishSessionId($)
    // Another plugin may own the name; the rest of the start must still run.
    await $.command
      .register({ name: 'wakemux', description: 'Show or hide the wakemux threads pane' })
      .catch(error => $.ui.log(`wakemux: /wakemux not registered: ${String(error)}`, { to: 'debug' }))
    const state = await refresh($)
    const isMainCheckout = await isMainSession($)
    const wasOpen = (await $.ui.panes()).some(pane => pane.id === PANE)
    if (wasOpen) startTimer($)
    else if (isMainCheckout && state.threads.length > 0) void openPane($)
    return started
  })

  on('command.run', { command: 'wakemux' }, async $ => {
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
