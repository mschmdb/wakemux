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

STATE() { echo "$HOME/.local/state/wakemux"; }

@test "--add-path adds a marked PATH block to the zsh profile once and backs it up" {
	echo 'alias ll="ls -l"' >"$HOME/.zshrc"
	SHELL=/bin/zsh run "$INSTALL" --add-path
	[ "$status" -eq 0 ]
	SHELL=/bin/zsh "$INSTALL" --add-path
	[ "$(grep -c '# >>> wakemux >>>' "$HOME/.zshrc")" -eq 1 ]
	grep -q 'export PATH="$HOME/.local/bin:$PATH"' "$HOME/.zshrc"
	backup=$(awk -F'\t' '$1 == "backup" { print $3 }' "$(STATE)/manifest.tsv")
	[ "$(cat "$backup")" = 'alias ll="ls -l"' ]
}

@test "--add-path uses .bash_profile for bash" {
	SHELL=/bin/bash run "$INSTALL" --add-path
	[ "$status" -eq 0 ]
	grep -q '# >>> wakemux >>>' "$HOME/.bash_profile"
}

@test "uninstall removes the PATH block and keeps lines added since" {
	echo 'before' >"$HOME/.zshrc"
	SHELL=/bin/zsh "$INSTALL" --add-path
	echo 'after' >>"$HOME/.zshrc"
	SHELL=/bin/zsh run "$INSTALL" --uninstall
	[ "$status" -eq 0 ]
	[ "$(cat "$HOME/.zshrc")" = "$(printf 'before\nafter')" ]
}

@test "uninstall keeps the settings, --purge restores them" {
	"$INSTALL"
	mkdir -p "$HOME/.config/wakemux"
	echo '{"maxThreads": 2}' >"$HOME/.config/wakemux/config.json"
	"$ROOT/bin/wakemux" config set maxThreads 6
	"$INSTALL" --uninstall
	[ -f "$HOME/.config/wakemux/config.json" ]
	run "$INSTALL" --uninstall --purge
	[ "$status" -eq 0 ]
	[ "$(cat "$HOME/.config/wakemux/config.json")" = '{"maxThreads": 2}' ]
	[ ! -e "$(STATE)" ]
}

@test "--purge deletes a config file that wakemux created" {
	"$ROOT/bin/wakemux" config set maxThreads 6
	run "$INSTALL" --uninstall --purge
	[ "$status" -eq 0 ]
	[ ! -e "$HOME/.config/wakemux/config.json" ]
	[ ! -e "$HOME/.config/wakemux" ]
}

@test "--purge removes the exclude line only where no thread is left" {
	for name in a b; do
		git init -q -b main "$BATS_TEST_TMPDIR/$name"
		git -C "$BATS_TEST_TMPDIR/$name" -c user.name=t -c user.email=t@example.com commit -q --allow-empty -m init
	done
	repo_a=$(cd "$BATS_TEST_TMPDIR/a" && pwd -P)
	repo_b=$(cd "$BATS_TEST_TMPDIR/b" && pwd -P)
	mkdir -p "$(STATE)"
	printf 'exclude\t%s\t.claude/worktrees/\nexclude\t%s\t.claude/worktrees/\n' "$repo_a" "$repo_b" >"$(STATE)/manifest.tsv"
	echo '.claude/worktrees/' >>"$repo_a/.git/info/exclude"
	echo '.claude/worktrees/' >>"$repo_b/.git/info/exclude"
	git -C "$repo_b" worktree add -q -b thread/open "$repo_b/.claude/worktrees/open"
	run "$INSTALL" --uninstall --purge
	[ "$status" -eq 0 ]
	! grep -qxF '.claude/worktrees/' "$repo_a/.git/info/exclude" || false
	grep -qxF '.claude/worktrees/' "$repo_b/.git/info/exclude"
	[[ "$output" == *"$repo_b still has threads"* ]] || false
}

@test "uninstall keeps a symlinked profile a symlink" {
	echo 'before' >"$HOME/dotfiles-zshrc"
	ln -s "$HOME/dotfiles-zshrc" "$HOME/.zshrc"
	SHELL=/bin/zsh "$INSTALL" --add-path
	SHELL=/bin/zsh run "$INSTALL" --uninstall
	[ "$status" -eq 0 ]
	[ -L "$HOME/.zshrc" ]
	[ "$(cat "$HOME/dotfiles-zshrc")" = "before" ]
}

@test "uninstall leaves a profile alone when the end marker is missing" {
	SHELL=/bin/zsh "$INSTALL" --add-path
	grep -vxF '# <<< wakemux <<<' "$HOME/.zshrc" >"$HOME/z" && mv "$HOME/z" "$HOME/.zshrc"
	echo 'keep me' >>"$HOME/.zshrc"
	SHELL=/bin/zsh run "$INSTALL" --uninstall
	[ "$status" -eq 0 ]
	[[ "$output" == *"left $HOME/.zshrc unchanged"* ]] || false
	grep -qxF 'keep me' "$HOME/.zshrc"
}

@test "--purge ignores manifest rows that point anywhere but the settings file" {
	mkdir -p "$(STATE)"
	echo victim >"$HOME/victim"
	printf 'created\t%s\n' "$HOME/victim" >"$(STATE)/manifest.tsv"
	run "$INSTALL" --uninstall --purge
	[ "$status" -eq 0 ]
	[ -f "$HOME/victim" ]
}
