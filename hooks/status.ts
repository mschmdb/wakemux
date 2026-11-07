// The thread's pill in the cmux sidebar (`cmux set-status wakemux ...`): its lead over the base
// and whether it has uncommitted work, so the user sees each thread's state without the pane.

import type { Report } from './parse'

export type Pill = { value: string; color: string }

export type PillInput = { ahead: number; dirty: number; reason: Report['reason']; pausedAfter: number }

const GREEN = '#34C759'
const ORANGE = '#FF9500'
const GREY = '#8E8E93'
const RED = '#FF3B30'

export function threadPill(input: PillInput): Pill {
  if (input.pausedAfter > 0) return { value: `reports paused after ${input.pausedAfter} without a commit`, color: RED }
  if (input.reason === 'error') return { value: `error · +${input.ahead}`, color: RED }
  if (input.reason === 'refusal') return { value: `refused · +${input.ahead}`, color: RED }
  if (input.dirty > 0) return { value: `+${input.ahead} · ${input.dirty} uncommitted`, color: ORANGE }
  if (input.ahead > 0) return { value: `+${input.ahead} · clean`, color: GREEN }
  return { value: 'no commits yet', color: GREY }
}
