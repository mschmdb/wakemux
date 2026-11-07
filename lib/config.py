"""wakemux settings for the shell script: resolve, set and unset.

Validation matches hooks/config.ts; change both together. Precedence, highest first:
WAKEMUX_<KEY> environment variables, .wakemux.json in the repository, the user's
config.json, defaults. The script cannot see the plugin's userConfig options.

  config.py resolve <repo>     shell assignments for bin/wakemux; warnings on stderr
  config.py set <key> <value>  writes the user's config.json, backs it up first
  config.py unset <key>        removes a key from the user's config.json
"""

import fcntl
import json
import os
import re
import shlex
import shutil
import sys
import tempfile
import time


def warn(text):
    print(f"wakemux: warning: {text}", file=sys.stderr)


def fail(text):
    print(f"wakemux: {text}", file=sys.stderr)
    sys.exit(1)


def base_dir(variable, fallback):
    value = os.environ.get(variable, "")
    if value.startswith("/"):
        return value.rstrip("/")
    home = os.environ.get("HOME", "")
    return f"{home.rstrip('/')}/{fallback}" if home else ""


USER_FILE = f"{base_dir('XDG_CONFIG_HOME', '.config')}/wakemux/config.json"
STATE_DIR = f"{base_dir('XDG_STATE_HOME', '.local/state')}/wakemux"


def inside_path(value):
    if re.search(r"[\x00-\x1f\x7f]", value):
        return False
    trimmed = value.rstrip("/")
    if trimmed == "" or trimmed.startswith("/"):
        return False
    return all(part not in ("", ".", "..") for part in trimmed.split("/"))


def ref_prefix(value):
    if value == "" or value.startswith("/") or value.startswith("-"):
        return False
    if re.search(r"[\s~^:?*\[\\\x00-\x1f\x7f]|\.\.|@\{|//", value):
        return False
    parts = value.split("/")
    return all(not part.startswith(".") for part in parts) and all(
        part != "" and not part.endswith(".lock") and not part.endswith(".") for part in parts[:-1]
    )


ORG = re.compile(r"[A-Za-z0-9][A-Za-z0-9-]{0,38}")

# key: (environment variable, kind, check, default)
SPEC = {
    "worktreeDir": ("WAKEMUX_WORKTREE_DIR", "string", inside_path, ".claude/worktrees"),
    "branchPrefix": ("WAKEMUX_BRANCH_PREFIX", "string", ref_prefix, "thread/"),
    "copyFiles": ("WAKEMUX_COPY_FILES", "list", lambda v: all(inside_path(p) for p in v), [".env"]),
    "devLayout": ("WAKEMUX_DEV_LAYOUT", "string", lambda v: v in ("auto", "off"), "auto"),
    "devCommand": ("WAKEMUX_DEV_COMMAND", "string", lambda v: True, ""),
    "report": ("WAKEMUX_REPORT", "boolean", lambda v: True, True),
    "reportMaxBytes": ("WAKEMUX_REPORT_MAX_BYTES", "number", lambda v: 1000 <= v <= 32000, 30000),
    "prRequiredOrgs": ("WAKEMUX_PR_REQUIRED_ORGS", "list", lambda v: all(ORG.fullmatch(o) for o in v), []),
    "mergePolicy": ("WAKEMUX_MERGE_POLICY", "string", lambda v: v in ("repo-rules", "pr", "merge"), "repo-rules"),
    "scriptPath": ("WAKEMUX_SCRIPT_PATH", "string", lambda v: v.startswith("/") and ".." not in v.split("/"), ""),
    "maxThreads": ("WAKEMUX_MAX_THREADS", "number", lambda v: 0 <= v <= 100, 4),
    "maxHops": ("WAKEMUX_MAX_HOPS", "number", lambda v: 0 <= v <= 100, 6),
    "prStatus": ("WAKEMUX_PR_STATUS", "boolean", lambda v: True, True),
    "crossReview": ("WAKEMUX_CROSS_REVIEW", "string", lambda v: re.fullmatch(r"[a-z][a-z0-9-]*", v) is not None, "off"),
}

# The mod runs scriptPath without asking, so a cloned repository must not choose it.
USER_ONLY = {"scriptPath"}

