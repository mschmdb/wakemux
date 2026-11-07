import { expect, test } from 'claude-code/testing'

import {
  handOverPrompt,
  isPrRequiredRemote,
  parseParent,
  reportText,
  threadSlugOf,
  parseAgentStatus,
  parseCwd,
  parseCounts,
  parseWorktrees,
  workspaceRefsByTitle,
} from './parse'

const MAIN = '/Users/m/Sites/app'

test('parseWorktrees keeps only threads under .claude/worktrees', () => {
  const porcelain = [
    `worktree ${MAIN}`,
    'HEAD 1111',
    'branch refs/heads/feature/x',
    '',
    `worktree ${MAIN}/.claude/worktrees/og-images`,
    'HEAD 2222',
    'branch refs/heads/thread/og-images',
    '',
    `worktree ${MAIN}/.claude/worktrees/detached`,
    'HEAD 3333',
    'detached',
    '',
    '/elsewhere',
  ].join('\n')

  expect(parseWorktrees(porcelain, MAIN)).toEqual([
    {
      slug: 'og-images',
      path: `${MAIN}/.claude/worktrees/og-images`,
      branch: 'thread/og-images',
    },
    { slug: 'detached', path: `${MAIN}/.claude/worktrees/detached`, branch: '' },
  ])
})

test('parseWorktrees returns nothing for a repo without threads', () => {
  expect(parseWorktrees(`worktree ${MAIN}\nHEAD 1\nbranch refs/heads/main\n`, MAIN)).toEqual([])
})

test('parseCounts reads behind and ahead from rev-list --left-right', () => {
  expect(parseCounts('3\t5\n')).toEqual({ behind: 3, ahead: 5 })
  expect(parseCounts('')).toEqual({ behind: 0, ahead: 0 })
  expect(parseCounts('garbage')).toEqual({ behind: 0, ahead: 0 })
})

test('parseAgentStatus reads the claude_code entry of sidebar-state', () => {
  const state = [
    'cwd=/x',
    'status_count=2',
    '  program_status=claude-code · Reading icon=bolt.fill priority=2',
    '  claude_code=Running icon=bolt.fill color=#4C8DFF work=running',
  ].join('\n')

  expect(parseAgentStatus(state)).toBe('Running')
  expect(parseAgentStatus('  claude_code=Needs input icon=bell')).toBe('Needs input')
  expect(parseAgentStatus('status_count=0')).toBe('')
})

test('workspaceRefsByTitle maps workspace titles to refs, nested anywhere', () => {
  const tree = {
    windows: [
      {
        workspaces: [
          { ref: 'workspace:1', title: 'main', panes: [] },
          { ref: 'workspace:2', title: 'og-images', panes: [{ ref: 'pane:9' }] },
          { ref: 'workspace:3', title: 'og-images', panes: [] },
        ],
      },
    ],
  }

  const refs = workspaceRefsByTitle(JSON.stringify(tree))
  expect(refs.get('og-images')).toEqual(['workspace:2', 'workspace:3'])
  expect(refs.get('pane:9')).toBe(undefined)
  expect(workspaceRefsByTitle('not json').size).toBe(0)
})

test('parseCwd reads the workspace directory of sidebar-state', () => {
  expect(parseCwd('tab=1\ncwd=/a/b c\nfocused_cwd=/x')).toBe('/a/b c')
  expect(parseCwd('tab=1')).toBe('')
})

test('handOverPrompt names thread, branch and base and points to the repo rules', () => {
  const thread = { slug: 'og-images', branch: 'thread/og-images', ahead: 3, merge: 'clean' as const }

  const own = handOverPrompt(thread, 'feature/x', false)
  expect(own).toContain('og-images')
  expect(own).toContain('thread/og-images')
  expect(own).toContain('feature/x')
  expect(own).toContain("this repository's rules")
  expect(own).not.toContain('Merge it')
  expect(own).not.toContain('PRs')

  const required = handOverPrompt({ ...thread, merge: 'conflict' }, 'main', true)
  expect(required).toContain('requires PRs')
  expect(required).toContain('conflict')

  const one = handOverPrompt({ ...thread, ahead: 1 }, 'main', false)
  expect(one).toContain('1 commit ahead of main')
})

test('threadSlugOf finds the thread slug only inside .claude/worktrees of the main checkout', () => {
  expect(threadSlugOf(MAIN + '/.claude/worktrees/og-images', MAIN)).toBe('og-images')
  expect(threadSlugOf(MAIN + '/.claude/worktrees/og-images/src', MAIN)).toBe('og-images')
  expect(threadSlugOf(MAIN, MAIN)).toBe('')
  expect(threadSlugOf('/Users/m/Sites/other/.claude/worktrees/x', MAIN)).toBe('')
  expect(threadSlugOf(MAIN + '/.claude/worktrees/', MAIN)).toBe('')
  expect(threadSlugOf('', '')).toBe('')
})

