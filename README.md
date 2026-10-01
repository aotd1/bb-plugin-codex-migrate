# Codex Migrate for BB

Imports local Codex projects and chat history into BB 0.44. Open **Codex migration** in the BB sidebar to preview and select folders. The **All** checkbox starts selected. A folder listed in several Codex projects has linked checkboxes and is imported only once. The All row and each folder show a progress bar and counts for the latest run: chats added in that run, partially imported because an attachment was unavailable, already in BB, and empty records skipped. The finished result remains visible when the page is reopened. The page also polls saved status every five seconds while open.

## Requirements

- BB 0.44 and the local Codex data on the same machine as the BB server. The plugin reads `CODEX_HOME/state_5.sqlite` when `CODEX_HOME` is set, otherwise `~/.codex/state_5.sqlite`.
- A separately installed Codex CLI that supports `codex app-server`. Make `codex` available to the BB server on `PATH`, or set `CODEX_CLI` to its absolute executable path in the BB server environment.
- Git on the BB server machine, used to identify repository roots and for the optional `git init` flow.

The bundled BB Codex provider is not required; this plugin reads Codex data directly. These tools are system prerequisites, not npm package dependencies. The plugin reports a missing Codex CLI when it first needs `codex app-server`.

## Install

Install the released plugin from GitHub:

```sh
bb plugin install git:https://github.com/aotd1/bb-plugin-codex-migrate.git@^0.3.12
```

To build and install a local checkout instead:

```sh
npm install
bb plugin build
bb plugin install .
```

## Use

```sh
bb codex-migrate scan
bb codex-migrate scan --project my-project --json
bb codex-migrate scan --folder /path/to/repository --json
bb codex-migrate apply --project my-project --existing-only
bb codex-migrate apply --project another-project
bb codex-migrate apply --folder /path/to/repository
bb codex-migrate apply --project standalone-folder --init-git
bb codex-migrate status --json
bb codex-migrate repair --bb-project proj_example --json
```

`scan` without a selector lists projects. CLI `apply` requires `--project`, `--folder`, or an explicit `--all`; it never imports every project by default. Normal `apply` skips IDs already in BB; `--existing-only` verifies their message counts and archive state without adding chats. `--limit N` caps new chats in one run; rerun the same command to continue. Existing Codex source IDs are matched through BB's `thread/identity` events, so reruns do not duplicate them. `status` shows the active run, its last update, and the last completed report. If BB restarts during a run, the status becomes `interrupted`; repeat the same selection to continue.

Imported chat titles use Codex's chat name when present, falling back to its first-message title, and are shortened to 80 characters by default. In **Settings → Installed plugins → Codex Migrate**, set **Imported chat titles** to `original` to preserve the full title, or change **Maximum title length** (30–200). Shortening runs locally and does not send chat content to an AI service. The full source title stays in search. Changing the setting affects new imports; `bb codex-migrate repair --bb-project ID` applies it to existing chats when needed and replaces old first-message titles with Codex names. Repair also removes invalid `error: null` fields written by older importer versions, which prevented some timelines from loading. It creates a SQLite backup before changing BB and does not import new chats. The repair command accepts explicit `--project`, `--folder`, `--bb-project`, or `--all` selection. It preserves manually renamed titles.

## Projects with several directories

Each selected Codex folder is resolved to its Git repository. A folder inside a repository routes to the parent repository's BB project; a nested independent repository or submodule routes to its own BB project. Chats from a Git worktree route to the main repository's BB project. A multi-folder Codex project is treated as several folder selections. Repeated folder paths share one selection state and are imported once. The importer reuses a BB project with the same repository path or creates one when needed.

A folder outside every Git repository shows a warning and a checked **Initialize Git and import this folder** checkbox in the preview. Clearing it skips that folder. The CLI requires `--init-git` to import standalone non-Git folders; this runs `git init` without creating a commit or remote. Missing folders and chats already imported into a different BB project block the affected import. Existing chats are never silently moved from a BB subfolder project to the parent repository project.

Before the first BB write, the importer creates a backup under BB's `plugins/codex-migrate/backups/`. Imported chats preserve their Codex archive state. Codex itself is not archived, unarchived, or deleted. An archived Codex session may need to be unarchived in Codex before continuing its BB copy.

## Compatibility

This first release uses a version-gated BB 0.44 SQLite adapter because BB's public Plugin SDK cannot yet import historical thread events. It checks the required schema and writes each thread in one transaction. Install it only on the declared BB version range. A future BB import API should replace `bb-store.ts`.

The plugin imports text, timeline items, and available image and file attachments. If an old temporary image path is gone, it looks for the exact path and image bytes in the same Codex rollout, then in rollouts from the same source folder. If the bytes are no longer available, the rest of the chat is imported, the attachment becomes an `[Attachment unavailable: PATH]` text marker, and the report counts the chat as `partially imported`. A Codex `thread/read` call that hangs is stopped after 60 seconds; the importer uses Codex's local history projection only when it covers the complete source rollout. When paginated history rejects `thread/read`, the importer reconstructs the chat from the complete local rollout. A missing rollout is counted as empty only when Codex metadata and the local history index both confirm that the record has no content. The sidebar may need a refresh after imported threads are written because this adapter cannot emit BB's internal thread notifier.
