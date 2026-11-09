// Process, git and cmux calls and the configuration as the mod reads it.
import type { EngineInterface } from 'claude-code'

import type { Config, EnvName } from './config'
import { REPO_FILE, resolveConfig, userConfigPath } from './config'

export type Dollar = EngineInterface

export type Run = { exitCode: number; stdout: string; stderr: string }

// The plugin's userConfig values; register hands them over on every load.
let pluginOptions: Readonly<Record<string, unknown>> = {}

export function setPluginOptions(options: Readonly<Record<string, unknown>>) {
  pluginOptions = options
}

export async function run($: Dollar, argv: string[], cwd?: string, env?: Record<string, string>, stdin?: string): Promise<Run> {
  try {
    return await $.process.run(argv, { cwd, env, stdin, timeoutMs: 20_000 })
  } catch (error) {
    return { exitCode: 127, stdout: '', stderr: String(error) }
  }
}

export function git($: Dollar, cwd: string, ...args: string[]) {
  return run($, ['git', '-C', cwd, ...args])
}
export function cmux($: Dollar, ...args: string[]) {
  return run($, ['cmux', ...args], undefined, { CMUX_QUIET: '1' })
}

export async function mainCheckout($: Dollar, dir = '.'): Promise<string> {
  const common = await git($, dir, 'rev-parse', '--path-format=absolute', '--git-common-dir')
  if (common.exitCode !== 0) return ''
  return common.stdout.trim().replace(/\/\.git\/?$/, '')
}

// Threads are run from the main checkout; a thread's own session must not merge itself.
export async function isMainSession($: Dollar): Promise<boolean> {
  const repo = await mainCheckout($)
  const top = (await git($, '.', 'rev-parse', '--show-toplevel')).stdout.trim()
  return repo !== '' && top === repo
}

export async function dirtyCount($: Dollar, cwd: string, untracked: boolean): Promise<number> {
  const status = await git($, cwd, 'status', '--porcelain', untracked ? '-unormal' : '-uno')
  return status.stdout.split('\n').filter(Boolean).length
}

async function readOptional($: Dollar, path: string): Promise<string | undefined> {
  if (!path || !(await $.fs.exists(path))) return undefined
  try {
    return await $.fs.read(path)
  } catch (error) {
    // An unreadable file must not look like an empty one: hand back text that fails to parse.
    return `unreadable: ${String(error)}`
  }
}

// $.env.get takes string literals only, so every variable is spelled out.
// Typed by EnvName, so a setting added to config.ts without a line here fails the type check.
async function readEnv($: Dollar): Promise<Record<EnvName, string | undefined>> {
  return {
    HOME: await $.env.get('HOME'),
    XDG_CONFIG_HOME: await $.env.get('XDG_CONFIG_HOME'),
    WAKEMUX_WORKTREE_DIR: await $.env.get('WAKEMUX_WORKTREE_DIR'),
    WAKEMUX_BRANCH_PREFIX: await $.env.get('WAKEMUX_BRANCH_PREFIX'),
    WAKEMUX_COPY_FILES: await $.env.get('WAKEMUX_COPY_FILES'),
    WAKEMUX_DEV_LAYOUT: await $.env.get('WAKEMUX_DEV_LAYOUT'),
    WAKEMUX_DEV_COMMAND: await $.env.get('WAKEMUX_DEV_COMMAND'),
    WAKEMUX_REPORT: await $.env.get('WAKEMUX_REPORT'),
    WAKEMUX_REPORT_MAX_BYTES: await $.env.get('WAKEMUX_REPORT_MAX_BYTES'),
    WAKEMUX_PR_REQUIRED_ORGS: await $.env.get('WAKEMUX_PR_REQUIRED_ORGS'),
    WAKEMUX_MERGE_POLICY: await $.env.get('WAKEMUX_MERGE_POLICY'),
    WAKEMUX_SCRIPT_PATH: await $.env.get('WAKEMUX_SCRIPT_PATH'),
    WAKEMUX_MAX_THREADS: await $.env.get('WAKEMUX_MAX_THREADS'),
    WAKEMUX_MAX_HOPS: await $.env.get('WAKEMUX_MAX_HOPS'),
    WAKEMUX_PR_STATUS: await $.env.get('WAKEMUX_PR_STATUS'),
    WAKEMUX_CROSS_REVIEW: await $.env.get('WAKEMUX_CROSS_REVIEW'),
  }
}

export async function loadConfig($: Dollar, repo: string): Promise<{ config: Config; warnings: string[] }> {
  const env = await readEnv($)
  const { config, warnings } = resolveConfig({
    env,
    options: pluginOptions,
    repoFile: repo ? await readOptional($, `${repo}/${REPO_FILE}`) : undefined,
    userFile: await readOptional($, userConfigPath(env)),
  })
  for (const warning of warnings) $.ui.log(`wakemux: ${warning}`, { to: 'debug' })
  return { config, warnings }
}