TRUE, FALSE = {"1", "true", "yes", "on"}, {"0", "false", "no", "off"}


def from_text(kind, text):
    if kind == "list":
        return [item for item in re.split(r"[\s,]+", text.strip()) if item]
    if kind == "number":
        return int(text) if re.fullmatch(r"\s*-?\d+\s*", text) else text
    if kind == "boolean":
        lower = text.strip().lower()
        return True if lower in TRUE else False if lower in FALSE else text
    return text


def has_kind(kind, value):
    if kind == "list":
        return isinstance(value, list) and all(isinstance(item, str) for item in value)
    if kind == "number":
        return isinstance(value, int) and not isinstance(value, bool)
    if kind == "boolean":
        return isinstance(value, bool)
    return isinstance(value, str)


def accept(key, value):
    """The normalized value, or None when it is invalid."""
    _, kind, check, _ = SPEC[key]
    if kind == "list" and isinstance(value, list):
        value = [item for item in value if item != ""]
    if not has_kind(kind, value) or not check(value):
        return None
    return value.rstrip("/") if key == "worktreeDir" else value


def read_file(path, label, quiet=False):
    if not path or not os.path.exists(path):
        return {}
    try:
        with open(path, encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, ValueError):
        if not quiet:
            warn(f"{label}: not valid JSON, file ignored")
        return None
    if not isinstance(data, dict):
        if not quiet:
            warn(f"{label}: expected a JSON object, file ignored")
        return None
    return data


def display(value):
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, list):
        return " ".join(value)
    return str(value)


def resolve(repo):
    repo_file = (read_file(os.path.join(repo, ".wakemux.json"), ".wakemux.json") or {}) if repo else {}
    user_file = read_file(USER_FILE, "config.json") or {}
    values = {}
    for key, (env_name, kind, _, default) in SPEC.items():
        candidates = []
        env_text = os.environ.get(env_name, "")
        if env_text != "":
            candidates.append((env_name, from_text(kind, env_text)))
        if key in repo_file:
            if key in USER_ONLY:
                warn(f'.wakemux.json: "{key}" can only be set by the user, value ignored')
            else:
                candidates.append((f".wakemux.json {key}", repo_file[key]))
        if key in user_file:
            candidates.append((f"config.json {key}", user_file[key]))
        values[key] = default
        for label, value in candidates:
            accepted = accept(key, value)
            if accepted is not None:
                values[key] = accepted
                break
            warn(f"{label}: invalid value {json.dumps(value)[:60]}, ignored")

    print(f"cfg_worktree_dir={shlex.quote(values['worktreeDir'])}")
    print(f"cfg_branch_prefix={shlex.quote(values['branchPrefix'])}")
    print("cfg_copy_files=(" + " ".join(shlex.quote(item) for item in values["copyFiles"]) + ")")
    print(f"cfg_dev_layout={shlex.quote(values['devLayout'])}")
    print(f"cfg_dev_command={shlex.quote(values['devCommand'])}")
    print(f"cfg_max_threads={values['maxThreads']}")
    print("cfg_lines=(" + " ".join(shlex.quote(f"{key}={display(value)}") for key, value in values.items()) + ")")


def check_fields(*fields):
    # One row per line, fields split by tabs: a field holding either would forge rows.
    if any(re.search(r"[\t\r\n]", field) for field in fields):
        fail("refusing to record a path with a tab or line break")


def record(kind, *fields):
    check_fields(kind, *fields)
    os.makedirs(STATE_DIR, exist_ok=True)
    line = "\t".join((kind,) + fields)
    manifest = os.path.join(STATE_DIR, "manifest.tsv")
    lines = open(manifest, encoding="utf-8").read().splitlines() if os.path.exists(manifest) else []
    if line not in lines:
        with open(manifest, "a", encoding="utf-8") as handle:
            handle.write(line + "\n")


def recorded(path):
    manifest = os.path.join(STATE_DIR, "manifest.tsv")
    if not os.path.exists(manifest):
        return False
    for line in open(manifest, encoding="utf-8").read().splitlines():
        fields = line.split("\t")
        if fields[0] in ("created", "backup") and len(fields) > 1 and fields[1] == path:
            return True
    return False


