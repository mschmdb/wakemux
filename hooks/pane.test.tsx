import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { Snapshot, ThreadRow } from '../types'

const PANE = {
  plugin: 'wakemux',
  component: 'Pane',
  requestId: 'threads',
  props: {
    title: 'Threads',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 30 },
    view: {},
  },
} as const

const THREAD: ThreadRow = {
  slug: 'og-images',
  branch: 'thread/og-images',
  path: '/r/.claude/worktrees/og-images',
  ahead: 3,
  behind: 0,
  dirty: 0,
  merge: 'clean',
  agent: 'Running',
  workspaceRef: 'workspace:7',
}

function stubState(on: On, threads: ThreadRow[], baseDirty = 0, warnings: string[] = []) {
  const snapshot: Snapshot = { repo: '/r', base: 'feature/x', prRequired: false, baseDirty, threads, updatedAt: 0, error: '', warnings }
  const stored: Record<string, unknown> = {
    snapshot: { shape: 'snapshot-4', value: snapshot },
    confirm: { shape: 'confirm-1', value: '' },
    message: { shape: 'message-1', value: '' },
  }
  on('state.get', (_, e) => ({ value: { value: stored[(e as { key: string }).key], version: 1 } }))
}

test('a clean thread with commits offers open, hand-over to Claude and cleanup', async ($, on) => {
  stubState(on, [THREAD])
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect((await ui.find({ type: 'Text', text: /og-images · Running/ }))?.text).toBeTruthy()
  expect(await ui.find({ type: 'Button', key: 'open-og-images' })).toBeTruthy()
  expect(await ui.find({ type: 'Button', key: 'clean-og-images' })).toBeTruthy()
  expect(await ui.find({ type: 'Button', key: 'both-og-images' })).toBeTruthy()
  await ui.unmount()
})

test('a dirty thread offers neither merge nor cleanup', async ($, on) => {
  stubState(on, [{ ...THREAD, dirty: 2 }])
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect(await ui.find({ type: 'Button', key: 'both-og-images' })).toBeFalsy()
  expect(await ui.find({ type: 'Button', key: 'clean-og-images' })).toBeFalsy()
  expect((await ui.find({ type: 'Text', text: /2 uncommitted/ }))?.text).toBeTruthy()
  await ui.unmount()
})

test('conflicts still go to Claude, which resolves them in the main checkout', async ($, on) => {
  stubState(on, [{ ...THREAD, merge: 'conflict' }])
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect(await ui.find({ type: 'Button', key: 'both-og-images' })).toBeTruthy()
  expect((await ui.find({ type: 'Text', text: /conflicts/ }))?.text).toBeTruthy()
  await ui.unmount()
})

test('a thread without commits offers no hand-over', async ($, on) => {
  stubState(on, [{ ...THREAD, ahead: 0 }])
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect(await ui.find({ type: 'Button', key: 'both-og-images' })).toBeFalsy()
  expect(await ui.find({ type: 'Button', key: 'clean-og-images' })).toBeTruthy()
  await ui.unmount()
})

test('no threads shows how to start one', async ($, on) => {
  stubState(on, [])
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect((await ui.find({ type: 'Text', text: /No threads/ }))?.text).toBeTruthy()
  await ui.unmount()
})

test('configuration warnings are shown so a bad setting does not fail silently', async ($, on) => {
  stubState(on, [THREAD], 0, ['config.json: invalid value -1, ignored'])
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect((await ui.find({ type: 'Text', text: /config.json: invalid value -1, ignored/ }))?.text).toBeTruthy()
  await ui.unmount()
})

test('no warning line without warnings', async ($, on) => {
  stubState(on, [THREAD])
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })

  expect(await ui.find({ type: 'Text', text: /Settings:/ })).toBeFalsy()
  await ui.unmount()
})
