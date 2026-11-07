import { expect, test } from 'claude-code/testing'

import { DEFAULTS, ENV_NAMES, resolveConfig, userConfigPath } from './config'
import type { Key } from './config'

const NONE = { env: {}, options: {} }

test('without any source every key has its default', () => {
  const { config, sources, warnings } = resolveConfig(NONE)
  expect(config).toEqual(DEFAULTS)
  expect(Object.values(sources).every(source => source === 'default')).toBe(true)
  expect(warnings).toEqual([])
})

test('the defaults match the documented design', () => {
  expect(DEFAULTS).toEqual({
    worktreeDir: '.claude/worktrees',
    branchPrefix: 'thread/',
    copyFiles: ['.env'],
    devLayout: 'auto',
    devCommand: '',
    report: true,
    reportMaxBytes: 30000,
    prRequiredOrgs: [],
    mergePolicy: 'repo-rules',
    scriptPath: '',
    maxThreads: 4,
    maxHops: 6,
    prStatus: true,
    crossReview: 'off',
  })
})

test('every key has an environment variable named WAKEMUX_ plus the key in upper snake case', () => {
  const snake = (key: string) => 'WAKEMUX_' + key.replace(/[A-Z]/g, letter => '_' + letter).toUpperCase()
  expect(Object.keys(ENV_NAMES).sort()).toEqual(Object.keys(DEFAULTS).sort())
  for (const key of Object.keys(DEFAULTS) as Key[]) expect(ENV_NAMES[key]).toBe(snake(key))
})

test('userConfigPath prefers XDG_CONFIG_HOME and falls back to ~/.config', () => {
  expect(userConfigPath({ HOME: '/Users/a' })).toBe('/Users/a/.config/wakemux/config.json')
  expect(userConfigPath({ HOME: '/Users/a', XDG_CONFIG_HOME: '/x' })).toBe('/x/wakemux/config.json')
  expect(userConfigPath({ HOME: '/Users/a', XDG_CONFIG_HOME: 'relative' })).toBe('/Users/a/.config/wakemux/config.json')
  expect(userConfigPath({})).toBe('')
})

test('each source wins over every source below it', () => {
  const all = {
    env: { WAKEMUX_MAX_THREADS: '1' },
    options: { maxThreads: 2 },
    repoFile: JSON.stringify({ maxThreads: 3 }),
    userFile: JSON.stringify({ maxThreads: 5 }),
  }
  expect(resolveConfig(all).config.maxThreads).toBe(1)
  expect(resolveConfig(all).sources.maxThreads).toBe('env')
  expect(resolveConfig({ ...all, env: {} }).sources.maxThreads).toBe('plugin')
  expect(resolveConfig({ ...all, env: {}, options: {} }).sources.maxThreads).toBe('repo')
  expect(resolveConfig({ ...all, env: {}, options: {}, repoFile: undefined }).sources.maxThreads).toBe('user')
  expect(resolveConfig({ ...all, env: {}, options: {}, repoFile: undefined }).config.maxThreads).toBe(5)
})

test('sources mix per key', () => {
  const { config, sources } = resolveConfig({
    env: { WAKEMUX_REPORT: '0' },
    options: {},
    repoFile: JSON.stringify({ branchPrefix: 'task/' }),
    userFile: JSON.stringify({ maxHops: 3 }),
  })
  expect(config.report).toBe(false)
  expect(config.branchPrefix).toBe('task/')
  expect(config.maxHops).toBe(3)
  expect(sources.devLayout).toBe('default')
})

test('environment values are parsed from text', () => {
  const { config, warnings } = resolveConfig({
    env: {
      WAKEMUX_REPORT: 'off',
      WAKEMUX_PR_STATUS: 'yes',
      WAKEMUX_REPORT_MAX_BYTES: '20000',
      WAKEMUX_COPY_FILES: '.env, local.db  .env.local',
      WAKEMUX_PR_REQUIRED_ORGS: 'acme,example-org',
      WAKEMUX_DEV_LAYOUT: 'off',
    },
    options: {},
  })
  expect(warnings).toEqual([])
  expect(config.report).toBe(false)
  expect(config.prStatus).toBe(true)
  expect(config.reportMaxBytes).toBe(20000)
  expect(config.copyFiles).toEqual(['.env', 'local.db', '.env.local'])
  expect(config.prRequiredOrgs).toEqual(['acme', 'example-org'])
  expect(config.devLayout).toBe('off')
})

test('an empty environment variable counts as unset', () => {
  const { config, sources, warnings } = resolveConfig({ env: { WAKEMUX_MAX_THREADS: '' }, options: {} })
  expect(config.maxThreads).toBe(4)
  expect(sources.maxThreads).toBe('default')
  expect(warnings).toEqual([])
})

test('an empty list in a file clears the default', () => {
  const { config } = resolveConfig({ ...NONE, userFile: JSON.stringify({ copyFiles: [] }) })
  expect(config.copyFiles).toEqual([])
})

test('an invalid value is skipped with a warning and a lower source applies', () => {
  const { config, sources, warnings } = resolveConfig({
    env: { WAKEMUX_MAX_THREADS: 'many' },
    options: {},
    userFile: JSON.stringify({ maxThreads: 2 }),
  })
  expect(config.maxThreads).toBe(2)
  expect(sources.maxThreads).toBe('user')
  expect(warnings.length).toBe(1)
  expect(warnings[0]).toContain('WAKEMUX_MAX_THREADS')
})

