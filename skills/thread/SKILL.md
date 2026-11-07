---
name: thread
description: Starts a side task as its own Claude Code session ("thread") in cmux, with its own git worktree and its own workspace in the project's sidebar group, and orchestrates the reports that threads send back. Use it when the user wants a task done in parallel, on the side or separately, or when you spot an independent side task and the user agrees. Triggers - "do this as a thread", "new thread", "in parallel", "on the side", "in its own worktree", "spawn", "fork this off", "clean up the thread", "the thread is done". Only inside cmux (CMUX_WORKSPACE_ID is set) and in a git repository.
---

# Threads in cmux

A thread is its own workspace in the project's cmux workspace group. It has its own worktree under `.claude/worktrees/<slug>` on branch `thread/<slug>` (both configurable, see `wakemux --help`) and its own Claude session. In projects with a `dev` script and pnpm, npm or bun, a browser and the dev server run next to it on a free port.

## Start

1. Check `echo $CMUX_WORKSPACE_ID`. Empty means you are not in cmux. Say so and stop.
2. Pick a slug: 2 to 4 words, kebab-case, only `a-z0-9-`, for example `filter-bug`.
3. Write a self-contained first prompt. The new session does not know this conversation. Name the goal, the files involved, known facts, acceptance criteria, and "Commit on your branch. Do not push, do not merge."
4. Start it from the repository:
   ```sh
   wakemux new <slug> --description '<one line>' --prompt '<first prompt>'
   ```
   The description appears under the thread name in the sidebar: at most 6 words saying what the thread does, for example "Design system on remaining pages".
   Add `--from <branch>` if the user wants another base. The default is the current branch of the main checkout.
   If it refuses because too many threads are open (setting `maxThreads`, default 4), tell the user which threads are open and ask which one to land or clean up first. Do not raise the limit yourself.
5. Answer in one line: thread name, branch, port. Focus stays here; the user switches when cmux signals.

Each thread shows its state as a pill in the cmux sidebar: commits ahead, uncommitted changes, errors, or paused reports.

For several threads at once, run one command per task.

## Clean up

Only when the user asks for it ("thread X is done", "clean up X").

1. Check with `git -C <worktree> status --short` that everything is committed (`git worktree list` shows the path). If not, say so and stop.
2. Close the workspace: `CMUX_QUIET=1 cmux close-workspace --workspace <ref> --force`. `cmux tree --all` lists the ref; the workspace name is the slug.
3. `wakemux done <slug>` removes the worktree and the branch. An unmerged branch stays; tell the user. If it refuses because of a detached HEAD, ask the user before you touch those commits.

## Orchestrate

Threads report on their own. At the end of every thread turn, the wakemux mod sends the thread's last answer with `cmux agent message` to the session that started the thread (`wakemux new` stores it in `<git-dir>/wakemux-parent`), or else to the main checkout's session. It arrives as a message from `[Thread <slug>]` and wakes the main session, even when it is idle. To turn reports off on a machine, set `WAKEMUX_REPORT=0`.

The main session then acts as the orchestrator. The user should only have to watch this session.

If cmux does not pick a report up within 15 seconds, the mod forwards it through Claude Code to this session; that copy ends with "answer once", and the same report may arrive again from cmux later. Answer it once. If neither channel works, the user gets a desktop notification instead.

A report that ends with `[wakemux] N reports in a row without a new commit` means the thread and this session are going back and forth without progress (setting `maxHops`, default 6). Do not answer the thread. Tell the user what the thread wants and ask how to go on. After one more report the mod stops reporting until the thread commits, and the user gets a desktop notification.

1. **Read:** Is the thread done, does it ask something, or does it only report progress? Acknowledgements need no answer.
2. **Answer yourself** what the issue, the repository rules (CLAUDE.md, AGENTS.md, memory) or an earlier decision of the user already settle. Reply to the thread with `SendMessage` to its session name (`ListAgents`, the name starts with the slug) or with `cmux agent message <workspace> "<text>"`.
3. **Escalate to the user** anything about taste, new data or content decisions, cost, permissions, deploys or other people's PRs. Collect the questions and present them together. The affected thread waits; the others keep running.
4. **Land finished threads** the way the repository's rules say: whether it uses PRs or local merges is in CLAUDE.md, AGENTS.md or memory, not in this skill. Check CI before merging (the exit code of `gh pr checks`, without a pipe). After you open a PR for a thread, run `cmux pr <url> --workspace <thread workspace ref>` in the main checkout if `wakemux config prStatus` prints `true`, so the thread's sidebar entry shows the PR status. Then clean up the thread if the rules allow it.
5. **Start the next step** when the plan in the issue calls for it (for example the next wave as new threads). Do not let threads push or open PRs; the main session does that in the planned order.
6. **Report briefly:** one or two sentences to the user per event. Put what is open and needs the user first.

Limits: never work around a repository rule (for example branch protection with `--admin`). If something is blocked, stop and ask the user.

## Merge back

Only when the user asks for it ("merge thread X", "merge X back"). It runs in the main checkout, not in the thread: the target branch is checked out there, and a worktree cannot check it out.

1. Check that the thread worktree and the main checkout are clean (`git status --short`). If not, say so and stop.
2. In the main checkout: `git merge --no-ff <branch>` (default `thread/<slug>`). On conflicts: `git merge --abort`, name the conflicting files, stop.
3. Clean up afterwards if the user asks (see above). "Merge and clean up" means both.

If a thread is asked in its own workspace to merge, it answers that the merge runs in the project's main workspace, and offers `git rebase <target branch>` in the thread in case the target branch has moved on.

Pushing and PRs are not part of a local merge back. Whether a repository uses PRs is in its rules (see Orchestrate).
