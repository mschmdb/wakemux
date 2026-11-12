// Catch-up for reports that arrived mid-turn: cmux hands a report to a busy session by attaching
// it to the next tool result, and the session may carry on with its task and pass over it. When
// the turn ends, the session reads its own cmux inbox and, for each such report not nudged about
// before, sends itself one short message. The session is idle by then, so the message starts a
// new turn, which is how cmux reliably delivers.

import { atom, read, update } from 'claude-code'

import type { Dollar } from './engine'
import { cmux, run } from './engine'
import { midTurnReports, nudgeText } from './delivery'

// Enough ids to cover the inbox page read below.
const KEEP_IDS = 100

const nudged = atom({ plugin: 'wakemux', key: 'nudged' } as const, [] as string[], { shape: 'nudged-1' })

// Turn ends can overlap; checks run one after another so no report is nudged about twice.
let checks: Promise<unknown> = Promise.resolve()

// endedAt is the clock reading when the turn ended, taken before other hooks ran.
export function nudgeMidTurnReports($: Dollar, endedAt: number, durationMs: number): Promise<void> {
  const check = checks.then(() => checkInbox($, endedAt, durationMs))
  checks = check.catch(() => undefined)
  return check
}

async function checkInbox($: Dollar, endedAt: number, durationMs: number) {
  const surface = (await $.env.get('CMUX_SURFACE_ID')) ?? ''
  if (!surface || !(durationMs > 0)) return
  const turnStart = (endedAt - durationMs) / 1000
  const inbox = await cmux($, 'agent', 'inbox', '--surface', surface, '--json', '--limit', '50')
  const missed = midTurnReports(inbox.stdout, turnStart, await read($, nudged), surface)
  if (missed.length === 0) return
  // One attempt: a session that cmux cannot message cannot be woken by cmux either.
  const sent = await run($, ['cmux', 'agent', 'message', surface, '--from', 'wakemux', '--json', '-'], undefined, { CMUX_QUIET: '1' }, nudgeText(missed))
  if (sent.exitCode !== 0) throw new Error(`cmux agent message exited ${sent.exitCode}: ${sent.stderr.trim()}`)
  await update($, nudged, ids => [...ids, ...missed.map(report => report.id)].slice(-KEEP_IDS))
}
