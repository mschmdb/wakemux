# wakemux

Run side tasks as separate Claude Code sessions in [cmux](https://cmux.dev), each in its own git worktree. When a thread finishes a turn, it reports back to your main session and wakes it up. You watch one session instead of five.

**Status: pre-release.** Installable and tested by the author; not announced yet.

**Maintenance:** I build wakemux for my own work and fix what breaks for me. Issues and PRs are welcome, but I make no promises about response times or new features.

## How it works

1. You ask your main Claude Code session to do something "as a thread".
2. `wakemux new <slug>` creates a git worktree on branch `thread/<slug>` and opens a cmux workspace with a new Claude Code session in it. Projects with a `dev` script and pnpm, npm or bun also get a browser and the dev server on a free port.
3. When the thread finishes a turn, it sends its answer to the main session. cmux wakes the main session if it is idle. If that does not work, wakemux tries Claude Code's own messaging and then a desktop notification ([details](docs/concepts.md#report-back)).
4. The main session answers what your repository rules already settle, asks you about the rest, and lands finished threads the way your repository wants: a PR or a local merge.
5. `wakemux done <slug>` removes the worktree and the merged branch.

Each thread shows its state as a pill in the cmux sidebar. The optional `/wakemux` pane lists all threads with buttons to open, hand over and clean up.

## Requirements

- macOS with [cmux](https://cmux.dev). Developed with cmux 0.65.2.
- [Claude Code](https://code.claude.com). Developed with 2.1.319.
- `git`, `python3` and `lsof`.

## Install

```sh
claude plugin marketplace add mschmdb/wakemux
claude plugin install wakemux@wakemux
```

Then start a new Claude Code session from a cmux terminal and ask for a task "as a thread". [docs/install.md](docs/install.md) covers updates, uninstalling and installing from a clone.

## Documentation

- [Install](docs/install.md)
- [Concepts](docs/concepts.md): threads, the main session, report-back, escalation, the hop limit
- [Configuration](docs/configuration.md): every setting and where to set it
- [Troubleshooting](docs/troubleshooting.md)
- [Security](docs/security.md)
- [Limitations](docs/limitations.md)

## License

[MIT](LICENSE)
