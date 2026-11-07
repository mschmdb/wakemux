#!/usr/bin/env bats
# Tests for `wakemux new` and the configuration and dev layout it uses.
# A stub replaces cmux: it records each call and answers what the script reads.

load helpers

@test "new creates the worktree on thread/<name> and opens a workspace" {
	run "$WAKEMUX" new feature-x --repo "$REPO" --description "Does X" --prompt "Build X"
	[ "$status" -eq 0 ]
	output_contains "Thread feature-x: workspace:9, branch thread/feature-x (from main)"
	[ -d "$REPO/.claude/worktrees/feature-x" ]
	[ "$(git -C "$REPO/.claude/worktrees/feature-x" branch --show-current)" = "thread/feature-x" ]
	log_contains "new-workspace --name feature-x --description Does X --cwd $REPO/.claude/worktrees/feature-x"
	layout_contains "claude 'Build X'"
}

@test "new adds the worktree folder to info/exclude once, also when run from elsewhere" {
	cd "$BATS_TEST_TMPDIR"
	"$WAKEMUX" new one --repo "$REPO"
	"$WAKEMUX" new two --repo "$REPO"
	[ "$(grep -cx '.claude/worktrees/' "$REPO/.git/info/exclude")" -eq 1 ]
	[ ! -e "$BATS_TEST_TMPDIR/.git" ]
}

@test "new works from a subdirectory of the main checkout" {
	mkdir -p "$REPO/src"
	cd "$REPO/src"
	run "$WAKEMUX" new sub
	[ "$status" -eq 0 ]
	[ -d "$REPO/.claude/worktrees/sub" ]
}

@test "new branches from --from" {
	git -C "$REPO" branch other
	git -C "$REPO" -c user.name=t -c user.email=t@example.com commit -q --allow-empty -m later
	run "$WAKEMUX" new based --repo "$REPO" --from other
	[ "$status" -eq 0 ]
	output_contains "(from other)"
	[ "$(git -C "$REPO/.claude/worktrees/based" rev-parse HEAD)" = "$(git -C "$REPO" rev-parse other)" ]
}

@test "new stores the calling workspace for the report" {
	CMUX_WORKSPACE_ID=A162CBB9-1FC5-4834-9588-1D1D0293F6EB run "$WAKEMUX" new parent --repo "$REPO"
	[ "$status" -eq 0 ]
	[ "$(cat "$(git -C "$REPO/.claude/worktrees/parent" rev-parse --absolute-git-dir)/wakemux-parent")" = "A162CBB9-1FC5-4834-9588-1D1D0293F6EB" ]
}

@test "new refuses an existing worktree" {
	"$WAKEMUX" new twice --repo "$REPO"
	run "$WAKEMUX" new twice --repo "$REPO"
	[ "$status" -eq 1 ]
	output_contains "worktree already exists"
}

@test "new removes the worktree and branch when cmux fails" {
	CMUX_FAIL_NEW=1 run "$WAKEMUX" new broken --repo "$REPO"
	[ "$status" -ne 0 ]
	output_contains "failed, removing"
	[ ! -d "$REPO/.claude/worktrees/broken" ]
	run git -C "$REPO" rev-parse --verify -q refs/heads/thread/broken
	[ "$status" -ne 0 ]
}

@test "new still opens the workspace when the group list is unreadable" {
	CMUX_GROUPS='not json' run "$WAKEMUX" new nogroup --repo "$REPO"
	[ "$status" -eq 0 ]
	output_contains "no workspace group"
}

@test "the first thread turns the calling workspace into main below a new group" {
	CMUX_WORKSPACE_ID=caller STUB_CWD="$REPO" run "$WAKEMUX" new grouped --repo "$REPO"
	[ "$status" -eq 0 ]
	log_contains "workspace-group create --name repo --cwd $REPO"
	log_contains "workspace-group add --group group:1 --workspace caller"
	log_contains "workspace-action --workspace caller --action rename --title main"
	log_contains "--group group:1 --group-placement end"
}

# Copied files must be ignored in the thread's branch, as .env usually is.
ignore_in_repo() {
	printf '%s\n' "$@" >"$REPO/.gitignore"
	git -C "$REPO" add .gitignore
	git -C "$REPO" -c user.name=t -c user.email=t@example.com commit -q -m ignore
}

