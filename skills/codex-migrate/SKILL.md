---
name: codex-migrate
description: Preview and import explicitly selected local Codex projects and chats into BB.
---

# Codex migration

Run `bb codex-migrate scan` to list Codex projects without changing anything.
Run `bb codex-migrate scan --project NAME --json` to inspect the exact chat candidates and existing BB matches.

Import only projects the user explicitly named:

```
bb codex-migrate apply --project NAME
bb codex-migrate apply --project NAME --project OTHER
bb codex-migrate apply --folder /path/to/selected/folder
```

Use `--all` only when the user explicitly asks to import every Codex project. An omitted selector is an error. Never infer `--all` from a request about one or several named projects.

Normal `apply` skips chats already in BB. `--existing-only` re-reads them and checks message counts and archive state without importing additional chats. `--limit N` caps new chat imports per invocation; rerunning is safe and skips existing IDs. `bb codex-migrate status --json` reports the active run, per-folder progress, last update, and last completed report. The All row and each folder show progress bars; their saved status is restored after leaving and reopening the page.

For a Codex project with several roots, inspect `rootDetails` in `scan --json`. Each unique folder is selected once even when it appears in several Codex projects. Git subfolders route to the parent repository's BB project, nested repositories stay separate, and worktrees route to the main repository. A standalone non-Git folder is skipped unless CLI `--init-git` is explicitly supplied or its warning checkbox remains checked in the sidebar preview. Do not move chats already imported into another BB project; these remain blocked for a separate decision.

The plugin reads Codex from the BB server machine's local `CODEX_HOME` or `~/.codex`. It supports BB 0.44 and makes a SQLite backup before any import. BB and Codex must be on the same machine in this version. Archived Codex sessions remain archived; continuing them later may require unarchiving them in Codex.

If a Codex `thread/read` call stalls for 60 seconds, the importer reads the local Codex history projection only after verifying it covers the complete source rollout. It can recover images from archived rollouts by exact source path, including a related thread in the same folder. A record with no rollout is skipped as empty only when its Codex metadata and projected history both confirm it has no content. Other missing source data remains a visible per-chat failure.
