# Install

Two ways, with the same result inside Claude Code. Both need macOS, cmux, Claude Code, `git`, `python3` and `lsof`.

Start Claude Code sessions from a cmux terminal. Sessions started elsewhere receive no cmux messages.

## From the marketplace

In a terminal:

```sh
claude plugin marketplace add mschmdb/wakemux
claude plugin install wakemux@wakemux
```

Or inside Claude Code:

```
/plugin marketplace add mschmdb/wakemux
/plugin install wakemux@wakemux
```

Start a new Claude Code session. Claude Code puts the plugin's `bin/` on the Bash tool's `PATH`, so the skill can run `wakemux`. Your own shell does not get it; use the clone below if you want `wakemux` there too.

Update:

```sh
claude plugin marketplace update wakemux
claude plugin update wakemux@wakemux
```

Then start a new session.

Uninstall:

```sh
claude plugin uninstall wakemux@wakemux
claude plugin marketplace remove wakemux
```

## From a clone

```sh
git clone https://github.com/mschmdb/wakemux.git
cd wakemux
./install.sh
```

`install.sh` creates two links and touches nothing else:

- `~/.claude/skills/wakemux` points to the clone. Claude Code loads a folder there as a plugin (`wakemux@skills-dir`). With `CLAUDE_CONFIG_DIR` set, the link goes to `$CLAUDE_CONFIG_DIR/skills/wakemux`.
- `~/.local/bin/wakemux` points to `bin/wakemux`, for your own shell. Skip it with `./install.sh --no-bin`.

It refuses to replace a file or a link it did not create. Start a new Claude Code session afterwards.

Update: `git pull` in the clone, then start a new session.

Uninstall: `./install.sh --uninstall`. It removes only links that point to this clone.

To try wakemux for one session without installing: `claude --plugin-dir /path/to/wakemux`.

## Check the install

In a new session inside cmux:

- `/wakemux` opens the threads pane.
- `wakemux config` in the Bash tool prints the resolved settings.
- Asking Claude for a task "as a thread" uses the `wakemux:thread` skill.

## Do not install twice

The marketplace install and the clone install load the same plugin under two names. Use one of them.