# Before the first change, keep a copy of the original. The manifest row follows only once the
# write succeeded, so a failed write claims nothing.
def snapshot_original(path):
    if recorded(path):
        return None
    if not os.path.exists(path):
        return ("created", path)
    backups = os.path.join(STATE_DIR, "backups")
    os.makedirs(backups, exist_ok=True)
    handle, copy = tempfile.mkstemp(dir=backups, prefix=f"{os.path.basename(path)}.{time.strftime('%Y%m%d-%H%M%S')}.")
    os.close(handle)
    shutil.copy2(path, copy)
    return ("backup", path, copy)


def lock_state():
    os.makedirs(STATE_DIR, exist_ok=True)
    lock = open(os.path.join(STATE_DIR, "config.lock"), "w", encoding="utf-8")
    fcntl.flock(lock, fcntl.LOCK_EX)
    return lock


def write_user_file(change):
    if not USER_FILE.startswith("/") or not STATE_DIR.startswith("/"):
        fail("cannot find the user config folder: HOME is not set")
    # One writer at a time, uninstall --purge included: read, back up and replace as one step.
    with lock_state():
        data = read_file(USER_FILE, "config.json", quiet=True)
        if data is None:
            fail(f"{USER_FILE} is not a JSON object; fix or remove it first")
        change(data)
        # Checked before the write, so the manifest row cannot fail after the file changed.
        check_fields(USER_FILE, STATE_DIR)
        original = snapshot_original(USER_FILE)
        try:
            folder = os.path.dirname(USER_FILE)
            os.makedirs(folder, exist_ok=True)
            handle, temporary = tempfile.mkstemp(dir=folder, prefix=".config.", suffix=".tmp")
            with os.fdopen(handle, "w", encoding="utf-8") as output:
                json.dump(data, output, indent=2)
                output.write("\n")
            os.replace(temporary, USER_FILE)
        except OSError as error:
            if original and original[0] == "backup":
                os.remove(original[2])
            fail(f"could not write {USER_FILE}: {error}")
        if original:
            record(*original)


def set_key(key, text):
    if key not in SPEC:
        fail(f"unknown setting: {key}")
    value = accept(key, from_text(SPEC[key][1], text))
    if value is None:
        fail(f"invalid value for {key}: {text}")
    write_user_file(lambda data: data.__setitem__(key, value))
    print(f"{key}={display(value)} in {USER_FILE}")


def unset_key(key):
    if key not in SPEC:
        fail(f"unknown setting: {key}")
    write_user_file(lambda data: data.pop(key, None))
    print(f"{key} removed from {USER_FILE}")


# Restores the settings file as it was before wakemux, then removes the state folder.
# Runs under the same lock as config set, so no write lands in between.
def purge():
    manifest = os.path.join(STATE_DIR, "manifest.tsv")
    with lock_state():
        rows = open(manifest, encoding="utf-8").read().splitlines() if os.path.exists(manifest) else []
        for row in rows:
            fields = row.split("\t")
            # Only rows this tool writes, for the settings file, are acted on.
            if len(fields) < 2 or not fields[1].endswith("/wakemux/config.json"):
                continue
            if fields[0] == "backup" and len(fields) == 3 and os.path.isfile(fields[2]):
                shutil.copy2(fields[2], fields[1])
                print(f"restored {fields[1]} from its backup")
            elif fields[0] == "created" and os.path.exists(fields[1]):
                os.remove(fields[1])
                try:
                    os.rmdir(os.path.dirname(fields[1]))
                except OSError:
                    pass
                print(f"removed {fields[1]}")
        shutil.rmtree(STATE_DIR, ignore_errors=True)
        print(f"removed {STATE_DIR}")


def main(argv):
    if len(argv) == 2 and argv[0] == "resolve":
        resolve(argv[1])
    elif len(argv) == 3 and argv[0] == "set":
        set_key(argv[1], argv[2])
    elif len(argv) == 2 and argv[0] == "unset":
        unset_key(argv[1])
    elif len(argv) == 1 and argv[0] == "purge":
        purge()
    elif len(argv) == 3 and argv[0] == "record":
        record("exclude", argv[1], argv[2])
    else:
        fail("usage: config.py resolve <repo> | set <key> <value> | unset <key> | record <repo> <pattern>")


if __name__ == "__main__":
    main(sys.argv[1:])
