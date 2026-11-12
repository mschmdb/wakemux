# Changelog

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions follow [Semantic Versioning](https://semver.org/). The version line continues from the author's private `threads` mod, which ended at 0.2.0.

## [Unreleased]

### Added

- Quiet turns: a thread turn whose answer starts with `[quiet]` sends no report and does not count toward the hop limit. With it, a loop such as a watcher that checks PRs every 30 minutes can run as a thread: ticks without news no longer wake the main session, and the loop no longer hits the hop limit after a few hours. The `thread` skill describes how to start such a loop.

### Fixed

- A report that reached a busy main session in the middle of its turn could go unanswered: the session finished what it was doing and passed over it. When a turn ends, the session now checks its cmux inbox for thread reports that arrived during the turn and sends itself one reminder that lists them.

## [0.3.3] - 2026-11-09

### Fixed

- A main session that worked inside a thread's worktree started to send that thread's reports to itself, after every turn, until the hop limit ([#10](https://github.com/mschmdb/wakemux/issues/10)). A session now counts as a thread only if it started in the worktree, decided on every turn. A thread reads its state from its worktree even after its shell moved elsewhere, and a session never reports to itself.

## [0.3.2] - 2026-11-09

### Changed

- A thread started for another repository joins the calling workspace's workspace group, so it sits next to the session it reports to. Before, it went to that repository's group or opened ungrouped.

### Fixed

- A thread whose worktree switched to another branch sent no report and lost its pill, for the rest of its session ([#7](https://github.com/mschmdb/wakemux/issues/7)). A worktree now counts as a thread while its branch `thread/<slug>` exists. The report names both branches, the pane keeps the thread and its hand-over asks which branch to land, and `maxThreads` counts it.

## [0.3.1] - 2026-11-08

### Fixed

- `wakemux new` failed now and then with "Socket closed before reply" when `--prompt` held a few thousand characters. cmux drops large requests at random. The script now writes the prompt to `wakemux-prompt` in the worktree's Git folder, and the new terminal reads and deletes it.

## [0.3.0] - 2026-11-07

First public version.

### Added

- Plugin `wakemux` with the skills `wakemux:thread` and `wakemux:setup`.
- `wakemux new`, `done`, `config` and `doctor`.
- Settings from `WAKEMUX_<KEY>` variables, plugin options, `.wakemux.json` and `~/.config/wakemux/config.json`, with validation and warnings.
- Dev layout for pnpm, npm and bun projects; `devCommand` for anything else.
- Report-back fallbacks: Claude Code cross-session messaging after 15 seconds, then a desktop notification.
- Hop limit (`maxHops`) and duplicate suppression for reports.
- A sidebar pill per thread with commits ahead, uncommitted changes and errors.
- Limit on open threads (`maxThreads`), safe for parallel starts.
- Install from a clone with `install.sh`, or from the repository as a marketplace. Uninstall with `--purge` restores backed-up files.
- Documentation in `docs/`.

### Changed

- All text is in English. The script is `wakemux` (was `cmux-aufgabe`), branches use `thread/` (was `aufgabe/`), and the pane command is `/wakemux` (was `/threads`).
- Reports are capped by UTF-8 bytes, not characters.

### Fixed

- `wakemux done` refuses a detached HEAD with commits no branch holds.
- A process in a worktree with a longer name no longer blocks `wakemux done`.
- `.git/info/exclude` is found from any directory.
- Copying never writes through a symlink, never overwrites a file in the worktree, and skips files the thread's branch does not ignore.

[Unreleased]: https://github.com/mschmdb/wakemux/compare/v0.3.3...HEAD
[0.3.3]: https://github.com/mschmdb/wakemux/compare/v0.3.2...v0.3.3
[0.3.2]: https://github.com/mschmdb/wakemux/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/mschmdb/wakemux/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/mschmdb/wakemux/releases/tag/v0.3.0
