---
name: codex-migrate
description: Preview, import and reconcile explicitly selected local Codex folders/conversations through BB external history API; bind or release original Codex sessions.
---

# Codex migration

Use `bb codex-migrate scan` to list source projects. Use `scan --project NAME --json` or `scan --folder PATH --json` for routing, conversation candidates, existing matches, conflicts and content limitations. Preview is read-only; attachments are verified at apply time.

Import only the user's selected projects/folders/conversations:

```sh
bb codex-migrate apply --project NAME --thread SOURCE_SESSION_ID --json
bb codex-migrate apply --folder /selected/folder --json
bb codex-migrate apply --project NAME --existing-only --json
bb codex-migrate status --json
```

Repeated `--thread` IDs restrict conversations inside the selected folders. With no thread restriction, all conversations in selected folders are candidates. Use `--all` only when the user explicitly requested every project. An omitted project/folder selector is an error. `--limit N` caps new conversations. `--existing-only` reconciles existing candidates through replay/adoption and may append newly finalized history.

Rerun the same selection after interruption or lost API responses. Stable IDs, orders, fingerprints and cached upload results prevent duplicate history. Batches are atomic, the entire run is not: earlier batches may already be saved. Inspect partial/failed reports before declaring migration complete. CLI partial outcomes return nonzero. Running progress becomes interrupted on reload; imports do not automatically restart.

Git subfolders/worktrees route to the main repository, independent nested repositories remain separate. Shared folder selections are deduplicated. Non-Git folders need the user's explicit `--init-git` choice (no commit/remote is created). Missing folders, ambiguous claims and existing threads in another BB project remain conflicts.

Supported completed turns contain user/assistant text, plan, reasoning, tool, command and fileChange. Oversized turns cannot be split: 100 items/turn, 500 terminal items/1 MiB JSON per batch, 128000 characters/text, 32 attachments/user. Unsupported specialized items, streaming, approvals, extensions and unfinished content are named in preview/report. Unavailable attachments become explicit markers and a partial result. No model executes historical commands/files.

Safe legacy adoption uses public list/events (100 events/page) and verified existing sequences/timestamps. It keeps thread/session identities and existing archives/titles. Invalid legacy `toolCall.error:null`, mismatching content and ambiguity are conflicts. The repair command is removed; never use SQL, backups, private core imports or attachment ownership changes to repair/adopt BB history. All BB state goes through public SDK/server APIs. Codex source is read-only; plugin state uses sanctioned SDK storage.

Bind the original Codex handle only with a ready environment in its BB project on the source host:

```sh
bb codex-migrate bind --bb-project proj_ID --thread SOURCE_SESSION_ID --environment env_ID
bb codex-migrate release --bb-project proj_ID --thread SOURCE_SESSION_ID
```

These calls use generation/session CAS, start no model and do not interrupt active turns. Active/queued/unsettled work and archives conflict; never silently unarchive or overwrite another session. Failed/retained release keeps the binding. A later ordinary user send resumes the bound Codex session. No automatic source reset/generation change occurs; compaction is not a reset.

A new project without a ready environment remains passive with `Codex continuation pending`: core has no public standalone provisioning operation without sending/spawning a thread. Do not invent bootstrap/dummy providers or prompts to bypass this gap. Existing ready environments can be bound explicitly after import.

Requires the BB 0.44.0 external-history fork and runtime SDK >=0.6.10. Preserve the vendored fork SDK `file:` dependency. Source is the server machine's local `CODEX_HOME` (or ~/.codex), with separately installed Codex CLI and Git. Do not bulk-import real history or send a model prompt as an automatic test.
