# Concepts

wakemux runs side tasks as separate Claude Code sessions next to your main session. You keep talking to the main session. The side sessions report back to it on their own.

```
  you
   │
   ▼
 main session  ◄──── report after every turn ────┐
 (main checkout)                                 │
   │  wakemux new <slug>                         │
   ▼                                             │
 thread session ─────────────────────────────────┘
 (own worktree, own branch, own cmux workspace)
```

## Thread

A thread is one side task. `wakemux new <slug>` creates:

- a git worktree, by default under `.claude/worktrees/<slug>`
- a branch, by default `thread/<slug>`, starting at the main checkout's current branch or at `--from <ref>`
- a cmux workspace in the project's workspace group, with Claude Code started in the worktree and given the first prompt

Projects with a `dev` script and pnpm, npm or bun also get a browser and the dev server on a free port next to Claude.

Threads commit on their own branch. They do not push, open PRs or merge: the skill tells the main session to put these rules in each thread's first prompt. The script does not enforce them.

A session reports as a thread only if it started in the thread's worktree. Another session that `cd`s into the worktree, such as the main session reviewing it, does not. A worktree counts while its branch `thread/<slug>` exists, even if the session switched to another branch, for example to fix a PR. Reports then name both branches, and the pane's hand-over asks which one to land. Worktrees from `claude --worktree` in the same folder have no thread branch and stay out.

## Main session

The session you started the thread from, usually the one in the main checkout. In cmux the first thread turns the calling workspace into `main` below a new workspace group for the project. The group header is a separate workspace, because cmux does not show the agent status of a group's header.

A session can also start threads for another repository, for example a notes repository that orchestrates work in a project. Those threads join the calling workspace's group, next to the session they report to. If the calling workspace has no group, they go to the project's group, or open ungrouped when the project has none.

## Report-back

When a thread's main loop finishes a turn, the wakemux mod in that thread sends a report: the slug, the branch, commits ahead of the base, the number of uncommitted changes, and the thread's last answer. It goes to the session that started the thread, or else to the main checkout's session.

Delivery uses three channels in order:

1. `cmux agent message`. cmux wakes an idle Claude Code session within seconds; a busy one reads the message at its next step.
2. If cmux has not delivered the message after 15 seconds, the mod sends the report through Claude Code's cross-session messaging to the parent session. This needs the parent's session id, which `wakemux new` stores when the parent runs the wakemux mod.
3. If that fails or no session id is stored, cmux shows a desktop notification.

A report identical to the one before it within 60 seconds is not sent again.

## Orchestrator

The main session reads each report and decides, following the `thread` skill:

- **Answer** what the issue, the repository rules (CLAUDE.md, AGENTS.md, memory) or an earlier decision of yours already settle.
- **Escalate** to you anything about taste, new data or content, cost, permissions, deploys or other people's PRs. It collects questions and asks them together. The affected thread waits; the others keep running.
- **Land** finished threads the way the repository's rules say: a PR or a local merge.
- **Clean up** a thread after it has landed, when the rules allow it.

## Hop limit

A thread and the main session can answer each other in circles. wakemux counts reports in a row on the same commit. The report number `maxHops` (default 6) asks the main session to stop answering and ask you. The next report becomes a desktop notification instead, and after that the thread stops reporting until it commits again.

## Status

Each thread shows a pill in the cmux sidebar, updated when a turn ends (except for a duplicate report): commits ahead, uncommitted changes, errors, or paused reports. The optional `/wakemux` pane in the main session lists all threads with buttons to open a workspace, hand a finished thread to Claude for landing, and clean up.
