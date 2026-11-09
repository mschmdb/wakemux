// Pure parsers for git and cmux output, kept apart from the hooks so they can be tested alone.

// branch is the thread's own branch, head the branch its worktree has checked out ('' when detached).
export type Worktree = { slug: string; path: string; branch: string; head: string }

// A thread is on a branch named branchPrefix + slug. Worktrees from `claude --worktree` share the
// folder but use branches of their own, and are no threads.
export function isThreadBranch(branch: string, branchPrefix: string): boolean {
  return branch.startsWith(branchPrefix) && branch.length > branchPrefix.length
}

// worktreeDir and branchPrefix are the settings of the same names. threadBranches lists the
// repository's branches under branchPrefix: a thread stays a thread when its worktree switches to
// another branch, while a `claude --worktree` worktree in the same folder has no thread branch.
export function parseWorktrees(
  porcelain: string,
  mainPath: string,
  worktreeDir: string,
  branchPrefix: string,
  threadBranches: readonly string[] = [],
): Worktree[] {
  const prefix = `${mainPath}/${worktreeDir}/`
  const result: Worktree[] = []
  for (const block of porcelain.split(/\n\s*\n/)) {
    const lines = block.split('\n')
    const pathLine = lines.find(line => line.startsWith('worktree '))
    if (!pathLine) continue
    const path = pathLine.slice('worktree '.length)
    if (!path.startsWith(prefix)) continue
    const branchLine = lines.find(line => line.startsWith('branch '))
    const head = branchLine ? branchLine.slice('branch refs/heads/'.length) : ''
    const slug = path.slice(prefix.length)
    // The thread's own branch is what lands; HEAD only says where the session works right now.
    if (threadBranches.includes(branchPrefix + slug)) result.push({ slug, path, branch: branchPrefix + slug, head })
    else if (isThreadBranch(head, branchPrefix)) result.push({ slug, path, branch: head, head })
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

// The ref of the workspace with this id (CMUX_WORKSPACE_ID); cmux prints ids in upper case.
export function workspaceRefOfId(treeJson: string, id: string): string {
  if (!id) return ''
  let tree: unknown
  try {
    tree = JSON.parse(treeJson)
  } catch {
    return ''
  }
  const wanted = id.toUpperCase()
  const walk = (node: unknown): string => {
    if (Array.isArray(node)) {
      for (const child of node) {
        const found = walk(child)
        if (found) return found
      }
      return ''
    }
    if (node === null || typeof node !== 'object') return ''
    const record = node as Record<string, unknown>
    if (typeof record.ref === 'string' && record.ref.startsWith('workspace:') && typeof record.id === 'string' && record.id.toUpperCase() === wanted) {
      return record.ref
    }
    return walk(Object.values(record))
  }
  return walk(tree)
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

type HandOverThread = { slug: string; branch: string; head: string; ahead: number; merge: 'clean' | 'conflict' | 'unknown' }

// The pane's hand-over button submits this prompt. It says that the user pressed the button, so the
// main session takes it as the user's request. How the thread lands is the repository's rule.
export function handOverPrompt(
  thread: HandOverThread,
  base: string,
  repo: { prRequired: boolean; hasRemote: boolean },
): string {
  const fallback = repo.hasRemote
    ? 'If they say nothing, ask the user once whether to open a PR or merge locally.'
    : `If they say nothing: the repository has no remote, so merge it locally in the main checkout with git merge --no-ff ${thread.branch}.`
  const facts = [
    `The user pressed "Hand over & clean up" in the wakemux pane. This prompt is their request to land thread ${thread.slug} and clean it up.`,
    `Branch ${thread.branch}, ${commits(thread.ahead)} ahead of ${base}.`,
    thread.head !== thread.branch
      ? `The worktree is checked out on ${thread.head || 'a detached HEAD'}, not on ${thread.branch}. Ask the user which branch to land.`
      : '',
    thread.merge === 'conflict' ? 'Merging it into the base would conflict.' : '',
    repo.prRequired ? 'This repository requires PRs.' : '',
    "Land it the way this repository's rules say (CLAUDE.md, AGENTS.md, memory).",
    fallback,
    `Then close the thread's workspace and run wakemux done ${thread.slug}.`,
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
  // The thread's own branch; the report says so when the session works on another one.
  threadBranch?: string
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
    `Branch ${report.branch || '(no branch)'}` +
      (report.threadBranch && report.branch !== report.threadBranch ? `, not its own ${report.threadBranch}` : ''),
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
