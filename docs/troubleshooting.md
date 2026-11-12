# Troubleshooting

## Reports do not arrive in the main session

Check what cmux did with the message:

```sh
cmux agent inbox --limit 5
```

- **`queued` for a long time:** a likely cause is that the receiving session has no running cmux poller. Claude Code sessions started by cmux run `cmux hooks claude inbox-wait` in the background; check with `pgrep -fl inbox-wait`. In the author's test, a SendMessage to such a session woke it and started a new poller. Restarting the session may help as well (not verified). wakemux forwards a report through Claude Code after 15 seconds in this case; if you saw neither the report nor a desktop notification, read the debug log (`claude --debug`) of the thread session for lines starting with `wakemux:`.
- **`delivered` or `read`, and the thread still asked "SendMessage needs approval":** the thread forwarded the report through Claude Code as well, and Claude Code asks before it sends. See [The thread asks to approve SendMessage](#the-thread-asks-to-approve-sendmessage).
- **`failed`:** agent messages may be off for that session. Check with `cmux agent messages status`, turn them on with `cmux agent messages on`.
- **Nothing listed:** the thread did not send. Check `WAKEMUX_REPORT` and the `report` setting (`wakemux config` does not show it; the `/wakemux` pane shows setting warnings).

A session started outside cmux, for example in another terminal app, has no cmux hooks and receives no cmux messages.

If a report never showed up in `cmux agent inbox`, the thread's debug log (`claude --debug`) has a line `wakemux: cmux agent message to <target> failed` with cmux's error.

## The thread asks to approve SendMessage

The cmux sidebar shows "SendMessage needs approval" (or the same in your language) for a thread. The thread forwarded its report through Claude Code (`$.session.send`), and Claude Code runs that send through the same permission check as the SendMessage tool. The report waits until you approve it in the thread.

To let these sends through without asking, add an allow rule for the tool, on the Allow tab of `/permissions` or in `~/.claude/settings.json`:

```json
{
  "permissions": {
    "allow": ["SendMessage"]
  }
}
```

The rule also lets the model's own SendMessage calls through without asking, in every session that reads the file. In the author's test (Claude Code 2.1.322, auto mode) the rule removed the prompt and also released a send that was already waiting. Other permission modes are not tested.

## The thread reports nothing because it paused

The sidebar pill says `reports paused after N without a commit`. The thread ended more than `maxHops` turns in a row on the same commit, usually because it and the main session kept answering each other. Read the thread yourself, answer it, and let it commit; reports resume with the next commit.

## `wakemux new` fails

- **`N threads are open (maxThreads N)`:** land or clean up a thread, or raise `maxThreads`.
- **`worktree already exists`:** a thread with that slug exists. Pick another slug, or clean up the old one.
- **`another wakemux new holds .../wakemux.lock`:** another start in the same repository took longer than 30 seconds, or an interrupted start left the lock behind. If no `wakemux` process runs, remove that folder.
- **`Note: no workspace group`:** the calling workspace is not the main checkout, or cmux could not create a group. The thread opens ungrouped and works anyway.
- **A setting warning:** `wakemux config` shows what the script resolved.

## The browser shows an error page

The browser opens before the dev server listens. wakemux reloads it once the port answers, for up to `WAKEMUX_PREVIEW_TIMEOUT` seconds. Check the dev server pane for errors. If the port is taken, wakemux picked the next free one at start; a dev server that ignores both `PORT` and `--port` needs `devCommand`.

## `wakemux done` refuses

- **`uncommitted changes`:** commit or discard them in the thread first.
- **`processes still run`:** `wakemux done` waits up to 10 seconds (`WAKEMUX_DONE_WAIT`) for them to end. If they keep running, close the thread's workspace first: `cmux close-workspace --workspace <ref>`. `cmux tree --all` lists the refs.
- **`detached HEAD with commits no branch holds`:** create a branch for those commits, or remove the worktree by hand if you do not need them.

## Leftover worktrees

```sh
git worktree list
git worktree prune
```

`prune` removes entries whose folders are gone. Remove a folder that still exists with `wakemux done <slug>` or `git worktree remove <path>`.

## cmux commands fail inside scripts

The cmux CLI talks to the running app through the environment cmux gives its terminals. Commands run from a terminal outside cmux, or from a process with a reduced environment, may fail to find it.