@test "new copies the default .env and skips missing files" {
	ignore_in_repo .env
	echo SECRET=1 >"$REPO/.env"
	run "$WAKEMUX" new copy --repo "$REPO"
	[ "$status" -eq 0 ]
	[ "$(cat "$REPO/.claude/worktrees/copy/.env")" = "SECRET=1" ]
	[ ! -e "$REPO/.claude/worktrees/copy/local.db" ]
}

@test "WAKEMUX_COPY_FILES chooses the copied files, also in subfolders" {
	ignore_in_repo local.db config/dev.env
	mkdir -p "$REPO/config"
	echo a >"$REPO/local.db"
	echo b >"$REPO/config/dev.env"
	WAKEMUX_COPY_FILES="local.db, config/dev.env" run "$WAKEMUX" new files --repo "$REPO"
	[ "$status" -eq 0 ]
	[ -f "$REPO/.claude/worktrees/files/local.db" ]
	[ -f "$REPO/.claude/worktrees/files/config/dev.env" ]
}

@test "settings come from env, then .wakemux.json, then the user file" {
	mkdir -p "$XDG_CONFIG_HOME/wakemux"
	echo '{"branchPrefix": "user/", "worktreeDir": "user-trees"}' >"$XDG_CONFIG_HOME/wakemux/config.json"
	echo '{"branchPrefix": "repo/"}' >"$REPO/.wakemux.json"
	run "$WAKEMUX" new layered --repo "$REPO"
	[ "$status" -eq 0 ]
	[ "$(git -C "$REPO/user-trees/layered" branch --show-current)" = "repo/layered" ]
	grep -qx 'user-trees/' "$REPO/.git/info/exclude"

	WAKEMUX_BRANCH_PREFIX=env- run "$WAKEMUX" new layered2 --repo "$REPO"
	[ "$status" -eq 0 ]
	[ "$(git -C "$REPO/user-trees/layered2" branch --show-current)" = "env-layered2" ]
}

@test "an invalid setting warns and falls back to the next source" {
	mkdir -p "$XDG_CONFIG_HOME/wakemux"
	echo '{"worktreeDir": "../escape"}' >"$XDG_CONFIG_HOME/wakemux/config.json"
	WAKEMUX_BRANCH_PREFIX='bad..prefix' run "$WAKEMUX" new fallback --repo "$REPO"
	[ "$status" -eq 0 ]
	output_contains "WAKEMUX_BRANCH_PREFIX: invalid value"
	output_contains "config.json worktreeDir: invalid value"
	[ "$(git -C "$REPO/.claude/worktrees/fallback" branch --show-current)" = "thread/fallback" ]
}

@test "a broken config file warns and is ignored" {
	echo '{ broken' >"$REPO/.wakemux.json"
	run "$WAKEMUX" new broken-config --repo "$REPO"
	[ "$status" -eq 0 ]
	output_contains ".wakemux.json: not valid JSON"
}

@test "an option without a value fails" {
	run "$WAKEMUX" new x --repo "$REPO" --from
	[ "$status" -eq 1 ]
	output_contains "--from needs a value"
}

@test "without a dev script only Claude opens" {
	run "$WAKEMUX" new plain --repo "$REPO"
	[ "$status" -eq 0 ]
	layout_lacks browser
	output_lacks "port"
}

@test "a pnpm project with Vite gets browser and dev server on a free port" {
	write_package '{"scripts": {"dev": "vite"}, "devDependencies": {"vite": "^6"}}' pnpm-lock.yaml
	run "$WAKEMUX" new vite --repo "$REPO"
	[ "$status" -eq 0 ]
	output_contains ", port "
	layout_contains '"type": "browser"'
	layout_matches 'pnpm install --prefer-offline && PORT=[0-9]+ pnpm dev --port [0-9]+ --strictPort'
}

@test "an npm project without Vite gets the port through PORT only" {
	write_package '{"scripts": {"dev": "next dev"}}' package-lock.json
	run "$WAKEMUX" new next --repo "$REPO"
	[ "$status" -eq 0 ]
	layout_matches 'npm install && PORT=[0-9]+ npm run dev"'
}

@test "a bun project is detected by its lockfile" {
	write_package '{"scripts": {"dev": "vite"}, "dependencies": {"vite": "^6"}}' bun.lock
	run "$WAKEMUX" new bun --repo "$REPO"
	[ "$status" -eq 0 ]
	layout_matches 'bun install && PORT=[0-9]+ bun run dev --port [0-9]+ --strictPort'
}

@test "the packageManager field wins over lockfiles" {
	write_package '{"packageManager": "pnpm@9.1.0", "scripts": {"dev": "vite"}}' package-lock.json
	run "$WAKEMUX" new pm --repo "$REPO"
	[ "$status" -eq 0 ]
	layout_contains 'pnpm dev'
}

