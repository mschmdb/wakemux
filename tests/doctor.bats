#!/usr/bin/env bats
# Tests for `wakemux doctor`, which checks what wakemux needs.

load helpers

# A claude stub; in a folder named like cmux's wrapper folder when $1 is "shim".
stub_claude() {
	local dir="$BATS_TEST_TMPDIR/bin"
	[ "${1:-}" = shim ] && dir="$BATS_TEST_TMPDIR/cmux-cli-shims/abc"
	mkdir -p "$dir"
	cat >"$dir/claude" <<'STUB'
#!/usr/bin/env bash
case "$1 ${2:-}" in
"--version ") echo "2.1.319 (Claude Code)" ;;
"plugin list") printf '%s\n' "${STUB_PLUGINS-  ❯ wakemux@wakemux}" ;;
esac
STUB
	chmod +x "$dir/claude"
	export PATH="$dir:$PATH"
}

@test "doctor passes when everything is in place" {
	stub_claude shim
	CMUX_WORKSPACE_ID=ws run "$WAKEMUX" doctor --repo "$REPO"
	[ "$status" -eq 0 ]
	output_contains "ok    git"
	output_contains "ok    cmux 0.65.2"
	output_contains "ok    Claude Code 2.1.319"
	output_contains "ok    claude runs through the cmux wrapper"
	output_contains "ok    wakemux plugin installed"
	output_contains "ok    settings"
	output_lacks "FAIL"
}

@test "doctor fails when the cmux app does not answer" {
	stub_claude shim
	CMUX_WORKSPACE_ID=ws CMUX_DOWN=1 run "$WAKEMUX" doctor --repo "$REPO"
	[ "$status" -eq 1 ]
	output_contains "FAIL  cmux app not reachable"
}

@test "doctor warns outside a cmux terminal" {
	stub_claude shim
	run "$WAKEMUX" doctor --repo "$REPO"
	[ "$status" -eq 0 ]
	output_contains "warn  not inside a cmux terminal"
}

@test "doctor warns when claude does not run through the cmux wrapper" {
	stub_claude
	CMUX_WORKSPACE_ID=ws run "$WAKEMUX" doctor --repo "$REPO"
	[ "$status" -eq 0 ]
	output_contains "warn  claude does not run through the cmux wrapper"
}

@test "doctor fails without Claude Code" {
	CMUX_WORKSPACE_ID=ws PATH="$BATS_TEST_TMPDIR/bin:/usr/bin:/bin:/usr/sbin" run "$WAKEMUX" doctor --repo "$REPO"
	[ "$status" -eq 1 ]
	output_contains "FAIL  Claude Code not found"
}

@test "doctor warns when the plugin is not installed" {
	stub_claude shim
	CMUX_WORKSPACE_ID=ws STUB_PLUGINS="" run "$WAKEMUX" doctor --repo "$REPO"
	[ "$status" -eq 0 ]
	output_contains "warn  wakemux plugin not installed"
}

@test "doctor reports setting warnings" {
	stub_claude shim
	echo '{"maxThreads": -3}' >"$REPO/.wakemux.json"
	CMUX_WORKSPACE_ID=ws run "$WAKEMUX" doctor --repo "$REPO"
	[ "$status" -eq 0 ]
	output_contains "warn  settings: .wakemux.json maxThreads: invalid value"
}

@test "doctor works outside a git repository" {
	stub_claude shim
	cd "$BATS_TEST_TMPDIR"
	CMUX_WORKSPACE_ID=ws run "$WAKEMUX" doctor
	[ "$status" -eq 0 ]
	output_contains "ok    settings"
}
