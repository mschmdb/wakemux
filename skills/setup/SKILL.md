---
name: setup
description: Installs wakemux from a git clone, checks the machine with `wakemux doctor`, and writes the user's wakemux settings after asking about them. Use it when the user asks to install, set up, configure or check wakemux, or pastes the setup prompt from the wakemux README. Also works before wakemux is installed, read straight from a clone.
---

# Set up wakemux

Work through the steps in order. Ask before you install software, overwrite a file or change shell settings. Report each step's result in one line.

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

If `install.sh` notes that `~/.local/bin` is not on the PATH, offer to add `export PATH="$HOME/.local/bin:$PATH"` to the user's shell profile. Only with a yes.

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

Write only the answers that differ from the default to `${XDG_CONFIG_HOME:-$HOME/.config}/wakemux/config.json` as JSON, for example `{"prRequiredOrgs": ["acme"], "maxThreads": 6}`. If the file exists, read it first, keep its other keys, and show the user the new content before you write it. Settings for one repository belong in `.wakemux.json` in that repository; mention this, do not create it.

Run `<wakemux> config` again and confirm the values. `docs/configuration.md` lists every setting (in the clone, or at https://github.com/mschmdb/wakemux/blob/main/docs/configuration.md).

## 5. Finish

Tell the user:

- Start a new Claude Code session from a cmux terminal, in a project's main checkout.
- `/wakemux` opens the threads pane there.
- Ask for any side task "as a thread" to start one.

If the user had an older, hand-made version of this setup, for example a `thread` skill in `~/.claude/skills/thread` or another plugin that reports thread turns, point out that both would run side by side, and ask whether to disable the old one.
