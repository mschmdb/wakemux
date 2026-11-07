# Handover

This file hands the project to the next Claude Code session. It records what exists, what has been decided, what was tested, and what to build next.

Written 2026-11-07. Delete this file, or move the parts that stay true into `docs/`, before the repository goes public. It names the author's local paths and setup.

## Rules for working in this repository

- **English only.** Code, comments, docs, commit messages, issues and PRs are in English. The author talks to you in German; the repository content stays English.
- **Public-repo quality.** Write as if strangers will read every file tomorrow. Clear README, accurate docs, no dead links, no placeholder text.
- **No AI slop.** Plain, specific sentences. No filler, no hype words, no invented facts. If you have not verified something, say so or leave it out. Use the `no-ai-slop` skill for every piece of prose.
- **Codex review on every change.** Run the `codex-review` skill on each diff before you commit or open a PR. Fix confirmed findings with a test where one applies, and give a reason for each finding you reject.
- **Test first.** Write the failing test, then the code. Test edge cases, not only the happy path.
- **Small commits.** One logical change per commit, imperative mood ("Add config loader").
- **Ask before outward actions.** Making the repository public, publishing a release, buying a domain or posting anywhere needs the author's explicit go.

## What wakemux is

wakemux starts side tasks as separate Claude Code sessions ("threads") in cmux. Each thread gets its own git worktree, its own branch and its own cmux workspace inside the project's workspace group. When a thread finishes a turn, wakemux sends its last answer to the main session and wakes that session up. The main session acts as an orchestrator: it answers what the repository rules already settle, escalates decisions to the user, and merges finished threads the way the repository wants (PR or local merge).

The user watches one session. The threads come to it.

## Decisions

Decided by the author on 2026-11-07:

| Topic | Decision |
|---|---|
| Name | `wakemux` |
| Agents | Claude Code only, for both the main session and threads. Codex and other agents are out of scope for the first release. |
| Platform | cmux on macOS only. No tmux or other terminal support. |
| Language | All repository content in English. |
| Account | Personal GitHub account `mschmdb`. Repository starts private. |
| License | MIT |
| Cross-provider review | Optional setting (`crossReview`), off by default, because not every user has a second model provider. |
| Settings taken from prior art | WIP limit (`maxThreads`), PR status per thread, hop limit (`maxHops`), cross-review. |

Recommended but not yet confirmed by the author. Treat these as the default plan and confirm before release:

- English CLI names (`wakemux new`, `wakemux done`); the author keeps the old German command names as local aliases.
- The status pane is optional. Report-back must work without it (see "Risks").
- Register `wakemux.dev` before the name is announced. On 2026-11-07 neither `wakemux.dev` nor `wakemux.com` resolved in DNS. Registration status was not checked with a registrar.

## Current state

Steps 1 and 2 are done: the code below now lives in this repository, translated and renamed (see the next section). The table describes the original local setup, which still runs on the author's machine.

| Part | Path | Role |
|---|---|---|
| Mod `threads` 0.2.0 | `~/.claude/mods/threads/` | Claude Code mod (plugin with a TypeScript module). Status pane with merge and cleanup buttons, and the report-back on every thread turn. Installed as `threads@matze-mods` from the local marketplace `~/.claude/mods/.claude-plugin/marketplace.json`. |
| Skill `thread` | `~/.claude/skills/thread/SKILL.md` | Tells the main session how to start, orchestrate, merge and clean up threads. Written in German. |
| Script `cmux-aufgabe` | `~/.local/bin/cmux-aufgabe` | Bash. Creates the worktree, the branch and the cmux workspace with its layout; `cmux-aufgabe fertig <name>` removes the clean worktree and deletes the branch if it is merged. It does not close the workspace and refuses while processes still use the worktree, so the caller closes the workspace first. |

Mod files:

- `hooks/register.tsx` (332 lines): event handlers. `turn.complete` sends the report, `session.start` registers the `/threads` command and the pane, `ui.render` draws the pane.
- `hooks/parse.ts`: pure functions (parsing cmux output, building the report text). Covered by `hooks/parse.test.ts`.
- `hooks/pane.test.tsx`: pane rendering tests.
- `types/index.d.ts`: snapshot types and plugin state declaration.
- Tests run with `claude plugin test ~/.claude/mods/threads`.

