#!/usr/bin/env bats
# CLI tests for bin/wakemux that need git but no cmux.

WAKEMUX="$BATS_TEST_DIRNAME/../bin/wakemux"

setup() {
	REPO="$BATS_TEST_TMPDIR/repo"
	git init -q -b main "$REPO"
	git -C "$REPO" -c user.name=t -c user.email=t@example.com commit -q --allow-empty -m init
}

# A failing [[ ]] does not stop a bats test on bash 3.2, so assertions go through a function.
output_contains() {
	[[ "$output" == *"$1"* ]] || {
		echo "expected output to contain: $1" >&2
		echo "actual output: $output" >&2
		return 1
	}
}

add_thread() {
	git -C "$REPO" worktree add -q -b "thread/$1" "$REPO/.claude/worktrees/$1"
}

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
