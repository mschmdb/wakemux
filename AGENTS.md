# Agent instructions

Rules for AI coding agents working in this repository. Human contributors follow the same rules.

## Rules

- **English only.** Code, comments, docs, commit messages, issues and PRs are in English, even when the author talks to you in another language.
- **Public-repo quality.** Write as if strangers will read every file tomorrow. No dead links, no placeholder text.
- **Plain prose.** Short, specific sentences. No filler, no hype words, no invented facts. If you have not verified something, say so or leave it out.
- **Cross-provider review on every change.** Have a second model provider review each diff before you commit or open a PR (the author uses the `codex-review` skill). Fix confirmed findings, with a test where one applies, and give a reason for each finding you reject.
- **Test first.** Write the failing test, then the code. Test edge cases, not only the happy path.
- **Small commits.** One logical change per commit, imperative mood ("Add config loader").
- **Ask before outward actions.** Making the repository public, publishing a release, buying a domain or posting anywhere needs the author's explicit go.

## Layout

| Path | Contents |
|---|---|
| `.claude-plugin/plugin.json` | Plugin manifest. |
| `hooks/` | The Claude Code mod: `register.tsx` (event handlers, status pane, report-back), `parse.ts` (pure functions) and their tests. |
| `types/` | Snapshot types and the plugin state declaration. |
| `skills/setup/SKILL.md` | Installs from a clone, runs `wakemux doctor`, writes the user's settings. Loads as `/wakemux:setup`; also read straight from a clone before install. |
| `skills/thread/SKILL.md` | Instructions for the main session: start, orchestrate, merge and clean up threads. Loads as `/wakemux:thread`. |
| `bin/wakemux` | Shell script. `new` creates the worktree, the branch and the cmux workspace; `done` removes the worktree and, if merged, the branch (the caller closes the workspace first). Claude Code puts `bin/` on the Bash tool's `PATH` while the plugin is enabled. |
| `tests/` | bats tests for `bin/wakemux` and `install.sh`. |
| `install.sh` | Install from a clone: links into the Claude Code skills folder and `~/.local/bin`. |
| `.claude-plugin/marketplace.json` | Lets the repository act as its own marketplace. |

## Tests

```sh
claude plugin test .   # mod
bats tests              # script (brew install bats-core)
shellcheck bin/wakemux install.sh
```

Type check: load the plugin once with `claude --plugin-dir .` so Claude Code writes `.claude-plugin/types/`, then run `pnpm dlx --package=typescript@5 tsc -p .`.

A local `HANDOVER.md` (git-ignored, not in the repository) may hold the current state and the work plan. Read it first if it exists.
