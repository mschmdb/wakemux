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
| `skills/wakemux/SKILL.md` | Instructions for the main session: start, orchestrate, merge and clean up threads. |
| `bin/` | Shell script that creates and removes worktrees, branches and cmux workspaces. |

## Tests

```sh
claude plugin test .
```

[HANDOVER.md](HANDOVER.md) describes the current state and the work plan.
