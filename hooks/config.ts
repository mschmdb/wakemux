// Settings and where they come from. Pure: the caller reads the environment, the plugin
// options and the two files, and this module decides what applies.
//
// Precedence, highest first: WAKEMUX_<KEY> environment variable, plugin userConfig option,
// .wakemux.json in the repository, the user's config.json, the default below.
// An invalid value is skipped with a warning, so the next source down applies.

export type Config = {
  worktreeDir: string
  branchPrefix: string
  copyFiles: string[]
  devLayout: 'auto' | 'off'
  devCommand: string
  report: boolean
  reportMaxBytes: number
  prRequiredOrgs: string[]
  mergePolicy: 'repo-rules' | 'pr' | 'merge'
  scriptPath: string
  maxThreads: number
  maxHops: number
  prStatus: boolean
  crossReview: string
}

export type Key = keyof Config
export type Source = 'env' | 'plugin' | 'repo' | 'user' | 'default'

export type ConfigInput = {
  env: Readonly<Record<string, string | undefined>>
  options: Readonly<Record<string, unknown>>
  repoFile?: string
  userFile?: string
}

export type ResolvedConfig = {
  config: Config
  sources: Record<Key, Source>
  warnings: string[]
}

export const DEFAULTS: Readonly<Config> = Object.freeze({
  worktreeDir: '.claude/worktrees',
  branchPrefix: 'thread/',
  copyFiles: ['.env'],
  devLayout: 'auto',
  devCommand: '',
  report: true,
  reportMaxBytes: 30000,
  prRequiredOrgs: [],
  mergePolicy: 'repo-rules',
  // Empty means the script bundled with the plugin.
  scriptPath: '',
  maxThreads: 4,
  maxHops: 6,
  prStatus: true,
  crossReview: 'off',
})

export const REPO_FILE = '.wakemux.json'
const USER_FILE_LABEL = 'config.json'

// The mod runs scriptPath without asking, so a cloned repository must not choose it.
const USER_ONLY: ReadonlySet<Key> = new Set<Key>(['scriptPath'])

type Kind = 'string' | 'boolean' | 'number' | 'list'
type Check = (value: never) => boolean

const SPEC: { [K in Key]: { kind: Kind; check: (value: Config[K]) => boolean } } = {
  worktreeDir: { kind: 'string', check: value => isInsidePath(value) },
  branchPrefix: { kind: 'string', check: value => isRefPrefix(value) },
  copyFiles: { kind: 'list', check: value => value.every(isInsidePath) },
  devLayout: { kind: 'string', check: value => value === 'auto' || value === 'off' },
  devCommand: { kind: 'string', check: () => true },
  report: { kind: 'boolean', check: () => true },
  reportMaxBytes: { kind: 'number', check: value => isIntegerIn(value, 1000, 32000) },
  prRequiredOrgs: { kind: 'list', check: value => value.every(org => /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(org)) },
  mergePolicy: { kind: 'string', check: value => value === 'repo-rules' || value === 'pr' || value === 'merge' },
  scriptPath: { kind: 'string', check: value => value.startsWith('/') && !value.split('/').includes('..') },
  maxThreads: { kind: 'number', check: value => isIntegerIn(value, 0, 100) },
  maxHops: { kind: 'number', check: value => isIntegerIn(value, 0, 100) },
  prStatus: { kind: 'boolean', check: () => true },
  crossReview: { kind: 'string', check: value => /^[a-z][a-z0-9-]*$/.test(value) },
}

const KEYS = Object.keys(SPEC) as Key[]

// Spelled out because the mod reads each variable with a string literal ($.env.get).
export const ENV_NAMES = {
  worktreeDir: 'WAKEMUX_WORKTREE_DIR',
  branchPrefix: 'WAKEMUX_BRANCH_PREFIX',
  copyFiles: 'WAKEMUX_COPY_FILES',
  devLayout: 'WAKEMUX_DEV_LAYOUT',
  devCommand: 'WAKEMUX_DEV_COMMAND',
  report: 'WAKEMUX_REPORT',
  reportMaxBytes: 'WAKEMUX_REPORT_MAX_BYTES',
  prRequiredOrgs: 'WAKEMUX_PR_REQUIRED_ORGS',
  mergePolicy: 'WAKEMUX_MERGE_POLICY',
  scriptPath: 'WAKEMUX_SCRIPT_PATH',
  maxThreads: 'WAKEMUX_MAX_THREADS',
  maxHops: 'WAKEMUX_MAX_HOPS',
  prStatus: 'WAKEMUX_PR_STATUS',
  crossReview: 'WAKEMUX_CROSS_REVIEW',
} as const satisfies Record<Key, string>

export type EnvName = (typeof ENV_NAMES)[Key] | 'HOME' | 'XDG_CONFIG_HOME'

export function userConfigPath(env: Readonly<Record<string, string | undefined>>): string {
  const xdg = env.XDG_CONFIG_HOME ?? ''
  if (xdg.startsWith('/')) return `${xdg.replace(/\/+$/, '')}/wakemux/config.json`
  return env.HOME ? `${env.HOME.replace(/\/+$/, '')}/.config/wakemux/config.json` : ''
}