test('reportText leads with the thread, its state and the answer, and stays below the message limit', () => {
  const text = reportText({ slug: 'og-images', branch: 'thread/og-images', ahead: 2, dirty: 1, reason: 'answer', answer: 'Done. Question: colour A or B?' })
  expect(text.startsWith('[Thread og-images]')).toBe(true)
  expect(text).toContain('thread/og-images')
  expect(text).toContain('2 commits')
  expect(text).toContain('1 uncommitted')
  expect(text).toContain('colour A or B?')

  const aborted = reportText({ slug: 's', branch: 'b', ahead: 0, dirty: 0, reason: 'aborted', answer: '' })
  expect(aborted).toContain('aborted')
  expect(aborted).toContain('0 commits')
  expect(aborted).toContain('clean')
  expect(aborted).toContain('(no text answer)')

  const single = reportText({ slug: 's', branch: '', ahead: 1, dirty: 0, reason: 'error', answer: 'x' })
  expect(single).toContain('1 commit,')
  expect(single).toContain('no branch')
  expect(single).toContain('ended with an error')

  const long = reportText({ slug: 's', branch: 'b', ahead: 0, dirty: 0, reason: 'answer', answer: 'x'.repeat(100_000) })
  expect(new TextEncoder().encode(long).length).toBeLessThanOrEqual(30_000)

  const wide = reportText({ slug: 's', branch: 'b', ahead: 0, dirty: 0, reason: 'answer', answer: '漢'.repeat(20_000) })
  expect(new TextEncoder().encode(wide).length).toBeLessThanOrEqual(30_000)
  expect(wide).toContain('truncated')

  const emoji = reportText({ slug: 's', branch: 'b', ahead: 0, dirty: 0, reason: 'answer', answer: '😀'.repeat(20_000) })
  expect(new TextEncoder().encode(emoji).length).toBeLessThanOrEqual(30_000)
  expect(emoji).not.toContain('\uFFFD')
  expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(emoji)).toBe(false)

  const short = reportText({ slug: 's', branch: 'b', ahead: 0, dirty: 0, reason: 'answer', answer: 'ü'.repeat(1_000) })
  expect(short).not.toContain('truncated')
  expect(long).toContain('truncated')
})

test('isPrRequiredRemote matches GitHub remotes of the listed orgs in https and ssh form', () => {
  const orgs = ['acme', 'Example-Org']
  expect(isPrRequiredRemote('https://github.com/acme/app', orgs)).toBe(true)
  expect(isPrRequiredRemote('git@github.com:acme/app.git', orgs)).toBe(true)
  expect(isPrRequiredRemote('ssh://git@github.com/acme/app.git', orgs)).toBe(true)
  expect(isPrRequiredRemote('ssh://git@github.com:22/acme/app.git', orgs)).toBe(true)
  expect(isPrRequiredRemote('git@github.com:123/app.git', ['123'])).toBe(true)
  expect(isPrRequiredRemote('https://github.com/example-org/app', orgs)).toBe(true)
  expect(isPrRequiredRemote('https://github.com/acme-labs/app', orgs)).toBe(false)
  expect(isPrRequiredRemote('https://github.com/other/acme', orgs)).toBe(false)
  expect(isPrRequiredRemote('https://gitlab.com/acme/app', orgs)).toBe(false)
  expect(isPrRequiredRemote('https://github.com/acme/app', [])).toBe(false)
  expect(isPrRequiredRemote('', orgs)).toBe(false)
})


test('parseParent reads the spawning workspace from the worktree note and ignores junk', () => {
  expect(parseParent('A162CBB9-1FC5-4834-9588-1D1D0293F6EB\n')).toBe('A162CBB9-1FC5-4834-9588-1D1D0293F6EB')
  expect(parseParent('workspace:12')).toBe('workspace:12')
  expect(parseParent('')).toBe('')
  expect(parseParent('  \n')).toBe('')
  expect(parseParent('rm -rf /; echo')).toBe('')
})

test('reportText keeps the whole message within the byte limit it is given', () => {
  const bytes = (text: string) => new TextEncoder().encode(text).length
  for (const limit of [1_000, 5_000, 32_000]) {
    for (const answer of ['x'.repeat(50_000), '漢'.repeat(20_000), '😀'.repeat(20_000)]) {
      const text = reportText({ slug: 'a-long-slug-name', branch: 'thread/a-long-slug-name', ahead: 12, dirty: 3, reason: 'answer', answer }, limit)
      expect(bytes(text)).toBeLessThanOrEqual(limit)
      expect(text).toContain('truncated')
    }
  }
  const branch = 'thread/' + Array.from({ length: 5 }, () => 'b'.repeat(200)).join('/')
  const longHead = reportText({ slug: 's', branch, ahead: 0, dirty: 0, reason: 'answer', answer: 'x'.repeat(5_000) }, 1_000)
  expect(bytes(longHead)).toBeLessThanOrEqual(1_000)
  expect(longHead.startsWith('[Thread s]')).toBe(true)
  expect(longHead).toContain('truncated')

  const fits = reportText({ slug: 's', branch: 'b', ahead: 0, dirty: 0, reason: 'answer', answer: 'x'.repeat(900) }, 1_000)
  expect(fits).not.toContain('truncated')
})
