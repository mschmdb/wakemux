// Pure parsers for git and cmux output, kept apart from the hooks so they can be tested alone.

export type Worktree = { slug: string; path: string; branch: string }

const THREADS_DIR = '/.claude/worktrees/'

export function parseWorktrees(porcelain: string, mainPath: string): Worktree[] {
  const prefix = mainPath + THREADS_DIR
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
  const owner = match[1].toLowerCase()
  return orgs.some(org => org.toLowerCase() === owner)
}

export function parseOrgList(value: string): string[] {
  return value.split(/[\s,]+/).filter(Boolean)
}

type HandOverThread = { slug: string; branch: string; ahead: number; merge: 'clean' | 'conflict' | 'unknown' }

// The pane states facts only. How a thread lands (PR or local merge) is the repo's rule,
// which the main session reads from CLAUDE.md and memory. Same text on every machine.
export function handOverPrompt(thread: HandOverThread, base: string, prRequired: boolean): string {
  const facts = [
    `Thread ${thread.slug} ist fertig: Branch ${thread.branch}, ${thread.ahead} Commits vor ${base}.`,
    thread.merge === 'conflict' ? 'Ein Merge in die Basis hätte Konflikte.' : '',
    prRequired ? 'Dieses Repo verlangt PRs.' : '',
    'Bring ihn auf dem Weg rein, den die Regeln dieses Repos vorsehen (CLAUDE.md, Memory), und räum den Thread danach auf.',
  ]
  return facts.filter(Boolean).join(' ')
}

// A session is a thread when its working copy sits in <main>/.claude/worktrees/<slug>.
export function threadSlugOf(top: string, mainPath: string): string {
  if (!top || !mainPath) return ''
  const prefix = mainPath + THREADS_DIR
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

// cmux agent messages are capped at 32 KiB; keep headroom for the header.
const ANSWER_LIMIT = 24_000

export function reportText(report: Report): string {
  const state = [
    `Branch ${report.branch || 'ohne Branch'}`,
    `${report.ahead} Commits`,
    report.dirty > 0 ? `${report.dirty} uncommittet` : 'sauber',
  ].join(', ')
  const how =
    report.reason === 'answer' ? 'wartet auf Eingabe' : report.reason === 'aborted' ? 'abgebrochen' : report.reason === 'refusal' ? 'verweigert' : 'mit Fehler beendet'
  let answer = report.answer.trim()
  if (answer.length > ANSWER_LIMIT) answer = answer.slice(0, ANSWER_LIMIT) + '\n[… gekürzt, Rest im Thread]'
  return [`[Thread ${report.slug}] ${how}. ${state}.`, answer || '(keine Textantwort)'].join('\n\n')
}

// cmux-aufgabe notes the spawning workspace in the worktree's git dir (file `threads-parent`).
// Only plain workspace ids or refs pass: the value goes to `cmux agent message` as a target.
export function parseParent(note: string): string {
  const value = note.trim()
  return /^(workspace:\d+|[0-9A-Fa-f-]{36})$/.test(value) ? value : ''
}
