# Limitations

- **macOS and cmux only.** wakemux uses cmux workspaces, workspace groups and agent messages. It does not support tmux or other terminals.
- **Claude Code only,** for the main session and for threads.
- **Versions:** developed and tested with cmux 0.65.2 and Claude Code 2.1.319 on macOS. The author has not tried other versions.
- **Depends on the Claude Code mod API.** The report-back, the pane and the sidebar pill run as a Claude Code hooks module. The type declarations Claude Code 2.1.319 ships for this API call it early access that may change between releases.
- **Threads pause while the computer sleeps.** They are local processes.
- **Reports are capped** at `reportMaxBytes` (default 30000 bytes). A longer answer is cut, with a note that the rest is in the thread. A forwarded report carries a short extra note.
- **The script needs `git`, `python3` and `lsof`.**
- **Dev layout:** pnpm, npm and bun only. Yarn and other setups need `devCommand`.
- **One delivery case is untested live.** Reports to idle and busy main sessions, the Claude Code fallback and the notifications ran live on the author's Mac. A main session whose cmux poller has died is covered only by tests with faked answers.
