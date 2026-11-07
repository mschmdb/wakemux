// Report back: a thread session tells the main session whenever its main loop ends a turn.
//
// 1. `cmux agent message` to the session that started the thread, else to the main checkout's.
//    cmux delivers through the receiver's hooks: an idle session wakes up, a busy one reads it
//    at its next step.
// 2. If the message is still queued after DELIVERY_CHECK_MS while the receiver is idle, its cmux
//    poller is likely gone. A busy receiver gets up to ten minutes before that counts. The mod then sends the report through Claude Code (`$.session.send`, what the
//    SendMessage tool does) to the parent session id that `wakemux new` stored.
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
import { isThreadBranch, parseAgentStatus, parseCwd, parseParent, reportText, threadSlugOf, workspaceRefsByTitle } from './parse'

const DELIVERY_CHECK_MS = 15_000

const hops = atom({ plugin: 'wakemux', key: 'hops' } as const, { head: '', count: 0 }, { shape: 'hops-1' })
const lastReport = atom({ plugin: 'wakemux', key: 'lastReport' } as const, { key: '', at: 0 }, { shape: 'last-report-1' })

type ThreadContext = { slug: string; main: string; gitDir: string }
let context: ThreadContext | null | undefined
let mainRef = ''

async function threadContext($: Dollar): Promise<ThreadContext | null> {
  if (context !== undefined) return context
  const main = await mainCheckout($)
  const top = (await git($, '.', 'rev-parse', '--show-toplevel')).stdout.trim()
  const { config } = await loadConfig($, main)
  const slug = threadSlugOf(top, main, config.worktreeDir)
  const branch = (await git($, '.', 'rev-parse', '--abbrev-ref', 'HEAD')).stdout.trim()
  const gitDir = (await git($, '.', 'rev-parse', '--absolute-git-dir')).stdout.trim()
  context = slug && isThreadBranch(branch, config.branchPrefix) ? { slug, main, gitDir } : null
  return context
}

// Every session publishes its id to the commands it runs, so `wakemux new` can store it.
export async function publishSessionId($: Dollar) {
  const id = await $.session.id()
  if (id && (await $.env.get('WAKEMUX_PARENT_SESSION')) !== id) await $.env.set('WAKEMUX_PARENT_SESSION', id)
}

// The main session is the workspace whose cwd is the main checkout. Titles like "main" repeat across projects.
async function findMainRef($: Dollar, main: string): Promise<string> {
  const refs = [...workspaceRefsByTitle((await cmux($, 'tree', '--all', '--json')).stdout).values()].flat()
  for (const ref of refs) {
    if (parseCwd((await cmux($, 'sidebar-state', '--workspace', ref)).stdout) === main) return ref
  }
  return ''
}

async function readNote($: Dollar, path: string): Promise<string> {
  return (await run($, ['/bin/cat', path])).stdout
}

function sendMessage($: Dollar, target: string, from: string, text: string) {
  return run($, ['cmux', 'agent', 'message', target, '--from', from, '--json', '-'], undefined, { CMUX_QUIET: '1' }, text)
}

// The first target with an agent wins; the spawning session first, then the main checkout's.
async function sendThroughCmux($: Dollar, ctx: ThreadContext, parent: string, text: string): Promise<{ sent: Sent | null; target: string }> {
  if (parent) {
    const sent = parseSent((await sendMessage($, parent, ctx.slug, text)).stdout)
    if (sent?.hasAgent) return { sent, target: parent }
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!mainRef) mainRef = await findMainRef($, ctx.main)
    if (!mainRef || mainRef === parent) break
    const sent = parseSent((await sendMessage($, mainRef, ctx.slug, text)).stdout)
    if (sent?.hasAgent) return { sent, target: mainRef }
    mainRef = ''
  }
  return { sent: null, target: parent || mainRef }
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

export async function sendReport($: Dollar, reason: Report['reason'], answer: string) {
  const ctx = await threadContext($)
  if (!ctx) return
  const { config } = await loadConfig($, ctx.main)

  const base = (await git($, ctx.main, 'rev-parse', '--abbrev-ref', 'HEAD')).stdout.trim()
  const branch = (await git($, '.', 'rev-parse', '--abbrev-ref', 'HEAD')).stdout.trim()
  const ahead = Number((await git($, '.', 'rev-list', '--count', `${base}..HEAD`)).stdout.trim()) || 0
  const report: Report = { slug: ctx.slug, branch, ahead, dirty: await dirtyCount($, '.', true), reason, answer }
  const head = (await git($, '.', 'rev-parse', 'HEAD')).stdout.trim()
  const pill = { ahead: report.ahead, dirty: report.dirty, reason, pausedAfter: 0 }
  if (!config.report) return setPill($, threadPill(pill))

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
