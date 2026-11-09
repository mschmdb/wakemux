export type MergeState = 'clean' | 'conflict' | 'unknown'

export type ThreadRow = {
  slug: string
  branch: string
  // The branch the worktree has checked out; differs from branch when the thread switched.
  head: string
  path: string
  ahead: number
  behind: number
  dirty: number
  merge: MergeState
  agent: string
  workspaceRef: string
}

export type Snapshot = {
  repo: string
  base: string
  prRequired: boolean
  baseDirty: number
  threads: ThreadRow[]
  updatedAt: number
  error: string
  warnings: string[]
}

declare module 'claude-code' {
  interface PluginState {
    wakemux: {
      snapshot: Shaped<Snapshot>
      confirm: Shaped<string>
      message: Shaped<string>
      hops: Shaped<{ head: string; count: number }>
      lastReport: Shaped<{ key: string; at: number }>
    }
  }
}
