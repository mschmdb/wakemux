// Remembers what started each main-loop turn, so the report at its end knows whether it counts
// toward the hop limit. The engine raises `prompt.submit` for the prompt that starts a turn, then
// `turn.start` with the turn's id.

import type { TurnOrigin } from './delivery'
import { turnOrigin } from './delivery'

// Turns end in the order they start; a few ids cover turns whose end the mod never sees.
const KEEP_TURNS = 20

let pending: TurnOrigin | null = null
const origins = new Map<string, TurnOrigin>()

// A submission with a turnId was delivered into that running turn, which keeps its own origin.
export function noteSubmission(kind: string | undefined, text: string, turnId: string | undefined) {
  if (turnId === undefined) pending = turnOrigin(kind, text)
}

export function noteTurnStart(turnId: string) {
  origins.set(turnId, pending ?? 'hop')
  pending = null
  while (origins.size > KEEP_TURNS) origins.delete(origins.keys().next().value as string)
}

// What started the turn; a turn whose start the mod did not see counts as a hop.
export function takeTurnOrigin(turnId: string): TurnOrigin {
  const origin = origins.get(turnId) ?? 'hop'
  origins.delete(turnId)
  return origin
}
