# Codex Migrate for BB

Preview and import explicitly selected local Codex folders and conversations through BB's public external history API. The sidebar shows routing, existing matches, conversation checkboxes, content limitations and durable progress. Shared folder paths are selected together and imported once. Import and session binding never send a prompt or start a model.

## Requirements and local installation

This development branch requires BB 0.44.0 from `aotd1/bb` external-history-api, audited at commit `58ec5843077c8e060168911f0877d1220e41c05b`, with **runtime Plugin SDK >=0.6.10**. Vanilla BB with SDK 0.5.29 cannot run this version. SDK 0.6.10 of this fork is not published to npm: the dependency is pinned to the checked-in public package [vendor-sdk](vendor-sdk/README.md), with checksum and provenance. Do not replace it with npm `latest`, a private core import or a lower SDK floor.

The BB server must run on the machine containing the selected Codex source, with its primary host identifying that machine. The importer reads `CODEX_HOME/state_5.sqlite` (or `~/.codex/state_5.sqlite`), projections and rollouts read-only. Install Git and a Codex CLI supporting `codex app-server`; use `CODEX_CLI` for an explicit executable path. A registered **Codex provider** and a ready same-project environment on the source host are required for interactive continuation, separately from reading Codex source history.

This branch has not been released or published. Build the dedicated checkout:

```sh
cd /Users/aotd/Documents/Projects/bb-plugin-codex-migrate-api
npm ci
npm run typecheck
npm test
bb plugin build
# Install this checkout when you choose to replace the installed plugin:
bb plugin install .
```

The previous `v0.3.13` release uses the old adapter; it does not contain this API migration. No release tag or main-branch update is implied by these instructions.

## Use

```sh
bb codex-migrate scan
bb codex-migrate scan --project my-project --json
bb codex-migrate scan --folder /path/to/repository --json
bb codex-migrate apply --project my-project --thread SOURCE_SESSION_ID --json
bb codex-migrate apply --folder /path/to/repository --limit 10
bb codex-migrate apply --project my-project --existing-only
bb codex-migrate apply --project standalone-folder --init-git
bb codex-migrate status --json
bb codex-migrate bind --bb-project proj_example --thread SOURCE_SESSION_ID --environment env_example
bb codex-migrate release --bb-project proj_example --thread SOURCE_SESSION_ID
```

`apply` requires `--project`, `--folder`, or explicit `--all`. Optional repeated `--thread` IDs restrict conversations inside those folders; omitted thread IDs select all their conversations. The UI lets you deselect conversations after preview. `--existing-only` restricts the selection to bound or legacy candidate threads and performs API replay/adoption; it can append newly finalized history. `--limit N` caps new conversations. Existing IDs are always re-read and reconciled, so rerunning the same selection can finish a partial migration.

Folder routing is unchanged: Git subfolders and worktrees route to the main repository; independent nested repositories and submodules remain separate. Multi-root projects produce independent targets per repository. Matching projects are found through SDK sources on the source host. Ambiguous projects, duplicate session claims and conversations in another BB project conflict rather than being moved or duplicated. Standalone non-Git folders require the explicit `git init` choice; missing folders block the selected import.

## History, retries and continuation

Completed turns preserve user/assistant text, plans, reasoning summary/content, tools, commands and file changes. Commands and file changes are historical descriptions and execute nothing. Source turn times are retained in milliseconds. If Codex omits item timestamps, item times are derived deterministically within the source turn; missing turn times use a deterministic creation-time fallback. Titles use the Codex chat name, falling back to the first message. Local title settings affect new imports only; the full source title is searchable up to the API's 4096-character limit. Displayed titles cap at 512 characters; exceeding these limits is reported. Existing manual titles and timestamps are not overwritten.

Stable turn IDs/orders, semantic fingerprints and cached project-upload references exist before the first history write. Batches retain whole turns and respect **500 terminal items / 1 MiB UTF-8 JSON**, **100 items per turn**, **128000 characters per text**, and **32 user attachments**. Oversized turns/texts fail without splitting or truncating content. Exact replays skip; edited known IDs, shifted ordering or backfill behind the cursor conflict. Source compaction/truncated history is never an implicit generation reset. This importer does not perform automatic source resets.

Each history request is atomic, but a multi-batch conversation or multi-conversation run is **not one transaction**. A failure can leave committed batches. Per-batch receipts, conversation fingerprints, upload results, run status and reports use plugin-owned SDK storage. After a lost response, rerun the same selection: replay includes the overlap and core deduplicates the committed IDs. Reloaded running status becomes `interrupted`; no automatic background import of user history occurs.

User images/files are uploaded through `sdk.projects.attachments.upload`; core acquires ownership with the history batch. Missing temporary images can be recovered from source rollouts. Unavailable files and remote URLs become an explicit `[Attachment unavailable: …]` marker and a partial report. Upload outcomes are pinned for immutable retry semantics; later recovery cannot silently rewrite an already imported turn. Legacy attachment references are reused only after source bytes match a public attachment read.

New archived conversations import as passive history and are then archived through SDK. Already archived BB threads remain archived. Existing interactive threads are never automatically archived/released/unarchived. Active turns, queued work and inflight context changes are conflicts; the importer never interrupts them.

For unarchived conversations, the importer separately binds the original Codex resume handle to an unambiguous ready environment on the source host. Bind uses generation/session CAS and starts no runtime; a subsequent ordinary user send resumes that handle. Existing adopted interactive bindings keep their environment and provider/session identity. Exact BB-owned source turns are acknowledged with existing sequences rather than copied; ambiguous or mismatching reconciliation conflicts.

**Current core gap:** public SDK has no standalone provisioning operation that creates a ready project checkout without a thread send/spawn. For a new project with no ready environment, history is saved passively and the report says `Codex continuation pending`. Core confirmed this gap in thread `thr_sbs4wm9872`. Once a suitable ready environment exists, the explicit `bind` command enables continuation. `release` requests a settled idle release; failures/retained active turns remain bound. Unarchive explicitly before bind/release if needed. Archived Codex sessions may also need to be unarchived in Codex before later continuation.

## Legacy imports and content boundaries

There is no BB database adapter, backup operation or repair command. BB projects, threads, identities, events, uploads, search and environment state are accessed only through public SDK/server contracts. `better-sqlite3` is used exclusively for the read-only Codex source and source-only test fixtures; plugin-owned storage is sanctioned by SDK.

Legacy candidates are enumerated through paginated public lists and identity events, including archives. Content and canonical times are read through public events (**100 per page**) and verified before `adoptThreadId`/`existingSequence` acknowledgement. Core independently validates identity/content/time atomically. Safe matches preserve thread IDs, provider/session identities, titles, times, archives and attachment ownership. Archived adoption adds no events. Duplicate candidates, changed session identities, mismatches and invalid legacy rows conflict; the importer never selects an arbitrary first match or creates a replacement silently.

Known old `toolCall.error:null` events cannot be repaired by external history import. They must remain an explicit conflict until core provides an appropriate public repair operation. The former CLI/RPC `repair` is removed. Normalizing nullable source tool errors for a new semantic import does not rewrite old BB events.

Streaming, unfinished turns/items, approvals, provider extensions, compaction markers, web-search/image-view specialized items and unknown user content are outside the typed contract. Preview/report names them; a conversation with omissions or pending continuation is `partiallyImported`, not a complete migration. CLI returns nonzero for partial/failed/conflicting outcomes while retaining the report.

See [API contract](docs/external-history-contract.md) and [verification](VERIFICATION.md) for implementation boundaries and checks.