How the parts work together today:

1. The main session follows the skill and runs `cmux-aufgabe <slug> --beschreibung '<one line>' --prompt '<task>'`.
2. The script creates `.claude/worktrees/<slug>` on branch `aufgabe/<slug>`, copies git-ignored files listed in `CMUX_AUFGABE_COPY` (default `.env local.db`), and opens a cmux workspace in the project group. For pnpm projects with a `dev` script, the layout is Claude on the left, a browser on the right, and the dev server on a free port below it.
3. The first thread in a project creates the workspace group: a generated placeholder workspace becomes the group header, the calling workspace is renamed `main` and moved below it. Reason: cmux hides the agent status of a group's anchor workspace.
4. The script stores the calling session's cmux workspace ID (`CMUX_WORKSPACE_ID`) in `<git-dir>/threads-parent`. `parseParent` in `parse.ts` rejects `surface:<n>` references.
5. When a thread's main loop finishes a turn, the mod sends a report (slug, branch, commits ahead, dirty files, the last answer) with `cmux agent message` to the stored parent, or else to the workspace whose working directory is the main checkout. `THREADS_REPORT=0` turns this off.
6. The main session reacts as the skill describes: answer, escalate, merge, clean up.

## Author-specific details to generalize

Done in step 2 (2026-11-07):

- All user-facing text is English (pane, script, skill).
- The "PRs required" organizations come from `WAKEMUX_PR_REQUIRED_ORGS` (space- or comma-separated). The config layer (step 3) replaces the direct environment read.
- The mod calls the bundled `bin/wakemux` through `$.plugin.root`. The skill calls `wakemux` by name, because Claude Code puts a plugin's `bin/` on the Bash tool's `PATH`.
- Script: `wakemux new <name>` and `wakemux done <name>`, options `--from` and `--description`, branch prefix `thread/`, `WAKEMUX_COPY_FILES` (default `.env`), git-dir note `wakemux-parent`. Reports are turned off with `WAKEMUX_REPORT=0`.
- The plugin is named `wakemux`; the skill loads as `/wakemux:thread`.
- The private notes section is not in the skill.

Still open:

- Dev layout supports pnpm only (step 4).
- The author's local install (`~/.claude/mods/threads`, `~/.claude/skills/thread`, `~/.local/bin/cmux-aufgabe`) still runs the old version. Threads started by it use `aufgabe/` branches and the `threads-parent` note, which the new mod does not read. Switch over once no old thread is open.

## Configuration

Implemented in step 3 in `hooks/config.ts` (pure, tested in `hooks/config.test.ts`).

| Key | Default | Valid values | Used by |
|---|---|---|---|
| `worktreeDir` | `.claude/worktrees` | relative path inside the repository | not yet (script, step 4) |
| `branchPrefix` | `thread/` | prefix that forms a valid branch name with a slug | not yet (script, step 4) |
| `copyFiles` | `[".env"]` | relative paths inside the repository | not yet (script, step 4; it reads `WAKEMUX_COPY_FILES` itself today) |
| `devLayout` | `auto` | `auto`, `off` | not yet (script, step 4) |
| `devCommand` | empty (derived from the package manager) | any string | not yet (script, step 4) |
| `report` | `true` | boolean | mod |
| `reportMaxBytes` | `30000` | integer 1000 to 32000; limits the whole message | mod |
| `prRequiredOrgs` | empty | GitHub organization names | mod |
| `mergePolicy` | `repo-rules` | `repo-rules`, `pr`, `merge` | not yet (skill) |
| `scriptPath` | empty (bundled `bin/wakemux`) | absolute path; not settable from `.wakemux.json` | mod |
| `maxThreads` | `4` | integer 0 to 100, `0` means unlimited | not yet (step 5) |
| `maxHops` | `6` | integer 0 to 100 | not yet (step 5) |
| `prStatus` | `true` | boolean | not yet (step 6) |
| `crossReview` | `off` | `off` or a command name (`a-z0-9-`) | not yet (skill) |

Precedence, highest first:

