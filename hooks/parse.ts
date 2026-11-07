// Pure parsers for git and cmux output, kept apart from the hooks so they can be tested alone.

export type Worktree = { slug: string; path: string; branch: string }

// worktreeDir is the setting of the same name: relative to the main checkout, no trailing slash.
export function parseWorktrees(porcelain: string, mainPath: string, worktreeDir: string): Worktree[] {
  const prefix = `${mainPath}/${worktreeDir}/`
  const result: Worktree[] = []
  for (const block of porcelain.split(/\n\s*\n/)) {
    const lines = block.split('\n')
    const pathLine = lines.find(line => line.startsWith('worktree '))
    if (!pathLine) continue
    const path = pathLine.slice('worktree '.length)
    if (!path.startsWith(prefix)) continue
    const branchLine = lines.find(line => line.startsWith('branch '))
    const branch = branchLine ? branchLine.slice('branch refs/heads/'.length) : ''
    result.push({ slug: path.slice(prefix.length), path, branch })
  }
  return result
}

export function parseCounts(output: string): { behind: number; ahead: number } {
  const match = output.trim().match(/^(\d+)\s+(\d+)$/)
  if (!match) return { behind: 0, ahead: 0 }
  return { behind: Number(match[1]), ahead: Number(match[2]) }
}

export function parseAgentStatus(sidebarState: string): string {
  const line = sidebarState.split('\n').find(row => row.trim().startsWith('claude_code='))
  if (!line) return ''
  const value = line.trim().slice('claude_code='.length)
  // The value runs until the first key=value pair after it.
  return (value.split(/\s+\w+=/)[0] ?? '').trim()
}

// Titles repeat across projects (two threads may share a slug), so each title keeps every ref.
export function workspaceRefsByTitle(treeJson: string): Map<string, string[]> {
  const refs = new Map<string, string[]>()
  let tree: unknown
  try {
    tree = JSON.parse(treeJson)
  } catch {
    return refs
  }
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk)
      return
    }
    if (node === null || typeof node !== 'object') return
    const record = node as Record<string, unknown>
    if (typeof record.ref === 'string' && record.ref.startsWith('workspace:') && typeof record.title === 'string') {
      refs.set(record.title, [...(refs.get(record.title) ?? []), record.ref])
    }
    Object.values(record).forEach(walk)
  }
  walk(tree)
  return refs
}

export function parseCwd(sidebarState: string): string {
  const line = sidebarState.split('\n').find(row => row.startsWith('cwd='))
  return line ? line.slice('cwd='.length).trim() : ''
}

// Orgs whose repositories require PRs. GitHub org names are case-insensitive.
export function isPrRequiredRemote(url: string, orgs: string[]): boolean {
  const match = /github\.com(?::\d+)?[:/]([^/]+)\//.exec(url)
  if (!match) return false
  const owner = (match[1] ?? '').toLowerCase()
  return orgs.some(org => org.toLowerCase() === owner)
}


export function commits(count: number): string {
  return `${count} commit${count === 1 ? '' : 's'}`
}

type HandOverThread = { slug: string; branch: string; ahead: number; merge: 'clean' | 'conflict' | 'unknown' }

// The pane states facts only. How a thread lands (PR or local merge) is the repository's rule,
// which the main session reads from CLAUDE.md, AGENTS.md and memory. Same text on every machine.
export function handOverPrompt(thread: HandOverThread, base: string, prRequired: boolean): string {
  const facts = [
    `Thread ${thread.slug} is done: branch ${thread.branch}, ${commits(thread.ahead)} ahead of ${base}.`,
    thread.merge === 'conflict' ? 'Merging it into the base would conflict.' : '',
    prRequired ? 'This repository requires PRs.' : '',
    "Land it the way this repository's rules say (CLAUDE.md, AGENTS.md, memory), then clean up the thread.",
  ]
  return facts.filter(Boolean).join(' ')
}

// A session is a thread when its working copy sits in <main>/<worktreeDir>/<slug>.
export function threadSlugOf(top: string, mainPath: string, worktreeDir: string): string {
  if (!top || !mainPath) return ''
  const prefix = `${mainPath}/${worktreeDir}/`
  if (!top.startsWith(prefix)) return ''
  return top.slice(prefix.length).split('/')[0] ?? ''
}

export type Report = {
  slug: string
  branch: string
  ahead: number
  dirty: number
  reason: 'answer' | 'aborted' | 'refusal' | 'error'
  answer: string
}

// cmux agent messages are capped at 32 KiB of UTF-8. The setting reportMaxBytes overrides this.
const DEFAULT_MAX_BYTES = 30_000
const TRUNCATED = '\n[… truncated, the rest is in the thread]'

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length
}

// Cuts at a code point boundary, so a surrogate pair is never split.
function truncateUtf8(text: string, maxBytes: number): string {
  const encoder = new TextEncoder()
  if (encoder.encode(text).length <= maxBytes) return text
  let bytes = 0
  let end = 0
  for (const char of text) {
    const size = encoder.encode(char).length
    if (bytes + size > maxBytes) break
    bytes += size
    end += char.length
  }
  return text.slice(0, end)
}

export function reportText(report: Report, maxBytes = DEFAULT_MAX_BYTES): string {
  const state = [
    `Branch ${report.branch || '(no branch)'}`,
    commits(report.ahead),
    report.dirty > 0 ? `${report.dirty} uncommitted` : 'clean',
  ].join(', ')
  const how =
    report.reason === 'answer' ? 'waiting for input' : report.reason === 'aborted' ? 'aborted' : report.reason === 'refusal' ? 'refused' : 'ended with an error'
  const head = `[Thread ${report.slug}] ${how}. ${state}.\n\n`
  const answer = report.answer.trim() || '(no text answer)'
  if (byteLength(head + answer) <= maxBytes) return head + answer
  const room = maxBytes - byteLength(TRUNCATED)
  // A very long branch name can fill the budget on its own: then the header is cut too.
  if (byteLength(head) >= room) return truncateUtf8(head, room) + TRUNCATED
  return head + truncateUtf8(answer, room - byteLength(head)) + TRUNCATED
}

// `wakemux new` notes the spawning workspace in the worktree's git dir (file `wakemux-parent`).
// Only plain workspace ids or refs pass: the value goes to `cmux agent message` as a target.
export function parseParent(note: string): string {
  const value = note.trim()
  return /^(workspace:\d+|[0-9A-Fa-f-]{36})$/.test(value) ? value : ''
}
