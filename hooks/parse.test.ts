import { expect, test } from 'claude-code/testing'

import {
  handOverPrompt,
  isPrRequiredRemote,
  parseOrgList,
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
    'branch refs/heads/aufgabe/og-images',
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
      branch: 'aufgabe/og-images',
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
  const thread = { slug: 'og-images', branch: 'aufgabe/og-images', ahead: 3, merge: 'clean' as const }

  const own = handOverPrompt(thread, 'feature/x', false)
  expect(own).toContain('og-images')
  expect(own).toContain('aufgabe/og-images')
  expect(own).toContain('feature/x')
  expect(own).toContain('Regeln dieses Repos')
  expect(own).not.toContain('Merge ihn')
  expect(own).not.toContain('PRs')

  const required = handOverPrompt({ ...thread, merge: 'conflict' }, 'main', true)
  expect(required).toContain('verlangt PRs')
  expect(required).toContain('Konflikte')
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
  const text = reportText({ slug: 'og-images', branch: 'aufgabe/og-images', ahead: 2, dirty: 1, reason: 'answer', answer: 'Fertig. Frage: Farbe A oder B?' })
  expect(text.startsWith('[Thread og-images]')).toBe(true)
  expect(text).toContain('aufgabe/og-images')
  expect(text).toContain('2 Commits')
  expect(text).toContain('1 uncommittet')
  expect(text).toContain('Farbe A oder B?')

  const aborted = reportText({ slug: 's', branch: 'b', ahead: 0, dirty: 0, reason: 'aborted', answer: '' })
  expect(aborted).toContain('abgebrochen')

  const long = reportText({ slug: 's', branch: 'b', ahead: 0, dirty: 0, reason: 'answer', answer: 'x'.repeat(100_000) })
  expect(new TextEncoder().encode(long).length).toBeLessThan(30_000)

  expect(long).toContain('gekürzt')
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

test('parseOrgList splits on commas and whitespace and drops empty entries', () => {
  expect(parseOrgList('acme, example-org\n other')).toEqual(['acme', 'example-org', 'other'])
  expect(parseOrgList(' , ')).toEqual([])
  expect(parseOrgList('')).toEqual([])
})

test('parseParent reads the spawning workspace from the worktree note and ignores junk', () => {
  expect(parseParent('A162CBB9-1FC5-4834-9588-1D1D0293F6EB\n')).toBe('A162CBB9-1FC5-4834-9588-1D1D0293F6EB')
  expect(parseParent('workspace:12')).toBe('workspace:12')
  expect(parseParent('')).toBe('')
  expect(parseParent('  \n')).toBe('')
  expect(parseParent('rm -rf /; echo')).toBe('')
})
