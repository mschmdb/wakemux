import { expect, test } from 'claude-code/testing'

import { threadPill } from './status'

test('a clean thread with commits shows its lead in green', () => {
  expect(threadPill({ ahead: 3, dirty: 0, reason: 'answer', pausedAfter: 0 })).toEqual({ value: '+3 · clean', color: '#34C759' })
})

test('uncommitted changes show in orange', () => {
  expect(threadPill({ ahead: 1, dirty: 2, reason: 'answer', pausedAfter: 0 })).toEqual({ value: '+1 · 2 uncommitted', color: '#FF9500' })
})

test('a thread without commits or changes shows grey', () => {
  expect(threadPill({ ahead: 0, dirty: 0, reason: 'answer', pausedAfter: 0 })).toEqual({ value: 'no commits yet', color: '#8E8E93' })
})

test('an error or a refusal shows red with the lead', () => {
  expect(threadPill({ ahead: 2, dirty: 0, reason: 'error', pausedAfter: 0 })).toEqual({ value: 'error · +2', color: '#FF3B30' })
  expect(threadPill({ ahead: 0, dirty: 1, reason: 'refusal', pausedAfter: 0 })).toEqual({ value: 'refused · +0', color: '#FF3B30' })
})

test('paused reports win over everything else', () => {
  expect(threadPill({ ahead: 2, dirty: 1, reason: 'error', pausedAfter: 7 })).toEqual({ value: 'reports paused after 7 without a commit', color: '#FF3B30' })
})

test('an aborted turn keeps the normal state', () => {
  expect(threadPill({ ahead: 1, dirty: 0, reason: 'aborted', pausedAfter: 0 }).value).toBe('+1 · clean')
})
