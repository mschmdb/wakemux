# Contributing

Issues and pull requests are welcome. See the maintenance note in the [README](README.md) for what to expect.

## Before you open a pull request

Run the checks that CI runs:

```sh
claude plugin test .           # the Claude Code mod in hooks/
claude plugin validate .
bats tests                     # bin/wakemux and install.sh (brew install bats-core)
shellcheck bin/wakemux install.sh
```

The script tests use a stub for cmux, so they run without cmux. Testing a change live needs macOS, cmux and Claude Code; `claude --plugin-dir .` loads your working copy for one session.

## Rules

- One topic per pull request.
- Write the failing test first, then the change. Test edge cases, not only the happy path.
- Code, comments, docs and commit messages are in English. Commit messages use the imperative mood ("Add config loader").
- Settings are validated twice, in `hooks/config.ts` and `lib/config.py`. Change both together.
- Keep files under about 500 lines.

[AGENTS.md](AGENTS.md) holds the same rules for AI coding agents.
