# Install

Two ways: from a clone (recommended, by hand or set up by Claude Code) or from the marketplace. Both need macOS, cmux, Claude Code, `git`, `python3` and `lsof`.

Start Claude Code sessions from a cmux terminal. Sessions started elsewhere receive no cmux messages.

## With Claude Code

Paste into Claude Code, in a cmux terminal:

```
Set up wakemux: clone https://github.com/mschmdb/wakemux to ~/.local/share/wakemux and follow skills/setup/SKILL.md in it.
```

The setup skill does what the next section describes, checks the machine with `wakemux doctor`, and writes your settings after asking. Once installed, run it again any time as `/wakemux:setup`, also to uninstall: ask it to remove wakemux.

## From a clone, by hand

```sh
git clone https://github.com/mschmdb/wakemux.git ~/.local/share/wakemux
~/.local/share/wakemux/install.sh
~/.local/share/wakemux/bin/wakemux doctor
```

`install.sh` creates two links and touches nothing else:

- `~/.claude/skills/wakemux` points to the clone. Claude Code loads a folder there as a plugin (`wakemux@skills-dir`). With `CLAUDE_CONFIG_DIR` set, the link goes to `$CLAUDE_CONFIG_DIR/skills/wakemux`.
- `~/.local/bin/wakemux` points to `bin/wakemux`, for your own shell. Skip it with `./install.sh --no-bin`.

It refuses to replace a file or a link it did not create. Start a new Claude Code session afterwards.

A clone is the recommended install: `wakemux` also works in your own shell, and updating is a `git pull`.

Update: `git pull` in the clone, then start a new session.

If `~/.local/bin` is not on your `PATH`, `./install.sh --add-path` adds it to `~/.zshrc` (or `~/.bash_profile` for bash) in a marked block, after a backup of the file.

To try wakemux for one session without installing: `claude --plugin-dir /path/to/wakemux`.

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

Start a new Claude Code session. Claude Code puts the plugin's `bin/` on the Bash tool's `PATH`, so the skill can run `wakemux`. Your own shell does not get it; use a clone if you want `wakemux` there too.

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

## What wakemux changes on your machine

Every file and setting wakemux touches, and how to undo it. "purge" means `install.sh --uninstall --purge`.

### At install

| What | Clone install | Marketplace install | Undo |
|---|---|---|---|
| The code | the clone folder you chose, e.g. `~/.local/share/wakemux` | Claude Code copies it to `~/.claude/plugins/marketplaces/wakemux` and `~/.claude/plugins/cache/wakemux` | delete the clone folder / `claude plugin uninstall` and `claude plugin marketplace remove` |
| Plugin registration (marketplace paths and keys as seen with Claude Code 2.1.319; Claude Code manages them) | link `~/.claude/skills/wakemux` to the clone | entries `extraKnownMarketplaces.wakemux` and `enabledPlugins."wakemux@wakemux"` in `~/.claude/settings.json`, plus Claude Code's own lists in `~/.claude/plugins/` | `install.sh --uninstall` / the two `claude plugin` commands |
| Shell command | link `~/.local/bin/wakemux` (not with `--no-bin`) | none | `install.sh --uninstall` |
| `PATH` | only with `--add-path`: a block marked `# >>> wakemux >>>` at the end of `~/.zshrc` or `~/.bash_profile`, after a backup | none | `install.sh --uninstall` removes the block |

With `CLAUDE_CONFIG_DIR` set, `$CLAUDE_CONFIG_DIR` takes the place of `~/.claude`.

### When you configure it

| What | Undo |
|---|---|
| `~/.config/wakemux/config.json` (or under `$XDG_CONFIG_HOME`), changed by `wakemux config set` and `unset`. The first change backs up the original. | purge restores the original, or removes the file if wakemux created it |
| `~/.local/state/wakemux/` (or under `$XDG_STATE_HOME`): `manifest.tsv` lists what wakemux changed, `backups/` holds the originals, `config.lock` | purge deletes the folder |

The setup skill changes files only through these commands.

### While you use it

| What | Where | Undo |
|---|---|---|
| One worktree per thread | `<repository>/.claude/worktrees/<slug>` (setting `worktreeDir`) | `wakemux done <slug>` |
| One branch per thread | `thread/<slug>` (setting `branchPrefix`) | `wakemux done` deletes it once merged; an unmerged branch stays until you delete it |
| Copied files, by default `.env` | inside each worktree | removed with the worktree |
| Notes for the report-back: `wakemux-parent`, `wakemux-parent-session` | the worktree's git folder, `<repository>/.git/worktrees/<slug>/` | removed with the worktree |
| The line `<worktreeDir>/`, by default `.claude/worktrees/` | `<repository>/.git/info/exclude`, once per repository, only if missing | purge removes it in repositories without open threads |
| A lock while a thread starts | `<repository>/.git/wakemux.lock` | removed when the start ends |
| cmux: a workspace per thread, a workspace group per project with your calling workspace renamed `main`, a sidebar pill per thread, desktop notifications, agent messages | the cmux app | close workspaces in cmux; wakemux does not undo the group or the rename |
| `WAKEMUX_PARENT_SESSION` | environment of each running Claude Code session | ends with the session |
| The pane's and the report's state | Claude Code's session state | managed by Claude Code |

wakemux hands each report to cmux (`cmux agent message`) or to Claude Code's cross-session messaging. The receiving Claude Code session sends it to the model like any other input. Other network access comes from what wakemux starts: the setup's `git clone` and `git pull`, the dev pane's `pnpm install`, `npm install` or `bun install`, and `gh` and `git push` when the main session lands a thread through a PR.

## Uninstall and restore

wakemux notes every file it changes in `~/.local/state/wakemux/manifest.tsv` (or under `$XDG_STATE_HOME`):

- the shell profile, when you ran `--add-path`, with a backup in `backups/`
- your settings file, on the first `wakemux config set` or `unset`, with a backup in `backups/`
- `.git/info/exclude` of each repository where `wakemux new` added the line `.claude/worktrees/`

`./install.sh --uninstall` removes the links and the PATH block from your profile, and keeps your settings. Lines you added to the profile since then stay.

`./install.sh --uninstall --purge` also:

- restores your settings file from its backup, or removes it if wakemux created it. Changes made to it after the first `wakemux config set` are lost.
- removes `.claude/worktrees/` from `.git/info/exclude` in repositories without open threads
- deletes `~/.local/state/wakemux`

For a marketplace install, run `install.sh` from the installed plugin before you uninstall it; the setup skill knows where it is. Then delete the clone folder if you have one.

`--purge` does not touch thread branches and worktrees, `.wakemux.json` files in repositories, cmux workspace groups and the workspace renamed `main`, or a settings file wakemux never changed.

## Check the install

In a new session inside cmux:

- `/wakemux` opens the threads pane.
- `wakemux doctor` checks git, python3, lsof, cmux, Claude Code, the plugin install and your settings.
- `wakemux config` prints the resolved settings.
- Asking Claude for a task "as a thread" uses the `wakemux:thread` skill.

## Do not install twice

The marketplace install and the clone install load the same plugin under two names. Use one of them.
