# wakemux

Run side tasks as separate Claude Code sessions in [cmux](https://cmux.dev), each in its own git worktree. When a thread finishes a turn, it reports back to your main session and wakes it up. You watch one session instead of five.

**Status:** 0.3.5. Tested on the author's Mac with cmux 0.65.2 and Claude Code 2.1.322.

**Maintenance:** I build wakemux for my own work and fix what breaks for me. Issues and PRs are welcome, but I make no promises about response times or new features.

## How it works

1. You ask your main Claude Code session to do something "as a thread".
2. `wakemux new <slug>` creates a git worktree on branch `thread/<slug>` and opens a cmux workspace with a new Claude Code session in it. Projects with a `dev` script and pnpm, npm or bun also get a browser and the dev server on a free port.
3. When the thread finishes a turn, it sends its answer to the main session. cmux wakes the main session if it is idle. If that does not work, wakemux tries Claude Code's own messaging and then a desktop notification ([details](docs/concepts.md#report-back)).
4. The main session answers what your repository rules already settle, asks you about the rest, and lands finished threads the way your repository wants: a PR or a local merge.
5. `wakemux done <slug>` removes the worktree and the merged branch.

A thread can also run a loop, such as a watcher that checks open PRs every 30 minutes. Ticks without news stay quiet; only news reaches the main session ([details](docs/concepts.md#loops)).

Each thread shows its state as a pill in the cmux sidebar. The optional `/wakemux` pane lists all threads with buttons to open, hand over and clean up.

## Requirements

- macOS with [cmux](https://cmux.dev). Developed with cmux 0.65.2.
- [Claude Code](https://code.claude.com). Developed with 2.1.319.
- `git`, `python3` and `lsof`.

## Install

Open Claude Code in a cmux terminal and paste:

```
Set up wakemux: clone https://github.com/mschmdb/wakemux to ~/.local/share/wakemux and follow skills/setup/SKILL.md in it.
```

Claude clones the repository, runs `install.sh`, checks your machine with `wakemux doctor` and asks about your settings. Then start a new session and ask for a task "as a thread".

What the install changes:

- a clone of this repository, by default in `~/.local/share/wakemux`
- a link `~/.claude/skills/wakemux` to the clone, which Claude Code loads as a plugin
- a link `~/.local/bin/wakemux` to the shell script
- only if you agree: a marked `PATH` block in your shell profile, and your settings in `~/.config/wakemux/config.json`. wakemux backs up both files before the first change.

When you start threads, wakemux creates worktrees, branches and cmux workspaces, and adds the worktree folder (default `.claude/worktrees/`) to `.git/info/exclude` of the repository. `install.sh --uninstall --purge`, or asking the setup skill to remove wakemux, removes the links and the `PATH` block, restores or removes the settings file, and takes the exclude line out of repositories without open threads. It leaves the clone, your threads and the cmux workspaces for you to decide. [docs/install.md](docs/install.md#what-wakemux-changes-on-your-machine) lists every change and how to undo it, and has the manual steps, the marketplace install and updates.

## Documentation

- [Install](docs/install.md)
- [Concepts](docs/concepts.md): threads, the main session, report-back, escalation, the hop limit, loops
- [Configuration](docs/configuration.md): every setting and where to set it
- [Troubleshooting](docs/troubleshooting.md)
- [Security](docs/security.md)
- [Limitations](docs/limitations.md)
- [Changelog](CHANGELOG.md) and [contributing](CONTRIBUTING.md)

## License

[MIT](LICENSE)
