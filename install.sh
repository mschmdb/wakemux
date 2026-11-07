#!/usr/bin/env bash
# Installs wakemux from this clone without a marketplace, and removes it again.
#
#   ./install.sh            link the clone into the Claude Code skills folder and
#                           bin/wakemux into ~/.local/bin (skip the latter with --no-bin)
#   ./install.sh --add-path add ~/.local/bin to PATH in your shell profile, in a marked block
#   ./install.sh --uninstall [--purge]
#                           remove the links and the PATH block; --purge also restores or
#                           removes the settings file and takes wakemux's lines out of
#                           each repository's .git/info/exclude
#
# Every file wakemux changes is noted in $XDG_STATE_HOME/wakemux/manifest.tsv (default
# ~/.local/state/wakemux), with a backup of the original, so --purge can undo it.
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
skills="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills"
plugin_link="$skills/wakemux"
bin_link="$HOME/.local/bin/wakemux"
if [[ ${XDG_STATE_HOME:-} == /* ]]; then state="$XDG_STATE_HOME/wakemux"; else state="$HOME/.local/state/wakemux"; fi
manifest="$state/manifest.tsv"
block_start="# >>> wakemux >>>"
block_end="# <<< wakemux <<<"

die() { echo "install.sh: $*" >&2; exit 1; }

usage() {
	cat <<'EOF'
Usage: ./install.sh [--no-bin]
       ./install.sh --add-path
       ./install.sh --uninstall [--purge]

Install links this clone into the Claude Code skills folder (${CLAUDE_CONFIG_DIR:-~/.claude}/skills/wakemux)
and bin/wakemux into ~/.local/bin. --add-path adds ~/.local/bin to PATH in your shell profile.
--uninstall removes the links and the PATH block. --purge also restores your settings file to
how it was before wakemux, and removes wakemux's lines from .git/info/exclude in repositories
without open threads. Start a new Claude Code session afterwards.
EOF
}

record() {
	local line field
	# One row per line, fields split by tabs: a field holding either would forge rows.
	for field in "$@"; do
		[[ $field != *$'\t'* && $field != *$'\n'* && $field != *$'\r'* ]] || die "refusing to record a path with a tab or line break: $field"
	done
	line=$(printf '%s\t' "$@")
	line=${line%$'\t'}
	mkdir -p "$state"
	grep -qxF -- "$line" "$manifest" 2>/dev/null || echo "$line" >>"$manifest"
}

# Fails unless the path is free or already the same link. Never replaces anything else.
check_free() {
	local target=$1 path=$2
	if [ -L "$path" ]; then
		[ "$(readlink "$path")" = "$target" ] && return 0
		die "$path already exists and points to $(readlink "$path"); remove it first"
	fi
	[ ! -e "$path" ] || die "$path already exists; remove it first"
}

link() {
	local target=$1 path=$2
	[ -L "$path" ] && return 0
	mkdir -p "$(dirname "$path")"
	ln -s "$target" "$path"
	echo "linked $path -> $target"
}

unlink_own() {
	local target=$1 path=$2
	if [ -L "$path" ] && [ "$(readlink "$path")" = "$target" ]; then
		rm "$path"
		echo "removed $path"
	elif [ -e "$path" ] || [ -L "$path" ]; then
		echo "left $path in place: it is not a link to this clone"
	fi
}

profile_path() {
	case ${SHELL:-} in
	*/bash) echo "$HOME/.bash_profile" ;;
	*) echo "$HOME/.zshrc" ;;
	esac
}

add_path() {
	local profile
	profile=$(profile_path)
	if grep -qxF -- "$block_start" "$profile" 2>/dev/null; then
		echo "$profile already has the wakemux PATH block"
		return
	fi
	if [ -e "$profile" ]; then
		mkdir -p "$state/backups"
		local copy
		copy="$state/backups/$(basename "$profile").$(date +%Y%m%d-%H%M%S)"
		cp -p "$profile" "$copy"
		record backup "$profile" "$copy"
	fi
	# shellcheck disable=SC2016 # $HOME and $PATH belong in the profile unexpanded.
	printf '\n%s\nexport PATH="$HOME/.local/bin:$PATH"\n%s\n' "$block_start" "$block_end" >>"$profile"
	record profile "$profile"
	echo "added ~/.local/bin to PATH in $profile; open a new terminal to use it"
}

