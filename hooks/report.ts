// Report back: a thread session tells the main session whenever its main loop ends a turn.
//
// 1. `cmux agent message` to the session that started the thread, else to the main checkout's.
//    cmux delivers through the receiver's hooks: an idle session wakes up, a busy one reads it
//    at its next step. cmux can say a live session has no agent and deliver anyway, so a message
//    it took counts as sent either way.
// 2. If the message is still queued after DELIVERY_CHECK_MS while the receiver is idle, its cmux
//    poller is likely gone. A busy receiver gets up to ten minutes before that counts. The mod
//    then sends the report through Claude Code (`$.session.send`, what the SendMessage tool does)
//    to the parent session id that `wakemux new` stored. Claude Code asks for approval unless a
//    `SendMessage` allow rule covers it.
// 3. If that fails too, a desktop notification tells the user.
//
// Reports on the same commit count as hops; maxHops stops ping-pong between main and thread.
// Every turn end also updates the thread's pill in the cmux sidebar.

import { atom, read, update } from 'claude-code'

import type { Dollar } from './engine'
import { cmux, dirtyCount, git, loadConfig, mainCheckout, run } from './engine'
import type { HopAction, Sent } from './delivery'
import {
  escalationNote,
  forwardText,
  isQuietAnswer,
  hopAction,
  isDuplicate,
  keepWaiting,
  messageState,
  nextHops,
  notifyBody,
  parseAgentSurface,
  parseSent,
  parseSessionId,
  reportKey,
} from './delivery'
import type { Report } from './parse'
import type { Pill } from './status'
import { threadPill } from './status'
import { isThreadBranch, parseAgentStatus, parseCwd, parseParent, reportText, threadSlugOf, workspaceRefOfId, workspaceRefsByTitle } from './parse'

const DELIVERY_CHECK_MS = 15_000

const hops = atom({ plugin: 'wakemux', key: 'hops' } as const, { head: '', count: 0 }, { shape: 'hops-1' })
const lastReport = atom({ plugin: 'wakemux', key: 'lastReport' } as const, { key: '', at: 0 }, { shape: 'last-report-1' })

type ThreadContext = { slug: string; main: string; top: string; gitDir: string; threadBranch: string }
let mainRef = ''

// A session is a thread when the folder it started in is a worktree under worktreeDir that is on
// a thread branch or whose own thread branch exists. The start folder ($.session.root) stays put
// when the shell cds elsewhere, so a main session that works inside a thread's worktree is not that
// thread; `claude --worktree` worktrees in the same folder have no thread branch. Decided on every
// turn, never cached: the answer must not outlive what it was computed from (#7, #10).
// A session never reports to itself, whatever the folders say.
async function threadContext($: Dollar): Promise<ThreadContext | null> {
  const root = await $.session.root()
  const top = (await git($, root, 'rev-parse', '--show-toplevel')).stdout.trim()
  if (!top) return null
  const main = await mainCheckout($, top)
  const { config } = await loadConfig($, main)
  const slug = threadSlugOf(top, main, config.worktreeDir)
  if (!slug) return null
  const threadBranch = config.branchPrefix + slug
  const branch = (await git($, top, 'rev-parse', '--abbrev-ref', 'HEAD')).stdout.trim()
  const isThread =
    isThreadBranch(branch, config.branchPrefix) ||
    (await git($, top, 'rev-parse', '--verify', '--quiet', `refs/heads/${threadBranch}`)).exitCode === 0
  if (!isThread) return null
  const gitDir = (await git($, top, 'rev-parse', '--absolute-git-dir')).stdout.trim()
  if (await isOwnParent($, gitDir)) return null
  return { slug, main, top, gitDir, threadBranch }
}

async function isOwnParent($: Dollar, gitDir: string): Promise<boolean> {
  const workspace = (await $.env.get('CMUX_WORKSPACE_ID')) ?? ''
  const parent = parseParent(await readNote($, `${gitDir}/wakemux-parent`))
  if (workspace && parent.toUpperCase() === workspace.toUpperCase()) return true
  // wakemux new stores the id; a parent written as a ref is compared through the workspace tree.
  if (workspace && parent.startsWith('workspace:')) {
    if (workspaceRefOfId((await cmux($, 'tree', '--all', '--json')).stdout, workspace) === parent) return true
  }
  const session = await $.session.id()
  const parentSession = parseSessionId(await readNote($, `${gitDir}/wakemux-parent-session`))
  return session !== '' && parentSession === session
}

