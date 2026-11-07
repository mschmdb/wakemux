# shellcheck shell=bash disable=SC2034,SC2154
# (bats sets output and status; WAKEMUX is used by the test files.)
# Shared setup for the bats tests: a fresh repository, an isolated environment,
# and a cmux stub on PATH.

WAKEMUX="$BATS_TEST_DIRNAME/../bin/wakemux"

setup() {
	# Keep the caller's cmux session and wakemux settings out of the tests.
	unset CMUX_WORKSPACE_ID CMUX_SURFACE_ID
	for var in $(env | sed -n 's/^\(WAKEMUX_[A-Z_]*\)=.*/\1/p'); do unset "$var"; done
	export XDG_CONFIG_HOME="$BATS_TEST_TMPDIR/config"
	export WAKEMUX_PREVIEW_TIMEOUT=0

	git init -q -b main "$BATS_TEST_TMPDIR/repo"
	# Resolved, because git reports /private/var for macOS temp folders under /var.
	REPO=$(cd "$BATS_TEST_TMPDIR/repo" && pwd -P)
	git -C "$REPO" -c user.name=t -c user.email=t@example.com commit -q --allow-empty -m init

	export CMUX_LOG="$BATS_TEST_TMPDIR/cmux.log"
	mkdir -p "$BATS_TEST_TMPDIR/bin"
	cat >"$BATS_TEST_TMPDIR/bin/cmux" <<'EOF'
#!/usr/bin/env bash
echo "$*" >>"$CMUX_LOG"
previous=""
for arg in "$@"; do
	[ "$previous" = "--layout" ] && printf '%s' "$arg" >"$CMUX_LOG.layout"
	previous=$arg
done
case "$1 ${2:-}" in
"workspace-group list") echo "${CMUX_GROUPS:-{\"groups\": []\}}" ;;
"workspace-group create") echo "OK group:1" ;;
"sidebar-state "*) echo "cwd=${STUB_CWD:-/nowhere}" ;;
"tree --all") echo '{"windows": [{"workspaces": [{"id": "caller", "title": "app"}]}]}' ;;
"new-workspace "*)
	[ -n "${CMUX_FAIL_NEW:-}" ] && exit 1
	echo "OK workspace:9"
	;;
esac
exit 0
EOF
	chmod +x "$BATS_TEST_TMPDIR/bin/cmux"
	export PATH="$BATS_TEST_TMPDIR/bin:$PATH"
}

# A failing [[ ]] does not stop a bats test on bash 3.2, so assertions go through functions.
output_contains() {
	[[ "$output" == *"$1"* ]] || {
		echo "expected output to contain: $1" >&2
		echo "actual output: $output" >&2
		return 1
	}
}

log_contains() {
	grep -qF -- "$1" "$CMUX_LOG" || {
		echo "expected a cmux call containing: $1" >&2
		cat "$CMUX_LOG" >&2
		return 1
	}
}

output_lacks() {
	[[ "$output" != *"$1"* ]] || {
		echo "expected output not to contain: $1" >&2
		echo "actual output: $output" >&2
		return 1
	}
}

layout_contains() {
	grep -qF -- "$1" "$CMUX_LOG.layout" || {
		echo "expected the layout to contain: $1" >&2
		cat "$CMUX_LOG.layout" >&2
		return 1
	}
}

layout_matches() {
	grep -qE -- "$1" "$CMUX_LOG.layout" || {
		echo "expected the layout to match: $1" >&2
		cat "$CMUX_LOG.layout" >&2
		return 1
	}
}

layout_lacks() {
	if grep -qF -- "$1" "$CMUX_LOG.layout"; then
		echo "expected the layout not to contain: $1" >&2
		cat "$CMUX_LOG.layout" >&2
		return 1
	fi
}

add_thread() {
	git -C "$REPO" worktree add -q -b "thread/$1" "$REPO/.claude/worktrees/$1"
}

# Commits package.json and a lockfile, because a new worktree checks out the base ref.
write_package() {
	echo "$1" >"$REPO/package.json"
	touch "$REPO/$2"
	git -C "$REPO" add package.json "$2"
	git -C "$REPO" -c user.name=t -c user.email=t@example.com commit -q -m package
}