test('invalid values of every kind are rejected', () => {
  const bad = {
    worktreeDir: '../outside',
    branchPrefix: 'bad..prefix',
    copyFiles: ['/etc/passwd'],
    devLayout: 'sometimes',
    devCommand: 42,
    report: 'yes',
    reportMaxBytes: 64000,
    prRequiredOrgs: ['not an org'],
    mergePolicy: 'whatever',
    maxThreads: -1,
    maxHops: 2.5,
    prStatus: 1,
    crossReview: 'rm -rf /',
  }
  const { config, warnings } = resolveConfig({ ...NONE, userFile: JSON.stringify(bad) })
  expect(config).toEqual(DEFAULTS)
  expect(warnings.length).toBe(Object.keys(bad).length)
})

test('paths must stay inside the repository', () => {
  for (const worktreeDir of ['/abs', '..', 'a/../b', '', 'a//b', 'trees\ncreated\t/tmp/x', 'a\tb']) {
    expect(resolveConfig({ ...NONE, userFile: JSON.stringify({ worktreeDir }) }).config.worktreeDir).toBe('.claude/worktrees')
  }
  expect(resolveConfig({ ...NONE, userFile: JSON.stringify({ worktreeDir: 'work/trees/' }) }).config.worktreeDir).toBe('work/trees')
  expect(resolveConfig({ ...NONE, userFile: JSON.stringify({ copyFiles: ['../x'] }) }).config.copyFiles).toEqual(['.env'])
})

test('branch prefixes must be valid in a git ref', () => {
  for (const branchPrefix of ['', '-x/', '/x', 'a b/', 'x.lock/', 'a~b/', 'a//b', '.hidden/']) {
    expect(resolveConfig({ ...NONE, userFile: JSON.stringify({ branchPrefix }) }).config.branchPrefix).toBe('thread/')
  }
  expect(resolveConfig({ ...NONE, userFile: JSON.stringify({ branchPrefix: 'wip-' }) }).config.branchPrefix).toBe('wip-')
})

test('number limits hold at their bounds', () => {
  const at = (maxThreads: number) => resolveConfig({ ...NONE, userFile: JSON.stringify({ maxThreads }) }).config.maxThreads
  expect(at(0)).toBe(0)
  expect(at(100)).toBe(100)
  expect(at(101)).toBe(4)
  const bytes = (reportMaxBytes: number) =>
    resolveConfig({ ...NONE, userFile: JSON.stringify({ reportMaxBytes }) }).config.reportMaxBytes
  expect(bytes(1000)).toBe(1000)
  expect(bytes(999)).toBe(30000)
  expect(bytes(32000)).toBe(32000)
  expect(bytes(32001)).toBe(30000)
})

test('crossReview takes off or a command name', () => {
  const review = (crossReview: string) =>
    resolveConfig({ ...NONE, userFile: JSON.stringify({ crossReview }) }).config.crossReview
  expect(review('codex')).toBe('codex')
  expect(review('off')).toBe('off')
  expect(review('Codex')).toBe('off')
  expect(review('codex --yolo')).toBe('off')
})

test('a broken file is skipped with a warning naming the file', () => {
  const { config, warnings } = resolveConfig({ ...NONE, repoFile: '{ not json', userFile: '[1, 2]' })
  expect(config).toEqual(DEFAULTS)
  expect(warnings.length).toBe(2)
  expect(warnings.some(warning => warning.includes('.wakemux.json'))).toBe(true)
  expect(warnings.some(warning => warning.includes('config.json'))).toBe(true)
})

test('unknown keys are reported and ignored', () => {
  const { config, warnings } = resolveConfig({ ...NONE, userFile: JSON.stringify({ maxThread: 2 }) })
  expect(config).toEqual(DEFAULTS)
  expect(warnings).toEqual(['config.json: unknown key "maxThread"'])
})

test('a repository file cannot set scriptPath, because the mod runs that path without asking', () => {
  const { config, warnings } = resolveConfig({ ...NONE, repoFile: JSON.stringify({ scriptPath: '/tmp/evil' }) })
  expect(config.scriptPath).toBe('')
  expect(warnings[0]).toContain('scriptPath')
  const user = resolveConfig({ ...NONE, userFile: JSON.stringify({ scriptPath: '/opt/wakemux/bin/wakemux' }) })
  expect(user.config.scriptPath).toBe('/opt/wakemux/bin/wakemux')
  expect(resolveConfig({ ...NONE, userFile: JSON.stringify({ scriptPath: 'relative/wakemux' }) }).config.scriptPath).toBe('')
})

test('plugin options arrive typed and are validated like file values', () => {
  const { config, warnings } = resolveConfig({
    env: {},
    options: { prRequiredOrgs: ['acme'], report: false, maxThreads: 'two' },
  })
  expect(config.prRequiredOrgs).toEqual(['acme'])
  expect(config.report).toBe(false)
  expect(config.maxThreads).toBe(4)
  expect(warnings.length).toBe(1)
})

test('an empty plugin option counts as unset', () => {
  const { sources } = resolveConfig({ env: {}, options: { crossReview: '', prRequiredOrgs: [] } })
  expect(sources.crossReview).toBe('default')
  expect(sources.prRequiredOrgs).toBe('default')
})

test('the result is a copy: changing it does not change the defaults', () => {
  const { config } = resolveConfig(NONE)
  config.copyFiles.push('x')
  expect(DEFAULTS.copyFiles).toEqual(['.env'])
})
