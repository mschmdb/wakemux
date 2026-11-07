---
name: setup
description: Installs wakemux from a git clone, checks the machine with `wakemux doctor`, writes the user's wakemux settings after asking about them, and uninstalls wakemux completely. Use it when the user asks to install, set up, configure, check or uninstall wakemux, or pastes the setup prompt from the wakemux README. Also works before wakemux is installed, read straight from a clone.
---

# Set up wakemux

Work through the steps in order. Ask before you install software, overwrite a file or change shell settings. Report each step's result in one line.

Change files only through `install.sh` and `wakemux config set`. They note every change in `~/.local/state/wakemux/manifest.tsv` and keep a backup of each original, so the uninstall below can restore it. Do not edit the user's shell profile or settings file by hand.

The clone lives in `~/.local/share/wakemux` unless the user names another folder or wakemux is already installed. Call it `<clone>` below. `<wakemux>` means `<clone>/bin/wakemux` for a clone install and plain `wakemux` for a marketplace install; pick it in step 2 and use it throughout.

## 1. Check the place

- `uname` must print `Darwin`. Otherwise say wakemux runs on macOS only and stop.
- `echo $CMUX_WORKSPACE_ID` must print something. If it is empty, say that this session does not run in a cmux terminal. Setup can continue, but the user has to start Claude Code from a cmux terminal to use wakemux.

## 2. Get the code

Check what exists:

- `claude plugin list` shows `wakemux@wakemux`: the marketplace install is in place. Skip to step 3 and use `wakemux` from the Bash tool, which Claude Code provides for installed plugins. Do not also run `install.sh`.
- `<clone>/.git` exists: run `git -C <clone> pull --ff-only`.
- Neither: run `git clone https://github.com/mschmdb/wakemux.git <clone>`.

Then run `<clone>/install.sh`. It links the clone into the Claude Code skills folder and `bin/wakemux` into `~/.local/bin`. If it refuses because something already exists at a target, show the user its message and ask what to do. Never delete the existing file yourself.

If `install.sh` notes that `~/.local/bin` is not on the PATH, offer to run `<clone>/install.sh --add-path`. It backs up the shell profile and adds a marked block that uninstall removes again. Only with a yes.

## 3. Check the machine

Run `<wakemux> doctor`. For each line:

- `FAIL`: explain what is missing and how to get it. Install nothing without the user's yes.
- `warn  not inside a cmux terminal` and `warn  claude does not run through the cmux wrapper`: the user must start Claude Code from a cmux terminal. Reports cannot wake sessions started elsewhere.
- `warn  wakemux plugin not installed`: expected right after `install.sh`; Claude Code loads the plugin in the next session.
- `warn  settings: ...`: fix it in step 4.

## 4. Settings

Show the current values with `<wakemux> config`. Then ask these questions in one message, each with the default as the suggested answer:

1. GitHub organizations whose repositories require pull requests (`prRequiredOrgs`, default none). Example: the user's employer.
2. Git-ignored files to copy into each new thread (`copyFiles`, default `.env`).
3. How many threads may be open per repository (`maxThreads`, default 4, `0` for no limit).
4. Browser and dev server next to each thread for web projects (`devLayout`, default `auto`, or `off`).

Set only the answers that differ from the default, one command each, for example `<wakemux> config set prRequiredOrgs "acme, beta"` and `<wakemux> config set maxThreads 6`. The command validates the value, keeps the file's other keys and backs up the original before the first change. Show the user the commands before you run them. Settings for one repository belong in `.wakemux.json` in that repository; mention this, do not create it.

Run `<wakemux> config` again and confirm the values. `docs/configuration.md` lists every setting (in the clone, or at https://github.com/mschmdb/wakemux/blob/main/docs/configuration.md).

## 5. Finish

Tell the user:

- Start a new Claude Code session from a cmux terminal, in a project's main checkout.
- `/wakemux` opens the threads pane there.
- Ask for any side task "as a thread" to start one.

If the user had an older, hand-made version of this setup, for example a `thread` skill in `~/.claude/skills/thread` or another plugin that reports thread turns, point out that both would run side by side, and ask whether to disable the old one.

## Uninstall

When the user asks to remove wakemux:

1. **Open threads.** Run `git worktree list` in the current repository and in each repository listed with `exclude` in `~/.local/state/wakemux/manifest.tsv`. Name every thread worktree with uncommitted changes or commits not merged into its base. Ask the user to land or clean them up first, or to confirm that they stay. Never delete a worktree or a branch yourself.
2. **Settings.** Ask whether the user wants their wakemux settings back as they were before (`--purge`) or kept for a later install.
3. **Run the uninstall** with `${CLAUDE_PLUGIN_ROOT}/install.sh --uninstall`, plus `--purge` if the user chose it. It removes the links and the PATH block from the shell profile. With `--purge` it also restores the settings file from its backup (or removes it if wakemux created it), takes `.claude/worktrees/` out of `.git/info/exclude` in repositories without open threads, and deletes `~/.local/state/wakemux`. Show the user its output.
4. **Marketplace install:** afterwards run `claude plugin uninstall wakemux@wakemux` and `claude plugin marketplace remove wakemux`.
5. **The clone:** if `git -C <clone> status --porcelain` prints nothing, offer to delete the clone folder. Delete it only with a yes.
6. **Tell the user what stays,** because wakemux did not create it or cannot know it is unused: thread branches and worktrees they kept, `.wakemux.json` files in repositories, cmux workspace groups and the workspace renamed `main`, and a settings file that wakemux never changed (for example one the user wrote by hand). Start a new Claude Code session so the plugin is gone from it.