1. Environment variable `WAKEMUX_<KEY>` in upper snake case, for example `WAKEMUX_PR_REQUIRED_ORGS`. Lists are separated by commas or spaces; booleans accept `1/0`, `true/false`, `yes/no`, `on/off`. An empty variable counts as unset.
2. Plugin `userConfig`. The manifest declares only `prRequiredOrgs`, `copyFiles` and `crossReview`, without defaults, so an unset field does not hide the files below. An empty field counts as unset.
3. `.wakemux.json` in the main checkout.
4. `$XDG_CONFIG_HOME/wakemux/config.json`, else `~/.config/wakemux/config.json`.
5. Defaults in code.

An invalid value or an unknown key produces a warning, and the next source down applies. Warnings go to the debug log and appear in the pane. `scriptPath` is user-only because the mod runs that path from a pane button without a permission prompt.

Decisions made in step 3, to confirm before release:

- `language` was dropped: only English exists, and a setting with one value adds nothing.
- `mergePolicy` values `pr` and `merge` are defined but not used yet.

Open: whether `userConfig` shows its dialog when the plugin is loaded with `--plugin-dir` or from a skills directory. Not tested. That is why the file and environment paths exist. The script and the skill do not read the configuration yet; step 4 has to give the script the same precedence, or have the mod pass resolved values.

Detecting "this repository requires PRs", in order:

1. The repository rules (CLAUDE.md, AGENTS.md) say so.
2. The remote matches `prRequiredOrgs`.
3. `gh api repos/<owner>/<repo>/branches/<base>/protection` reports protection. This needs permissions; an error counts as "unknown", not as "free".
4. Otherwise the main session asks the user.

## Report-back: verified behavior

Everything in this section was tested on 2026-11-07 on the author's MacBook with cmux 0.65.2, Claude Code 2.1.319 and codex-cli 0.164.0, unless marked otherwise.

### How cmux wakes a Claude Code session

The cmux Claude wrapper adds an async hook with `asyncRewake: true` on `SessionStart`, `Stop` and `StopFailure`. It runs `cmux hooks claude inbox-wait` (timeout 86400 s), which polls for messages about every 2 seconds and wakes the idle session. A busy session gets the message at its next step. If no poller is running, a message waits until the user's next prompt (`delivered_via: claude.prompt-submit`). See [docs/agent-messages.md](https://github.com/manaflow-ai/cmux/blob/main/docs/agent-messages.md) in the cmux repository.

Tests with a fresh test session:

- Message after 30 s idle: woke the session in under 1 s (`claude.wake`).
- Message after 10 min idle: woke it in 1.4 s. Long idle time does not break the poller.
- Poller process killed by hand: the message stayed `queued`. This reproduces the failure below.

### Failure seen in real use

One long-running main session (started with `claude --continue`) was never woken by a thread report. All 12 reports that day arrived only with the user's next prompt, some about 12 minutes late. That session had no `inbox-wait` process although its hook settings contained it. Its entry in `~/.claude/sessions/<pid>.json` had not been updated since one minute after start, and Claude Code's `ListAgents` did not list it, so `SendMessage` to it failed with "not reachable". Likely cause: background parts of that one session stopped shortly after start. Not confirmed. A restart of that session is the next test.

### SendMessage as fallback

`SendMessage` (Claude Code cross-session messaging) is a model tool. Claude Code 2.1.319 has no CLI command to send one, so a hook or script cannot call it directly.

Test: with the test session's poller killed, a `SendMessage` from another session woke it at once. The queued cmux message arrived in the same turn, and after that turn a new `inbox-wait` poller was running again.

Planned design:

1. The thread sends its report with `cmux agent message`, as today.
2. After about 15 s the sender checks the message state (`cmux agent inbox --json`).
3. If it is still `queued`, the sender wakes the thread itself with a cmux message (threads woke reliably in every test) and asks it to forward the report with `SendMessage` to the main session.
4. If the main session is not reachable either, send a desktop notification to the user (`cmux notify`).

To make step 3 work, `wakemux new` stores the main session's `ListAgents` name next to the parent workspace ID.

### cmux events and automations

Not needed for a Claude-only release. Recorded here because they are the path for other agents and a fallback if the mod API goes away.

