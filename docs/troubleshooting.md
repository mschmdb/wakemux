# Troubleshooting

## Reports do not arrive in the main session

Check what cmux did with the message:

```sh
cmux agent inbox --limit 5
```

- **`queued` for a long time:** a likely cause is that the receiving session has no running cmux poller. Claude Code sessions started by cmux run `cmux hooks claude inbox-wait` in the background; check with `pgrep -fl inbox-wait`. In the author's test, a SendMessage to such a session woke it and started a new poller. Restarting the session may help as well (not verified). wakemux forwards a report through Claude Code after 15 seconds in this case; if you saw neither the report nor a desktop notification, read the debug log (`claude --debug`) of the thread session for lines starting with `wakemux:`.
- **`failed`:** agent messages may be off for that session. Check with `cmux agent messages status`, turn them on with `cmux agent messages on`.
- **Nothing listed:** the thread did not send. Check `WAKEMUX_REPORT` and the `report` setting (`wakemux config` does not show it; the `/wakemux` pane shows setting warnings).

A session started outside cmux, for example in another terminal app, has no cmux hooks and receives no cmux messages.

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
- **`processes still run`:** close the thread's workspace first: `cmux close-workspace --workspace <ref>`. `cmux tree --all` lists the refs.
- **`detached HEAD with commits no branch holds`:** create a branch for those commits, or remove the worktree by hand if you do not need them.

## Leftover worktrees

```sh
git worktree list
git worktree prune
```

`prune` removes entries whose folders are gone. Remove a folder that still exists with `wakemux done <slug>` or `git worktree remove <path>`.

## cmux commands fail inside scripts

The cmux CLI talks to the running app through the environment cmux gives its terminals. Commands run from a terminal outside cmux, or from a process with a reduced environment, may fail to find it.