// Every session publishes its id to the commands it runs, so `wakemux new` can store it.
export async function publishSessionId($: Dollar) {
  const id = await $.session.id()
  if (id && (await $.env.get('WAKEMUX_PARENT_SESSION')) !== id) await $.env.set('WAKEMUX_PARENT_SESSION', id)
}

// The main session is the workspace whose cwd is the main checkout and that runs Claude Code.
// Titles like "main" repeat across projects. The thread's own workspace is skipped: its shell may
// sit in the main checkout too. So is a plain terminal there, such as the project's group header,
// where a report would wait forever.
async function findMainRef($: Dollar, main: string): Promise<string> {
  const tree = (await cmux($, 'tree', '--all', '--json')).stdout
  const own = workspaceRefOfId(tree, (await $.env.get('CMUX_WORKSPACE_ID')) ?? '')
  const refs = [...workspaceRefsByTitle(tree).values()].flat().filter(ref => ref !== own)
  for (const ref of refs) {
    const state = (await cmux($, 'sidebar-state', '--workspace', ref)).stdout
    if (parseCwd(state) === main && parseAgentStatus(state) !== '') return ref
  }
  return ''
}

async function readNote($: Dollar, path: string): Promise<string> {
  return (await run($, ['/bin/cat', path])).stdout
}

// A failed send goes to the debug log, so a report that never reached cmux can be traced.
async function sendMessage($: Dollar, target: string, from: string, text: string): Promise<Sent | null> {
  const result = await run($, ['cmux', 'agent', 'message', target, '--from', from, '--json', '-'], undefined, { CMUX_QUIET: '1' }, text)
  const sent = parseSent(result.stdout)
  if (!sent) $.ui.log(`wakemux: cmux agent message to ${target} failed (exit ${result.exitCode}): ${result.stderr.trim()}`, { to: 'debug' })
  return sent
}

// The first target with an agent wins; the spawning session first, then the main checkout's.
// Without one, the parent's message stands: cmux took it and may still deliver it.
async function sendThroughCmux($: Dollar, ctx: ThreadContext, parent: string, text: string): Promise<{ sent: Sent | null; target: string }> {
  const parentSent = parent ? await sendMessage($, parent, ctx.slug, text) : null
  if (parentSent?.hasAgent) return { sent: parentSent, target: parent }
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!mainRef) mainRef = await findMainRef($, ctx.main)
    if (!mainRef || mainRef === parent) break
    const sent = await sendMessage($, mainRef, ctx.slug, text)
    if (sent?.hasAgent) return { sent, target: mainRef }
    mainRef = ''
  }
  return { sent: parentSent, target: parent || mainRef }
}

async function isPickedUp($: Dollar, sent: Sent, target: string): Promise<boolean> {
  if (sent.state === 'delivered' || sent.state === 'read') return true
  for (let waited = DELIVERY_CHECK_MS; ; waited += DELIVERY_CHECK_MS) {
    await $.clock.sleep(DELIVERY_CHECK_MS)
    const inbox = await cmux($, 'agent', 'inbox', '--surface', sent.surfaceId, '--json', '--limit', '50')
    const state = messageState(inbox.stdout, sent.id)
    if (state === 'delivered' || state === 'read') return true
    const status = parseAgentStatus((await cmux($, 'sidebar-state', '--workspace', target)).stdout)
    if (state !== 'queued' || !keepWaiting(status, waited)) return false
  }
}

async function agentSurface($: Dollar, workspace: string): Promise<string> {
  if (!workspace) return ''
  return parseAgentSurface((await cmux($, 'agent', 'messages', 'status', workspace, '--json')).stdout)
}

// cmux ignores --workspace when the caller sits in a workspace of its own, as a thread does, and
// posts to the caller. A surface id resolves globally, so the notification targets the parent's surface.
async function notify($: Dollar, surface: string, slug: string, body: string) {
  const argv = ['cmux', 'notify', '--title', `wakemux: thread ${slug}`, '--body', body]
  // Without a known parent surface it posts to the thread's own workspace. The desktop banner,
  // titled with the thread, still reaches the user, which is the point of this last channel.
  if (surface) argv.push('--surface', surface)
  await run($, argv, undefined, { CMUX_QUIET: '1' })
}

