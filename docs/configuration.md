# Configuration

Every setting has a default. Set only what you want to change.

## Where settings come from

Highest precedence first:

1. Environment variable `WAKEMUX_<KEY>`, with the key in upper snake case: `prRequiredOrgs` becomes `WAKEMUX_PR_REQUIRED_ORGS`.
2. The plugin's options (`userConfig`). The manifest declares `prRequiredOrgs` and `crossReview` only. Whether Claude Code shows a dialog for them depends on how you load the plugin; this is not verified yet.
3. `.wakemux.json` in the repository's main checkout.
4. `$XDG_CONFIG_HOME/wakemux/config.json`, or `~/.config/wakemux/config.json` when `XDG_CONFIG_HOME` is unset, empty or not an absolute path.
5. The default.

An invalid value produces a warning, and the next source down applies. The mod also warns about unknown keys. It shows its warnings in the `/wakemux` pane and in the debug log (`claude --debug`). The script prints warnings about its own settings to stderr and ignores keys it does not use.

The script `wakemux` runs as a shell command and cannot see the plugin's options dialog. It reads sources 1, 3, 4 and 5. `wakemux config` prints what it resolved.

Change your own settings file with:

```sh
wakemux config set maxThreads 6
wakemux config set prRequiredOrgs "acme, beta"
wakemux config unset maxThreads
```

`set` validates the value and keeps the file's other keys. The first change backs up the original file so that `install.sh --uninstall --purge` can restore it ([install](install.md#uninstall-and-restore)).

## Settings

| Key | Default | Values | Read by |
|---|---|---|---|
| `worktreeDir` | `.claude/worktrees` | a relative path inside the repository | script, mod |
| `branchPrefix` | `thread/` | a prefix that forms a valid branch name with the slug | script |
| `copyFiles` | `[".env"]` | relative paths of files copied from the main checkout into each new worktree, usually git-ignored ones such as `.env` | script |
| `devLayout` | `auto` | `auto`: browser and dev server when the project has a `dev` script and uses pnpm, npm or bun. `off`: Claude only | script |
| `devCommand` | derived | a shell command for the dev server; `{port}` is replaced with the free port | script |
| `maxThreads` | `4` | 0 to 100 worktrees under `worktreeDir`; `wakemux new` refuses to add one more. `0` means no limit | script |
| `prStatus` | `true` | attach a thread's PR to its sidebar entry | skill |
| `report` | `true` | send reports to the main session | mod |
| `reportMaxBytes` | `30000` | 1000 to 32000 bytes per report; cmux limits a message to 32 KiB. A forwarded report adds a short note after the limit | mod |
| `maxHops` | `6` | 0 to 100 reports in a row without a new commit before escalation; `0` turns the limit off | mod |
| `prRequiredOrgs` | `[]` | GitHub organizations whose repositories require PRs. For a matching `origin`, the pane's hand-over prompt tells Claude "This repository requires PRs." It is a hint, not enforcement | mod |
| `scriptPath` | the bundled `bin/wakemux` | an absolute path. Not accepted from `.wakemux.json`, because the mod runs it without asking | mod |
| `mergePolicy` | `repo-rules` | `repo-rules`, `pr`, `merge`. Accepted, not used yet | - |
| `crossReview` | `off` | `off` or a command name such as `codex`. Accepted, not used yet | - |

In environment variables, lists are separated by commas or spaces. Booleans accept `1`/`0`, `true`/`false`, `yes`/`no` and `on`/`off`. An empty variable counts as unset.

### The derived dev command

wakemux picks the package manager from the `packageManager` field in `package.json`, else from the lockfile (`pnpm-lock.yaml`, `bun.lock`, `bun.lockb`, `package-lock.json`). It reads `package.json` from the new worktree, so `--from <ref>` uses that ref's scripts.

| Manager | Command |
|---|---|
| pnpm | `pnpm install --prefer-offline && PORT=<port> pnpm dev` |
| npm | `npm install && PORT=<port> npm run dev` |
| bun | `bun install && PORT=<port> bun run dev` |

A `dev` script that is a single `vite` command also gets `--port <port> --strictPort`. Ports start at 5174.

## Examples

Your own machine, all repositories:

```json
{
  "prRequiredOrgs": ["my-company"],
  "maxThreads": 6
}
```

saved as `~/.config/wakemux/config.json`.

One repository, committed with it:

```json
{
  "copyFiles": [".env", "local.db"],
  "devCommand": "make serve PORT={port}"
}
```

saved as `.wakemux.json` in the repository root.

One shell session:

```sh
export WAKEMUX_REPORT=0
```

## Other environment variables

| Variable | Set by | Purpose |
|---|---|---|
| `WAKEMUX_PARENT_SESSION` | the mod, in every session | The session's Claude Code id. `wakemux new` stores it for the fallback report. |
| `WAKEMUX_PREVIEW_TIMEOUT` | you | Seconds `wakemux new` waits for the dev server before it stops trying to reload the browser. Default 180. |
