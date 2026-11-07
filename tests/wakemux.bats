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
	add_thread busy
	(cd "$REPO/.claude/worktrees/busy" && exec sleep 30) &
	local pid=$!
	sleep 0.5
	run "$WAKEMUX" done busy --repo "$REPO"
	kill "$pid"
	[ "$status" -eq 1 ]
	output_contains "processes still run"
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