- `cmux hooks setup` installs hooks for about 20 agents. cmux turns them into events such as `agent.hook.Stop` with `workspace_id`, `surface_id` and `_source`. `cmux events` streams them.
- Rules in `~/.cmuxterm/automations.json` can match `agent.hook.Stop` and run a shell command. The event arrives in `CMUX_AUTOMATION_EVENT_JSON`. Confirmed live and in the cmux tests (`cmuxTests/AutomationRuleTests.swift`).
- Every hook arrives twice, with `phase: received` and `phase: completed`. Filter with `"where": { "phase": "completed" }`.
- One Claude turn end produced two Stop pairs within 25 ms. Deduplicate per surface and turn.
- cmux redacts `tool_input`, `context` and `extra_fields`. The event does not contain the answer. `cmux capture-pane` returns the screen text, including the TUI frame, status line and hints, with hard line breaks.
- `run` actions get a minimal `PATH` (`/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`) without `cmux`. Call `/Applications/cmux.app/Contents/Resources/bin/cmux` or resolve the path at install time.
- Three parallel turn ends within about 2 s all fired with `rate_limit.maximum` set to 20. The default limit is one firing per second per rule.
- Codex: hooks from `cmux hooks codex install` produce Stop events, but a Codex session started earlier reported `surface_id: null` (workspace id was set). The cmux docs say an idle Codex session cannot be woken, and sessions with hooks from `cmux hooks codex install` instead of the launch wrapper do not receive messages yet.
- `~/.cmuxterm/automations.json` is global per user. An installer must merge into it, never overwrite it.

## Installation design

Two equal paths, documented with the same weight.

With a marketplace:

```
/plugin marketplace add mschmdb/wakemux
/plugin install wakemux@wakemux
```

The script lives in the plugin under `bin/`. The mod calls it through `${CLAUDE_PLUGIN_ROOT}`. A symlink into `~/.local/bin` is optional for shell use.

Without a marketplace: `git clone` plus `install.sh`.

