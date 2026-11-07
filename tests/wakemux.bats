#!/usr/bin/env bats
# Tests for the command line and `wakemux done`.

load helpers

@test "without arguments it prints usage and fails" {
	run "$WAKEMUX"
	[ "$status" -eq 1 ]
	output_contains "wakemux new <name>"
}

@test "--help prints usage for new and done" {
	run "$WAKEMUX" --help
	[ "$status" -eq 0 ]
	output_contains "wakemux new <name>"
	output_contains "wakemux done <name>"
	output_contains "--from"
	output_contains "--description"
	output_contains "WAKEMUX_COPY_FILES"
	output_contains ".wakemux.json"
}

@test "an unknown command fails" {
	run "$WAKEMUX" fertig x --repo "$REPO"
	[ "$status" -eq 1 ]
	output_contains "unknown command: fertig"
}

@test "a name outside a-z, 0-9 and - fails" {
	run "$WAKEMUX" new Bad_Name --repo "$REPO"
	[ "$status" -eq 1 ]
	output_contains "a-z, 0-9 and -"
}

@test "a missing name fails" {
	run "$WAKEMUX" done
	[ "$status" -eq 1 ]
	output_contains "name missing"
}

@test "an unknown option fails" {
	run "$WAKEMUX" new x --von main --repo "$REPO"
	[ "$status" -eq 1 ]
	output_contains "unknown option: --von"
}

@test "a path outside a git repository fails" {
	run "$WAKEMUX" done x --repo "$BATS_TEST_TMPDIR"
	[ "$status" -eq 1 ]
	output_contains "not a git repository"
}

@test "done without a worktree fails" {
	run "$WAKEMUX" done missing --repo "$REPO"
	[ "$status" -eq 1 ]
	output_contains "no worktree"
}

@test "done refuses a worktree with uncommitted changes" {
	add_thread dirty
	touch "$REPO/.claude/worktrees/dirty/file"
	run "$WAKEMUX" done dirty --repo "$REPO"
	[ "$status" -eq 1 ]
	output_contains "uncommitted changes"
	[ -d "$REPO/.claude/worktrees/dirty" ]
}

@test "done removes a clean worktree and its merged branch" {
	add_thread merged
	run "$WAKEMUX" done merged --repo "$REPO"
	[ "$status" -eq 0 ]
	output_contains "Removed worktree and branch thread/merged"
	[ ! -d "$REPO/.claude/worktrees/merged" ]
	run git -C "$REPO" rev-parse --verify -q refs/heads/thread/merged
	[ "$status" -ne 0 ]
}

@test "done keeps an unmerged branch" {
	add_thread work
	git -C "$REPO/.claude/worktrees/work" -c user.name=t -c user.email=t@example.com commit -q --allow-empty -m work
	run "$WAKEMUX" done work --repo "$REPO"
	[ "$status" -eq 0 ]
	output_contains "Kept branch thread/work, it is not merged"
	git -C "$REPO" rev-parse --verify -q refs/heads/thread/work
}

@test "done works from a subdirectory of the thread" {
	add_thread nested
	mkdir -p "$REPO/sub"
	cd "$REPO/sub"
	run "$WAKEMUX" done nested
	[ "$status" -eq 0 ]
	[ ! -d "$REPO/.claude/worktrees/nested" ]
}

@test "done refuses a detached worktree whose commits no branch holds" {
	git -C "$REPO" worktree add -q --detach "$REPO/.claude/worktrees/loose"
	git -C "$REPO/.claude/worktrees/loose" -c user.name=t -c user.email=t@example.com commit -q --allow-empty -m loose
	run "$WAKEMUX" done loose --repo "$REPO"
	[ "$status" -eq 1 ]
	output_contains "detached HEAD"
	[ -d "$REPO/.claude/worktrees/loose" ]
}

@test "done removes a detached worktree whose commit a branch holds" {
	git -C "$REPO" worktree add -q --detach "$REPO/.claude/worktrees/held"
	run "$WAKEMUX" done held --repo "$REPO"
	[ "$status" -eq 0 ]
	[ ! -d "$REPO/.claude/worktrees/held" ]
}

@test "done refuses while a process runs in the worktree" {
	export WAKEMUX_DONE_WAIT=1
	add_thread busy
	(cd "$REPO/.claude/worktrees/busy" && exec sleep 30) &
	local pid=$!
	sleep 0.5
	run "$WAKEMUX" done busy --repo "$REPO"
	kill "$pid"
	[ "$status" -eq 1 ]
	output_contains "processes still run"
}

@test "done waits for processes of a workspace that is just closing" {
	add_thread closing
	(cd "$REPO/.claude/worktrees/closing" && exec sleep 2) &
	sleep 0.5
	WAKEMUX_DONE_WAIT=10 run "$WAKEMUX" done closing --repo "$REPO"
	[ "$status" -eq 0 ]
	[ ! -d "$REPO/.claude/worktrees/closing" ]
}

@test "a process in a worktree with a longer name does not block done" {
	add_thread web
	add_thread web-2
	(cd "$REPO/.claude/worktrees/web-2" && exec sleep 30) &
	local pid=$!
	sleep 0.5
	run "$WAKEMUX" done web --repo "$REPO"
	kill "$pid"
	[ "$status" -eq 0 ]
	[ ! -d "$REPO/.claude/worktrees/web" ]
}

