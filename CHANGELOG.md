# Changelog

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versions follow [Semantic Versioning](https://semver.org/). The version line continues from the author's private `threads` mod, which ended at 0.2.0.

## [Unreleased]

First public version, planned as 0.3.0.

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