async function deliver($: Dollar, ctx: ThreadContext, text: string) {
  const parent = parseParent(await readNote($, `${ctx.gitDir}/wakemux-parent`))
  const { sent, target } = await sendThroughCmux($, ctx, parent, text)
  if (sent && (await isPickedUp($, sent, target))) return

  const sessionId = parseSessionId(await readNote($, `${ctx.gitDir}/wakemux-parent-session`))
  if (sessionId) {
    try {
      const forwarded = await $.session.send({ to: { sessionId }, text: forwardText(text) })
      if (forwarded.isDelivered) return
      $.ui.log(`wakemux: forwarding the report from ${ctx.slug} failed: ${forwarded.reason}`, { to: 'debug' })
    } catch (error) {
      $.ui.log(`wakemux: forwarding the report from ${ctx.slug} failed: ${String(error)}`, { to: 'debug' })
    }
  }
  await notify($, sent?.surfaceId || (await agentSurface($, target)), ctx.slug, notifyBody(text))
  $.ui.log(`wakemux: report from ${ctx.slug} not delivered; sent a desktop notification.`, { to: 'debug' })
}

// Targets the thread's own workspace: cmux reads CMUX_WORKSPACE_ID from the environment.
async function setPill($: Dollar, pill: Pill) {
  await run($, ['cmux', 'set-status', 'wakemux', pill.value, '--color', pill.color, '--priority', '10'], undefined, { CMUX_QUIET: '1' })
}

type Decision = { action: HopAction; count: number }

// Reports can end at the same time; the dedup and hop decisions run one after another so no
// count is lost. Delivery, which may wait, runs outside this queue.
let decisions: Promise<unknown> = Promise.resolve()

function decide($: Dollar, report: Report, head: string, maxHops: number): Promise<Decision | null> {
  const next = decisions.then(async () => {
    const now = await $.clock.now()
    const key = reportKey(report, head)
    if (isDuplicate(await read($, lastReport), key, now)) return null
    await update($, lastReport, () => ({ key, at: now }))
    const counted = nextHops(await read($, hops), head)
    await update($, hops, () => counted)
    return { action: hopAction(counted.count, maxHops), count: counted.count }
  })
  decisions = next.catch(() => undefined)
  return next
}

// A quiet turn shows the thread is not answering the main session; the count starts again.
// Once the limit is reached it stays until a commit, so a loop's ticks cannot lift an
// escalation or a pause. Runs in the same queue as the hop decisions; returns the count kept.
function resetHops($: Dollar, head: string, maxHops: number): Promise<number> {
  const next = decisions.then(async () => {
    const current = await read($, hops)
    const keep = maxHops > 0 && current.head === head && current.count >= maxHops
    if (!keep) await update($, hops, () => ({ head, count: 0 }))
    return keep ? current.count : 0
  })
  decisions = next.catch(() => undefined)
  return next
}

export async function sendReport($: Dollar, reason: Report['reason'], answer: string) {
  const ctx = await threadContext($)
  if (!ctx) return
  const { config } = await loadConfig($, ctx.main)

  const base = (await git($, ctx.main, 'rev-parse', '--abbrev-ref', 'HEAD')).stdout.trim()
  const branch = (await git($, ctx.top, 'rev-parse', '--abbrev-ref', 'HEAD')).stdout.trim()
  const ahead = Number((await git($, ctx.top, 'rev-list', '--count', `${base}..HEAD`)).stdout.trim()) || 0
  const report: Report = { slug: ctx.slug, branch, threadBranch: ctx.threadBranch, ahead, dirty: await dirtyCount($, ctx.top, true), reason, answer }
  const head = (await git($, ctx.top, 'rev-parse', 'HEAD')).stdout.trim()
  const pill = { ahead: report.ahead, dirty: report.dirty, reason, pausedAfter: 0 }
  if (!config.report) return setPill($, threadPill(pill))
  if (reason === 'answer' && isQuietAnswer(answer)) {
    const kept = await resetHops($, head, config.maxHops)
    return setPill($, threadPill({ ...pill, pausedAfter: kept > config.maxHops ? kept : 0 }))
  }

  const decision = await decide($, report, head, config.maxHops)
  if (!decision) return
  const paused = decision.action === 'notify' || decision.action === 'silent'
  await setPill($, threadPill({ ...pill, pausedAfter: paused ? decision.count : 0 }))
  switch (decision.action) {
    case 'silent':
      return
    case 'notify': {
      const parent = parseParent(await readNote($, `${ctx.gitDir}/wakemux-parent`))
      await notify($, await agentSurface($, parent), ctx.slug, `${decision.count} reports in a row without a new commit. Reports pause until the thread commits.`)
      return
    }
    case 'escalate': {
      const note = escalationNote(decision.count)
      const noteBytes = new TextEncoder().encode(note).length + 2
      return deliver($, ctx, `${reportText(report, config.reportMaxBytes - noteBytes)}\n\n${note}`)
    }
    case 'send':
      return deliver($, ctx, reportText(report, config.reportMaxBytes))
  }
}