# Removes only the marked block, so lines added to the profile since then stay.
remove_block() {
	local profile=$1 cleaned
	[ -f "$profile" ] && grep -qxF -- "$block_start" "$profile" || return 0
	# Every start marker needs its end marker, else the rest of the profile would go.
	if ! awk -v start="$block_start" -v end="$block_end" '
		$0 == start { if (open) bad = 1; open = 1 }
		$0 == end { if (!open) bad = 1; open = 0 }
		END { exit (bad || open) ? 1 : 0 }' "$profile"; then
		echo "left $profile unchanged: its wakemux block markers do not match; remove the block by hand"
		return 0
	fi
	# Drops the block and the blank line that --add-path put before it.
	cleaned=$(awk -v start="$block_start" -v end="$block_end" '
		$0 == start { if (count > 0 && kept[count] == "") count--; skip = 1; next }
		skip { if ($0 == end) skip = 0; next }
		{ kept[++count] = $0 }
		END { for (i = 1; i <= count; i++) print kept[i] }
	' "$profile")
	# Written in place, so a symlinked profile stays a link and keeps its permissions.
	printf '%s\n' "$cleaned" >"$profile"
	echo "removed the wakemux PATH block from $profile"
}



remove_exclude() {
	local repo=$1 pattern=$2 exclude open
	# Only what wakemux new records: a repository and a relative folder pattern.
	[[ $pattern == */ && $pattern != /* ]] || return 0
	git -C "$repo" rev-parse --git-dir >/dev/null 2>&1 || return 0
	exclude="$repo/.git/info/exclude"
	[ -f "$exclude" ] || return 0
	open=$(git -C "$repo" worktree list --porcelain 2>/dev/null |
		awk -v prefix="worktree $repo/$pattern" 'index($0, prefix) == 1 { n++ } END { print n + 0 }')
	if [ "$open" -gt 0 ]; then
		echo "left $pattern in $exclude: $repo still has threads"
		return
	fi
	local kept status=0
	kept=$(grep -vxF -- "$pattern" "$exclude") || status=$?
	# grep exits 1 when no line is left; anything above means it could not read the file.
	if [ "$status" -gt 1 ]; then
		echo "left $exclude unchanged: could not read it"
		return 0
	fi
	printf '%s\n' "$kept" >"$exclude"
	echo "removed $pattern from $exclude"
}

uninstall() {
	local purge=$1 kind path extra
	unlink_own "$root" "$plugin_link"
	unlink_own "$root/bin/wakemux" "$bin_link"
	[ -f "$manifest" ] || return 0
	while IFS=$'\t' read -r kind path extra; do
		if [ "$kind" = profile ]; then remove_block "$path"; fi
	done <"$manifest"
	[ "$purge" = 1 ] || {
		echo "kept your settings; run with --purge to restore them as well"
		return 0
	}
	while IFS=$'\t' read -r kind path extra; do
		if [ "$kind" = exclude ]; then remove_exclude "$path" "$extra"; fi
	done <"$manifest"
	# The settings file and the state folder go through the same lock as wakemux config set.
	XDG_STATE_HOME="$(dirname "$state")" python3 -I "$root/lib/config.py" purge
}

mode=install bin=1 purge=0
while [ $# -gt 0 ]; do
	case $1 in
	--uninstall) mode=uninstall ;;
	--purge) purge=1 ;;
	--add-path) mode=add-path ;;
	--no-bin) bin=0 ;;
	-h | --help) usage; exit 0 ;;
	*) die "unknown option: $1" ;;
	esac
	shift
done
[ "$purge" = 0 ] || [ "$mode" = uninstall ] || die "--purge only works with --uninstall"

case $mode in
uninstall) uninstall "$purge"; exit 0 ;;
add-path) add_path; exit 0 ;;
esac

# Check both places first, so a conflict leaves nothing half installed.
check_free "$root" "$plugin_link"
[ "$bin" = 0 ] || check_free "$root/bin/wakemux" "$bin_link"
link "$root" "$plugin_link"
if [ "$bin" = 1 ]; then
	link "$root/bin/wakemux" "$bin_link"
	case ":$PATH:" in
	*":$HOME/.local/bin:"*) ;;
	*) echo "note: ~/.local/bin is not on your PATH; ./install.sh --add-path adds it to your shell profile" ;;
	esac
fi
echo "Done. Start a new Claude Code session to load wakemux."
