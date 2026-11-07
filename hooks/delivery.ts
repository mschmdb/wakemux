// Pure helpers for getting a thread's report to the main session: reading cmux's answers,
// the hop limit, deduplication and the texts of the fallbacks.

import type { Report } from './parse'

export type Sent = { id: string; state: string; hasAgent: boolean; surfaceId: string }

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

// Reads the answer of `cmux agent message --json`.
export function parseSent(json: string): Sent | null {
  const record = asRecord(parseJson(json))
  if (!record || typeof record.id !== 'string' || record.id === '') return null
  return {
    id: record.id,
    state: typeof record.state === 'string' ? record.state : '',
    hasAgent: record.recipient_has_agent === true,
    surfaceId: typeof record.recipient_surface_id === 'string' ? record.recipient_surface_id : '',
  }
}

// The state of one message in `cmux agent inbox --json`, or '' when it is not listed.
export function messageState(inboxJson: string, id: string): string {
  const messages = asRecord(parseJson(inboxJson))?.messages
  if (!Array.isArray(messages)) return ''
  for (const message of messages) {
    const record = asRecord(message)
    if (record?.id === id) return typeof record.state === 'string' ? record.state : ''
  }
  return ''
}

const BUSY_WAIT_MS = 600_000

// A queued message is normal while the receiving session works: cmux hands it over at the
// session's next step. Only an idle session with a queued message has lost its poller.
export function keepWaiting(agentStatus: string, waitedMs: number): boolean {
  return agentStatus.startsWith('Running') && waitedMs < BUSY_WAIT_MS
}

// The agent surface of a workspace, from `cmux agent messages status <workspace> --json`.
export function parseAgentSurface(json: string): string {
  const id = asRecord(parseJson(json))?.id
  return typeof id === 'string' ? id : ''
}

export type Hops = { head: string; count: number }

// A hop is a report on the same commit as the one before it.
export function nextHops(previous: Hops, head: string): Hops {
  return previous.head === head ? { head, count: previous.count + 1 } : { head, count: 1 }
}

export type HopAction = 'send' | 'escalate' | 'notify' | 'silent'

// Below the limit: report. At it: report and ask the main session to escalate.
// One above: tell the user with a desktop notification. Beyond: stay quiet until a new commit.
export function hopAction(count: number, maxHops: number): HopAction {
  if (maxHops === 0 || count < maxHops) return 'send'
  if (count === maxHops) return 'escalate'
  return count === maxHops + 1 ? 'notify' : 'silent'
}

export function escalationNote(count: number): string {
  return `[wakemux] ${count} reports in a row without a new commit. Do not answer this thread yourself; ask the user how to go on.`
}

const DUPLICATE_WINDOW_MS = 60_000

export function reportKey(report: Report, head = ''): string {
  // A cheap checksum over the whole answer, so long answers that differ in the middle stay apart.
  let hash = 0
  for (let index = 0; index < report.answer.length; index++) hash = (hash * 31 + report.answer.charCodeAt(index)) | 0
  return [head, report.branch, report.reason, report.ahead, report.dirty, report.answer.length, hash].join('|')
}

export function isDuplicate(last: { key: string; at: number }, key: string, now: number): boolean {
  return last.key !== '' && last.key === key && now - last.at <= DUPLICATE_WINDOW_MS
}

export function forwardText(report: string): string {
  return `${report}\n\n[wakemux] Forwarded because the cmux message was not picked up. It may arrive later as the same report; answer once.`
}

export function notifyBody(report: string): string {
  const [head = '', ...rest] = report.split('\n\n')
  const firstLine = rest.join('\n\n').split('\n').find(line => line.trim() !== '') ?? head
  const text = firstLine.trim()
  return text.length > 200 ? text.slice(0, 199) + '…' : text
}

// `wakemux new` stores the parent's Claude Code session id; only plain ids pass.
export function parseSessionId(note: string): string {
  const value = note.trim()
  return /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|session_[A-Za-z0-9]+)$/.test(value) ? value : ''
}