@test "done follows the configured worktree folder and branch prefix" {
	echo '{"worktreeDir": "trees", "branchPrefix": "task/"}' >"$REPO/.wakemux.json"
	git -C "$REPO" worktree add -q -b task/conf "$REPO/trees/conf"
	run "$WAKEMUX" done conf --repo "$REPO"
	[ "$status" -eq 0 ]
	output_contains "Removed worktree and branch task/conf"
	[ ! -d "$REPO/trees/conf" ]
}

@test "config prints the resolved settings" {
	echo '{"branchPrefix": "task/", "prStatus": false}' >"$REPO/.wakemux.json"
	WAKEMUX_MAX_THREADS=7 run "$WAKEMUX" config --repo "$REPO"
	[ "$status" -eq 0 ]
	output_contains "branchPrefix=task/"
	output_contains "maxThreads=7"
	output_contains "prStatus=false"
	output_contains "worktreeDir=.claude/worktrees"
	output_contains "copyFiles=.env"
}

@test "config <key> prints one value" {
	run "$WAKEMUX" config prStatus --repo "$REPO"
	[ "$status" -eq 0 ]
	[ "$output" = "true" ]
}

@test "config with an unknown key fails" {
	run "$WAKEMUX" config nope --repo "$REPO"
	[ "$status" -eq 1 ]
	output_contains "unknown setting: nope"
}

@test "invalid maxThreads and prStatus values fall back with a warning" {
	WAKEMUX_MAX_THREADS=-1 WAKEMUX_PR_STATUS=maybe run "$WAKEMUX" config --repo "$REPO"
	[ "$status" -eq 0 ]
	output_contains "WAKEMUX_MAX_THREADS: invalid value"
	output_contains "WAKEMUX_PR_STATUS: invalid value"
	output_contains "maxThreads=4"
	output_contains "prStatus=true"
}

MANIFEST() { cat "$XDG_STATE_HOME/wakemux/manifest.tsv"; }

@test "config set writes the user config and records that it created it" {
	run "$WAKEMUX" config set maxThreads 6
	[ "$status" -eq 0 ]
	[ "$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["maxThreads"])' "$XDG_CONFIG_HOME/wakemux/config.json")" = 6 ]
	MANIFEST | grep -qxF "$(printf 'created\t%s' "$XDG_CONFIG_HOME/wakemux/config.json")"
}

@test "config set keeps other keys and backs up an existing file once" {
	mkdir -p "$XDG_CONFIG_HOME/wakemux"
	echo '{"branchPrefix": "mine/"}' >"$XDG_CONFIG_HOME/wakemux/config.json"
	"$WAKEMUX" config set maxThreads 6
	"$WAKEMUX" config set maxHops 3
	run python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(d["branchPrefix"], d["maxThreads"], d["maxHops"])' "$XDG_CONFIG_HOME/wakemux/config.json"
	[ "$output" = "mine/ 6 3" ]
	[ "$(MANIFEST | grep -c '^backup')" -eq 1 ]
	backup=$(MANIFEST | awk -F'\t' '$1 == "backup" { print $3 }')
	[ "$(cat "$backup")" = '{"branchPrefix": "mine/"}' ]
}

@test "config set takes lists and booleans as text" {
	"$WAKEMUX" config set prRequiredOrgs "acme, beta"
	"$WAKEMUX" config set report off
	run python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(d["prRequiredOrgs"], d["report"])' "$XDG_CONFIG_HOME/wakemux/config.json"
	[ "$output" = "['acme', 'beta'] False" ]
}

@test "config set refuses an invalid value and leaves the file alone" {
	"$WAKEMUX" config set maxThreads 6
	run "$WAKEMUX" config set maxThreads lots
	[ "$status" -eq 1 ]
	output_contains "invalid value for maxThreads"
	run python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["maxThreads"])' "$XDG_CONFIG_HOME/wakemux/config.json"
	[ "$output" = 6 ]
}

@test "config set refuses an unknown key" {
	run "$WAKEMUX" config set maxThread 6
	[ "$status" -eq 1 ]
	output_contains "unknown setting: maxThread"
}

@test "config unset removes a key" {
	"$WAKEMUX" config set maxThreads 6
	"$WAKEMUX" config set maxHops 3
	"$WAKEMUX" config unset maxThreads
	run python3 -c 'import json,sys; print(sorted(json.load(open(sys.argv[1]))))' "$XDG_CONFIG_HOME/wakemux/config.json"
	[ "$output" = "['maxHops']" ]
}

@test "config shows the settings the mod reads too" {
	run "$WAKEMUX" config --repo "$REPO"
	output_contains "maxHops=6"
	output_contains "prRequiredOrgs="
	output_contains "report=true"
}

@test "a setting with a line break is refused, so it cannot reach the manifest" {
	printf '{"worktreeDir": "trees\\ncreated\\t/tmp/victim\\nx"}' >"$REPO/.wakemux.json"
	run "$WAKEMUX" config worktreeDir --repo "$REPO"
	[ "$output" = ".claude/worktrees" ] || [[ "$output" == *".claude/worktrees" ]] || false
	output_contains "invalid value"
}

@test "parallel config set calls keep every key" {
	for key in maxThreads maxHops reportMaxBytes; do
		value=7; [ "$key" = reportMaxBytes ] && value=2000
		"$WAKEMUX" config set "$key" "$value" >/dev/null &
	done
	wait
	run python3 -c 'import json,sys; print(sorted(json.load(open(sys.argv[1]))))' "$XDG_CONFIG_HOME/wakemux/config.json"
	[ "$output" = "['maxHops', 'maxThreads', 'reportMaxBytes']" ]
}