function isIntegerIn(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max
}

// A relative path that cannot leave the repository.
function isInsidePath(value: string): boolean {
  const trimmed = value.replace(/\/+$/, '')
  if (trimmed === '' || trimmed.startsWith('/')) return false
  return trimmed.split('/').every(part => part !== '' && part !== '.' && part !== '..')
}

// The prefix plus a slug of a-z, 0-9 and - must form a valid branch name (git check-ref-format).
function isRefPrefix(value: string): boolean {
  if (value === '' || value.startsWith('/') || value.startsWith('-')) return false
  if (/[\s~^:?*[\\\x00-\x1f\x7f]|\.\.|@\{|\/\//.test(value)) return false
  const parts = value.split('/')
  const closed = parts.slice(0, -1)
  return parts.every(part => !part.startsWith('.')) && closed.every(part => part !== '' && !part.endsWith('.lock') && !part.endsWith('.'))
}

function normalize(value: string, key: Key): string {
  return key === 'worktreeDir' ? value.replace(/\/+$/, '') : value
}

const TRUE = new Set(['1', 'true', 'yes', 'on'])
const FALSE = new Set(['0', 'false', 'no', 'off'])

function fromText(kind: Kind, text: string): unknown {
  switch (kind) {
    case 'string':
      return text
    case 'boolean': {
      const lower = text.trim().toLowerCase()
      return TRUE.has(lower) ? true : FALSE.has(lower) ? false : text
    }
    case 'number':
      return /^\s*-?\d+\s*$/.test(text) ? Number(text) : text
    case 'list':
      return text.split(/[\s,]+/).filter(Boolean)
  }
}

function hasKind(kind: Kind, value: unknown): boolean {
  switch (kind) {
    case 'string':
      return typeof value === 'string'
    case 'boolean':
      return typeof value === 'boolean'
    case 'number':
      return typeof value === 'number'
    case 'list':
      return Array.isArray(value) && value.every(item => typeof item === 'string')
  }
}

function accept(key: Key, value: unknown): unknown | undefined {
  const spec = SPEC[key]
  if (!hasKind(spec.kind, value)) return undefined
  const normalized = typeof value === 'string' ? normalize(value, key) : value
  return (spec.check as Check)(normalized as never) ? normalized : undefined
}

function parseFile(text: string | undefined, label: string, warnings: string[]): Record<string, unknown> {
  if (text === undefined) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    warnings.push(`${label}: not valid JSON, file ignored`)
    return {}
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    warnings.push(`${label}: expected a JSON object, file ignored`)
    return {}
  }
  const record = parsed as Record<string, unknown>
  for (const key of Object.keys(record)) {
    if (!(key in SPEC)) warnings.push(`${label}: unknown key "${key}"`)
  }
  return record
}

function describe(value: unknown): string {
  const text = JSON.stringify(value) ?? String(value)
  return text.length > 60 ? text.slice(0, 57) + '...' : text
}

export function resolveConfig(input: ConfigInput): ResolvedConfig {
  const warnings: string[] = []
  const repo = parseFile(input.repoFile, REPO_FILE, warnings)
  const user = parseFile(input.userFile, USER_FILE_LABEL, warnings)

  const config = { ...DEFAULTS, copyFiles: [...DEFAULTS.copyFiles], prRequiredOrgs: [...DEFAULTS.prRequiredOrgs] } as Config
  const sources = {} as Record<Key, Source>

  for (const key of KEYS) {
    const kind = SPEC[key].kind
    const name = ENV_NAMES[key]
    const envText = input.env[name]
    const option = input.options[key]
    const candidates: { source: Exclude<Source, 'default'>; label: string; value: unknown }[] = []
    if (envText !== undefined && envText !== '') candidates.push({ source: 'env', label: name, value: fromText(kind, envText) })
    // The config dialog cannot tell an empty field from an unset one, so empty means unset.
    if (option !== undefined && option !== '' && !(Array.isArray(option) && option.length === 0)) {
      candidates.push({ source: 'plugin', label: `plugin option ${key}`, value: option })
    }
    if (key in repo) {
      if (USER_ONLY.has(key)) warnings.push(`${REPO_FILE}: "${key}" can only be set by the user, value ignored`)
      else candidates.push({ source: 'repo', label: `${REPO_FILE} ${key}`, value: repo[key] })
    }
    if (key in user) candidates.push({ source: 'user', label: `${USER_FILE_LABEL} ${key}`, value: user[key] })

    sources[key] = 'default'
    for (const candidate of candidates) {
      const value = accept(key, candidate.value)
      if (value === undefined) {
        warnings.push(`${candidate.label}: invalid value ${describe(candidate.value)}, ignored`)
        continue
      }
      ;(config as Record<Key, unknown>)[key] = Array.isArray(value) ? [...value] : value
      sources[key] = candidate.source
      break
    }
  }
  return { config, sources, warnings }
}