@test "an unknown package manager opens only Claude" {
	write_package '{"scripts": {"dev": "vite"}}' yarn.lock
	run "$WAKEMUX" new yarn --repo "$REPO"
	[ "$status" -eq 0 ]
	layout_lacks browser
}

@test "devLayout off opens only Claude" {
	write_package '{"scripts": {"dev": "vite"}}' pnpm-lock.yaml
	WAKEMUX_DEV_LAYOUT=off run "$WAKEMUX" new off --repo "$REPO"
	[ "$status" -eq 0 ]
	layout_lacks browser
}

@test "devCommand replaces the derived command and fills in {port}" {
	WAKEMUX_DEV_COMMAND='make serve PORT={port}' run "$WAKEMUX" new custom --repo "$REPO"
	[ "$status" -eq 0 ]
	layout_matches 'make serve PORT=[0-9]+"'
	layout_contains '"type": "browser"'
}

@test "copying never writes through a symlink in the worktree" {
	mkdir -p "$BATS_TEST_TMPDIR/outside" "$REPO/config"
	echo original >"$BATS_TEST_TMPDIR/outside/dev.env"
	ln -s "$BATS_TEST_TMPDIR/outside" "$REPO/linked"
	git -C "$REPO" add linked
	git -C "$REPO" -c user.name=t -c user.email=t@example.com commit -q -m link
	rm "$REPO/linked"
	mkdir "$REPO/linked"
	echo replaced >"$REPO/linked/dev.env"
	WAKEMUX_COPY_FILES="linked/dev.env" run "$WAKEMUX" new symlink --repo "$REPO" --from HEAD
	[ "$status" -eq 0 ]
	output_contains "skipped linked/dev.env"
	[ "$(cat "$BATS_TEST_TMPDIR/outside/dev.env")" = "original" ]
}

@test "the dev layout follows the package.json of the base ref, not the main checkout" {
	write_package '{"scripts": {"dev": "vite"}}' pnpm-lock.yaml
	git -C "$REPO" branch with-pnpm
	git -C "$REPO" rm -q package.json pnpm-lock.yaml
	git -C "$REPO" -c user.name=t -c user.email=t@example.com commit -q -m plain
	run "$WAKEMUX" new from-ref --repo "$REPO" --from with-pnpm
	[ "$status" -eq 0 ]
	layout_contains "pnpm dev"
}

@test "Vite flags go only to a dev script that runs Vite" {
	write_package '{"scripts": {"dev": "astro dev"}, "devDependencies": {"vite": "^6"}}' pnpm-lock.yaml
	run "$WAKEMUX" new astro --repo "$REPO"
	[ "$status" -eq 0 ]
	layout_lacks "--strictPort"
	layout_matches 'PORT=[0-9]+ pnpm dev"'
}

@test "a SvelteKit dev script (vite dev) gets the Vite flags" {
	write_package '{"scripts": {"dev": "vite dev"}}' pnpm-lock.yaml
	run "$WAKEMUX" new kit --repo "$REPO"
	[ "$status" -eq 0 ]
	layout_matches 'pnpm dev --port [0-9]+ --strictPort'
}

@test "copying skips a destination that already exists in the worktree" {
	mkdir -p "$BATS_TEST_TMPDIR/outside"
	echo original >"$BATS_TEST_TMPDIR/outside/file"
	mkdir "$REPO/.env"
	ln -s "$BATS_TEST_TMPDIR/outside/file" "$REPO/.env/.env"
	git -C "$REPO" add .env
	git -C "$REPO" -c user.name=t -c user.email=t@example.com commit -q -m dir
	rm -r "$REPO/.env"
	echo SECRET=1 >"$REPO/.env"
	run "$WAKEMUX" new dir-dest --repo "$REPO" --from HEAD
	[ "$status" -eq 0 ]
	output_contains "skipped .env"
	[ "$(cat "$BATS_TEST_TMPDIR/outside/file")" = "original" ]
}

@test "a compound dev script gets no appended Vite flags" {
	write_package '{"scripts": {"dev": "vite & wait"}}' pnpm-lock.yaml
	run "$WAKEMUX" new compound --repo "$REPO"
	[ "$status" -eq 0 ]
	layout_lacks "--strictPort"
}