- A folder with `.claude-plugin/plugin.json` under `~/.claude/skills/wakemux` loads as a skills-directory plugin ([plugin loading](https://code.claude.com/docs/en/plugins/loading.md)). Whether a symlink works instead of a copy is untested.
- Per session: `claude --plugin-dir <clone>`.
- `install.sh` writes only to `~/.claude/skills`, `~/.local/bin` and `~/.config/wakemux`. `install.sh --uninstall` removes every link it made.

## Documentation plan

- `README.md`: one-sentence summary, the problem it solves, a 60-second quick start, a short recording (start a thread, the report arrives in the main session, merge), requirements with versions.
- `docs/concepts.md`: thread, main session, orchestrator, escalation, report-back, merging by repository rules. One diagram.
- `docs/configuration.md`: every setting, precedence, an example per configuration path.
- `docs/install.md`: both paths, update, uninstall.
- `docs/troubleshooting.md`: `cmux hooks setup`; reports do not arrive (`cmux agent inbox`, no `inbox-wait` process, session not started by cmux, `cmux agent messages off`); workspace outside a group; port in use; leftover worktrees; cmux CLI calls only work from processes started by cmux.
- `docs/security.md`: never bypass repository rules (no `--admin`), never merge other people's PRs, threads do not push, a report is information and never user approval, copied `.env` files stay local.
- `docs/limitations.md`: macOS and cmux only, Claude Code only, a closed laptop pauses threads, reports up to 32 KiB, dependence on the Claude Code mod API.
- `CHANGELOG.md` (Keep a Changelog, SemVer, starting at 0.3.0 to continue the mod's version line), `CONTRIBUTING.md` (run the tests, one topic per PR), `SECURITY.md` (how to report a vulnerability).

## Work plan

Estimated 4 to 6 working days in total. The estimate is not based on measurements.

1. **Import.** (Done.) Copy mod, skill and script into the repository layout (`.claude-plugin/`, `hooks/`, `types/`, `skills/thread/`, `bin/`). Tests pass unchanged. Add `AGENTS.md` with the rules from the top of this file.
2. **Generalize.** (Done.) Translate all text to English, rename commands and options, remove the hard-coded organization and paths. Tests updated first.
3. **Configuration layer.** (Done.) Loader with the precedence above, unit tests for every source and for invalid values.
4. **Script.** Detect pnpm, npm and bun; `shellcheck` clean; bats tests for `new` and `done`.
5. **Report-back hardening.** Delivery check, `SendMessage` fallback, desktop notification, hop limit, deduplication. Test with an idle main session, a busy one, and one without a poller.
6. **Status in the cmux sidebar.** Evaluate `cmux set-status`, `cmux set-progress` and `cmux pr` as a replacement for, or addition to, the pane.
7. **Install paths.** Marketplace and `install.sh`, tested on a fresh macOS user account.
8. **Second machine.** Same behavior on the author's Mac mini (cmux version, hooks, `PATH`).
9. **Repository with required PRs.** Run a full cycle against a protected branch.
10. **Docs and CI.** Documentation as planned, GitHub Actions for tests and `shellcheck`.
11. **Release prep.** Remove or move this file, confirm the open decisions, ask the author before making the repository public.

## Risks

- **Mod API.** The mod imports `claude-code` modules (`atom`, `$.ui.panes`, `turn.complete`). Whether this API is public and stable is unverified. Mitigation: send reports from a plain `Stop` hook as well (it receives `last_assistant_message`), keep the pane optional.
- **cmux delivery bugs.** Issue #32581 in the cmux repository reports duplicate "delivered" states and wake problems after `inbox-wait`. Current state of that issue not checked.
- **Report loops.** The main session answers, the thread answers back. The skill says "do not answer acknowledgements"; `maxHops` adds a hard stop.
- **Overlap with cmux and Claude Code.** cmux is building an orchestrator ("Chief", nightly builds only so far). Claude Code's agent view and cross-session messaging grow in the same direction.
- **Maintenance.** The author prefers to build tools, not maintain them long term. The README must state the maintenance status honestly.
- **Data.** The script copies `.env` files into worktrees. The docs must say so.

## Prior art

Checked on 2026-11-07. Feature descriptions come from READMEs and docs, not from source code.

- **[demoatworkstream/cmux-threads-public](https://github.com/demoatworkstream/cmux-threads-public)** is the closest project (MIT, created 2026-10-27, 0 stars). A root session starts one Claude Code session per task in a cmux tab, marks tabs with status, collects questions as a numbered list and forwards answers. It adds a master level across projects and Codex threads. Differences: its threads do not notify the root ("Threads don't ping the root"); the root reads tabs when asked or on a schedule. Threads run with `--dangerously-skip-permissions`. No merging by repository rules, no workspace groups, no dev layout. Read its `SKILL.md` and `agents/` before building features it already solves well.
- **[mblode/captain](https://github.com/mblode/captain)**: task list driven from chat, one agent per task in a cmux worktree, merge gate (CI, verifier, cross-vendor review) wired in. Source of the WIP limit and cross-review settings.
- **Claude Code agent view** (`claude --bg`): status list, PR status per row, peek and reply. Own TUI, the user orchestrates.
- **cmux Chief**: orchestrator chat inside cmux, nightly only. Its issue tracker shows ping-pong loops without a hop limit, which is why `maxHops` exists.

Unique to wakemux as far as the search went: a report on every turn that wakes the main session, a main session that orchestrates with explicit escalation rules, merging by each repository's own rules, and cmux workspace groups with a dev layout. The search was not exhaustive.

## State of the author's machine

Left over from the 2026-11-07 tests. Clean up or keep on purpose:

- `~/.cmuxterm/automations.json` contains two disabled probe rules (`threads-probe`, `threads-probe-capture`). The file did not exist before the tests.
- Codex hooks from `cmux hooks codex install` are installed (`~/.codex/hooks.json`, additions in `~/.codex/config.toml`). Remove with `cmux hooks codex uninstall` if not wanted.
- Test output in `/tmp/cmux-threads-probe.jsonl`, `/tmp/cmux-probe-capture/` and `/tmp/cmux-probe-capture.sh`.

## References

- cmux docs: [agent messages](https://github.com/manaflow-ai/cmux/blob/main/docs/agent-messages.md), [events](https://github.com/manaflow-ai/cmux/blob/main/docs/events.md), [automations](https://github.com/manaflow-ai/cmux/blob/main/docs/automations.md), [workspace groups](https://github.com/manaflow-ai/cmux/blob/main/docs/workspace-groups.md)
- Claude Code docs: [plugins reference](https://code.claude.com/docs/en/plugins-reference), [worktrees](https://code.claude.com/docs/en/worktrees), [cross-session messaging](https://code.claude.com/docs/en/cross-session-messaging), [agent view](https://code.claude.com/docs/en/agent-view)
- The author's private notes hold the full market comparison and test log. They are not part of this repository.
