#!/usr/bin/env bash
# Installs wakemux from this clone without a marketplace:
#   - links the clone into the Claude Code skills folder, where it loads as a plugin
#   - links bin/wakemux into ~/.local/bin for use in your own shell (skip with --no-bin)
# --uninstall removes those links again, and nothing else.
set -euo pipefail

root=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
skills="${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills"
plugin_link="$skills/wakemux"
bin_link="$HOME/.local/bin/wakemux"

die() { echo "install.sh: $*" >&2; exit 1; }

usage() {
	cat <<'EOF'
Usage: ./install.sh [--no-bin]
       ./install.sh --uninstall

Links this clone into the Claude Code skills folder (${CLAUDE_CONFIG_DIR:-~/.claude}/skills/wakemux)
and bin/wakemux into ~/.local/bin. Start a new Claude Code session afterwards.
EOF
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

mode=install bin=1
while [ $# -gt 0 ]; do
	case $1 in
	--uninstall) mode=uninstall ;;
	--no-bin) bin=0 ;;
	-h | --help) usage; exit 0 ;;
	*) die "unknown option: $1" ;;
	esac
	shift
done

if [ "$mode" = uninstall ]; then
	unlink_own "$root" "$plugin_link"
	unlink_own "$root/bin/wakemux" "$bin_link"
	exit 0
fi

# Check both places first, so a conflict leaves nothing half installed.
check_free "$root" "$plugin_link"
[ "$bin" = 0 ] || check_free "$root/bin/wakemux" "$bin_link"
link "$root" "$plugin_link"
if [ "$bin" = 1 ]; then
	link "$root/bin/wakemux" "$bin_link"
	case ":$PATH:" in
	*":$HOME/.local/bin:"*) ;;
	*) echo "note: ~/.local/bin is not on your PATH; add it to use wakemux in your own shell" ;;
	esac
fi
echo "Done. Start a new Claude Code session to load wakemux."
