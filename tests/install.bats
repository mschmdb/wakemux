#!/usr/bin/env bats
# Tests for install.sh against a temporary HOME.

INSTALL="$BATS_TEST_DIRNAME/../install.sh"
ROOT=$(cd "$BATS_TEST_DIRNAME/.." && pwd -P)

setup() {
	export HOME="$BATS_TEST_TMPDIR/home"
	mkdir -p "$HOME"
	unset CLAUDE_CONFIG_DIR
}

@test "install links the plugin into the skills folder and the script into ~/.local/bin" {
	run "$INSTALL"
	[ "$status" -eq 0 ]
	[ "$(readlink "$HOME/.claude/skills/wakemux")" = "$ROOT" ]
	[ "$(readlink "$HOME/.local/bin/wakemux")" = "$ROOT/bin/wakemux" ]
}

@test "install honours CLAUDE_CONFIG_DIR" {
	export CLAUDE_CONFIG_DIR="$BATS_TEST_TMPDIR/claude"
	run "$INSTALL"
	[ "$status" -eq 0 ]
	[ "$(readlink "$CLAUDE_CONFIG_DIR/skills/wakemux")" = "$ROOT" ]
}

@test "install twice is fine" {
	"$INSTALL"
	run "$INSTALL"
	[ "$status" -eq 0 ]
}

@test "install --no-bin leaves ~/.local/bin alone" {
	run "$INSTALL" --no-bin
	[ "$status" -eq 0 ]
	[ ! -e "$HOME/.local/bin/wakemux" ]
}

@test "install refuses to replace something it did not create" {
	mkdir -p "$HOME/.claude/skills/wakemux"
	run "$INSTALL"
	[ "$status" -eq 1 ]
	[[ "$output" == *"already exists"* ]] || false
	[ -d "$HOME/.claude/skills/wakemux" ]
	[ ! -L "$HOME/.claude/skills/wakemux" ]
}

@test "install refuses a link that points somewhere else" {
	mkdir -p "$HOME/.local/bin" "$HOME/other"
	ln -s "$HOME/other" "$HOME/.local/bin/wakemux"
	run "$INSTALL"
	[ "$status" -eq 1 ]
	[ "$(readlink "$HOME/.local/bin/wakemux")" = "$HOME/other" ]
	[ ! -e "$HOME/.claude/skills/wakemux" ]
}

@test "uninstall removes only its own links" {
	"$INSTALL"
	mkdir -p "$HOME/keep"
	run "$INSTALL" --uninstall
	[ "$status" -eq 0 ]
	[ ! -e "$HOME/.claude/skills/wakemux" ]
	[ ! -L "$HOME/.claude/skills/wakemux" ]
	[ ! -L "$HOME/.local/bin/wakemux" ]
	[ -d "$HOME/keep" ]
}

@test "uninstall leaves a foreign file in place" {
	mkdir -p "$HOME/.local/bin"
	echo mine >"$HOME/.local/bin/wakemux"
	run "$INSTALL" --uninstall
	[ "$status" -eq 0 ]
	[ "$(cat "$HOME/.local/bin/wakemux")" = "mine" ]
	[[ "$output" == *"not a link to this clone"* ]] || false
}

@test "an unknown option fails" {
	run "$INSTALL" --force
	[ "$status" -eq 1 ]
	[[ "$output" == *"unknown option: --force"* ]] || false
}