@test "npx vite counts as a Vite dev script" {
	write_package '{"scripts": {"dev": "npx vite --host"}}' package-lock.json
	run "$WAKEMUX" new npx --repo "$REPO"
	[ "$status" -eq 0 ]
	layout_matches 'npm run dev -- --port [0-9]+ --strictPort'
}

@test "new stores the parent Claude Code session for the fallback report" {
	WAKEMUX_PARENT_SESSION=8c4667e8-d867-4c6b-b592-663cf1c845b2 run "$WAKEMUX" new session --repo "$REPO"
	[ "$status" -eq 0 ]
	[ "$(cat "$(git -C "$REPO/.claude/worktrees/session" rev-parse --absolute-git-dir)/wakemux-parent-session")" = "8c4667e8-d867-4c6b-b592-663cf1c845b2" ]
}

@test "new ignores a parent session value that is not a session id" {
	WAKEMUX_PARENT_SESSION='../../x' run "$WAKEMUX" new nosession --repo "$REPO"
	[ "$status" -eq 0 ]
	[ ! -e "$(git -C "$REPO/.claude/worktrees/nosession" rev-parse --absolute-git-dir)/wakemux-parent-session" ]
}

@test "new refuses a thread beyond maxThreads" {
	WAKEMUX_MAX_THREADS=2 "$WAKEMUX" new one --repo "$REPO"
	WAKEMUX_MAX_THREADS=2 "$WAKEMUX" new two --repo "$REPO"
	WAKEMUX_MAX_THREADS=2 run "$WAKEMUX" new three --repo "$REPO"
	[ "$status" -eq 1 ]
	output_contains "2 threads are open (maxThreads 2)"
	[ ! -d "$REPO/.claude/worktrees/three" ]
}

@test "maxThreads 0 means no limit" {
	echo '{"maxThreads": 0}' >"$REPO/.wakemux.json"
	"$WAKEMUX" new one --repo "$REPO"
	run "$WAKEMUX" new two --repo "$REPO"
	[ "$status" -eq 0 ]
}

@test "maxThreads counts only worktrees in the thread folder" {
	git -C "$REPO" worktree add -q -b elsewhere "$BATS_TEST_TMPDIR/elsewhere"
	WAKEMUX_MAX_THREADS=1 run "$WAKEMUX" new only --repo "$REPO"
	[ "$status" -eq 0 ]
}

@test "parallel starts do not exceed maxThreads" {
	export WAKEMUX_MAX_THREADS=2
	for name in p1 p2 p3 p4; do
		("$WAKEMUX" new "$name" --repo "$REPO" >/dev/null 2>&1; echo $? >"$BATS_TEST_TMPDIR/status-$name") &
	done
	wait
	[ "$(cat "$BATS_TEST_TMPDIR"/status-* | grep -c '^0$')" -eq 2 ]
	[ "$(find "$REPO/.claude/worktrees" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')" -eq 2 ]
	[ ! -e "$REPO/.git/wakemux.lock" ]
}

@test "new records the repository whose info/exclude it changed" {
	"$WAKEMUX" new rec --repo "$REPO"
	grep -qxF "$(printf 'exclude\t%s\t.claude/worktrees/' "$REPO")" "$XDG_STATE_HOME/wakemux/manifest.tsv"
	"$WAKEMUX" new rec2 --repo "$REPO"
	[ "$(grep -c '^exclude' "$XDG_STATE_HOME/wakemux/manifest.tsv")" -eq 1 ]
}

@test "a copied file that the thread's branch does not ignore is skipped" {
	echo SECRET=1 >"$REPO/.env"
	echo ok >"$REPO/local.db"
	echo 'local.db' >"$REPO/.gitignore"
	git -C "$REPO" add .gitignore
	git -C "$REPO" -c user.name=t -c user.email=t@example.com commit -q -m ignore
	WAKEMUX_COPY_FILES=".env local.db" run "$WAKEMUX" new ignore-check --repo "$REPO"
	[ "$status" -eq 0 ]
	output_contains "skipped .env, the thread's branch does not ignore it"
	[ ! -e "$REPO/.claude/worktrees/ignore-check/.env" ]
	[ -f "$REPO/.claude/worktrees/ignore-check/local.db" ]
}

@test "maxThreads ignores worktrees from claude --worktree in the same folder" {
	git -C "$REPO" worktree add -q -b worktree-calm-puffin "$REPO/.claude/worktrees/calm-puffin"
	WAKEMUX_MAX_THREADS=1 run "$WAKEMUX" new counted --repo "$REPO"
	[ "$status" -eq 0 ]
}
