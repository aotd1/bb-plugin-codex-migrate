# Verification of the API migration

Checked 2026-10-03 in `/Users/aotd/Documents/Projects/bb-plugin-codex-migrate-api`, branch `codex-migrate-bb-history-api`, based on `origin/main` `f136cd8613ae999b06137e3bc19fdace059764b8` (v0.3.13). No release/version bump, push or installation was performed. The original installed checkout was not modified.

## Completed checks

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed, backend and app against vendored SDK 0.6.11 |
| `npm test` | 45 passed, 0 failed |
| Matching fork CLI `plugin build .` | Passed; server/app artifacts generated without core edits |
| Built metadata + installed dependency assertions | Both SDK 0.6.11, built with BB 0.44.0, plugin ID codex-migrate |
| SDK tarball checksum | Matches documented SHA-256 and local dependency/lock pin |
| Public SDK scanner | No violations or private dependencies |
| BB DB-path / private import / SQL-adapter scan | No execution paths; only negative assertion patterns in tests |
| `git diff --check` | Passed |

The plugin tests cover full replay, repeated batches, a response lost after commit followed by resume, whole rich semantic turns, source identity/order/time, deterministic title handling, upload caching and missing attachment markers, verified legacy attachment reads, atomic invalid batch rejection, prevalidation of later batches, whole-turn/text/batch limits, explicit unsupported and unfinished content, archive-before-bind policy and archived replay, matching/ambiguous/conflicting/invalid legacy rows, changed claims, active/queued/context conflicts, ready environment ambiguity/lifecycle, ensure → bind with all four source CAS fields, ensured checkout retries, source admission/CAS/inspection failures, routed source rather than original Codex worktree, BB-owned sequence acknowledgements, original Codex handle, explicit bind/release CAS, folder/conversation selection, routing/shared roots/multiple repositories, partial reports and reload/interrupted progress. Source Codex databases are disposable source-only fixtures. BB behavior is supplied by the public SDK fake host; no plugin test opens or writes a BB database.

## Core contract evidence

Separately ran the existing core tests in the read-only checkout at `0a4c15ae2eab2ff5fcf05fc69e609bd6243ced90` on Node 22.19.0:

```sh
# From the core checkout's apps/server directory:
/Users/aotd/.npm/_npx/992a19d7d9bf36d4/node_modules/node/bin/node \
  ../../node_modules/vitest/vitest.mjs run --config vitest.config.ts \
  test/public/public-external-history.test.ts \
  test/public/public-external-session.test.ts \
  test/public/public-ensure-project-checkout.test.ts
```

**3 files / 38 tests passed.** Core's own isolated harness validates shared timeline/search projections, rich completed turns/uploads and atomic ownership, source timestamps/title seeds, invalid batches/conflicts, namespace attribution, exact legacy adoption (including archives), BB-owned acknowledgement, settled bind/release and retained active work. The ensure suite additionally exercises actual SDK/HTTP import → ensure → bind, replay/concurrency, source CAS, failed inspection, lifecycle/path claims, alias ownership and notifications. These tests exercise fixture runtimes, not real provider/model requests. The core checkout remained at the audited commit with a clean git status. No core source or BB application was edited.

This is separate core contract evidence and plugin fake-SDK evidence, not an installed-plugin live migration test. No real user history was imported and no provider prompt was sent as an automatic test. Provider bridge code/contracts were not changed, so no new bridge conformance scope was introduced.

## SDK and readiness limits

Installed `bb` remains 0.44.0 / runtime SDK 0.6.10 at main commit 58ec58430. The plugin now requires **>=0.6.11 <0.7**, daemon protocol 225 and the vendored public SDK package packed at 0a4c15ae2. Both artifact metadata files report SDK 0.6.11. Build used the already compiled matching fork CLI, targeting this worktree only:

```sh
env -u BB_CLI node /Users/aotd/.bb/plugins/environment-personal-workspace/host-data/workspaces/thr_sbs4wm9872/bb-core/apps/cli/dist/index.js plugin build .
```

The core test suite initially stopped before any tests due to its Node 22 native SQLite ABI versus Node 26 on PATH. Re-running with the existing cached Node 22.19.0 executable passed all 38 tests, without rebuilding dependencies or modifying core. Build emits Node's existing module.register deprecation warning and exits successfully.

Artifacts are ready for a matching SDK 0.6.11 server/daemon. **Do not install on current main SDK 0.6.10 or make live ensure calls until that application update.** No installation/reload, real migration, model prompt, release or push was performed. The installed plugin and original checkout remain unchanged.

The earlier provisioning gap is closed by `experimental_ensureProjectCheckout` in core 0a4c15ae2. The adapter uses it only when no matching ready environment exists, reading and validating the recorded local project source first. Ensure/bind errors preserve saved history and report continuation pending; no SQL/bootstrap/prompt fallback is present. Existing ready environments and interactive adopted bindings retain the previous behavior. Core remains responsible for atomic source/path admission and bind ownership checks.

Known invalid legacy nullable tool errors are explicit conflicts; no repair API or SQL workaround is present. Unsupported specialized content is named in preview/report. Multiple batches may be committed before an error; rerun the same selection for API replay. Automatic reset/generation migration and arbitrary-provider reconciliation are outside this importer.

## Installed plugin and legacy preview follow-up (2026-10-03)

Matching BB 0a4c15ae2 / runtime SDK 0.6.11 is now installed. Main health, connected primary host, ensure CLI/HTTP surface (invalid request 400), plugin path/enable/running and compatible SDK 0.6.11 UI asset (HTTP 200) were checked through public APIs. Installer startup exceeded its deadline; after the desktop was running, public CLI installation/enable completed. No live ensure, real history import or provider prompt was used as a test.

Read-only full preview reproduced 173 legacy conflicts (172 aggregate item-count differences, one content mismatch). After verified source turn/item layout alignment, preview reports 12: six unmapped extra-event snapshots, four per-turn item-count differences and two content mismatches. The other 161 no longer have a false aggregate count conflict. Unsupported/deferred legacy events remain untouched; only an exact supported subset can be acknowledged with canonical sequences/times. Invalid nullable tool errors still conflict, including in deferred turns. UI shows individual reasons and lets the user explicitly exclude conflicted conversations.

`npm test`: 46 passed, including supported-subset adoption/replay/live+archive preservation and negative source ID/content/extra-event/invalid deferred-tool fixtures. Typecheck, build, public SDK boundary scanner and diff check passed. Plugin rebuilt/reloaded locally; no real import was run. The earlier readiness statements describe the pre-install baseline and are superseded by this section.

## BB 0.45.0 installation compatibility (2026-10-03)

Core PR #1 at f5fb8ae40 is installed as BB 0.45.0, runtime SDK 0.6.16 / daemon protocol 228. Previous engines.bb >=0.44 <0.45 rejected the upgraded core before plugin activation; package and lockfile now use >=0.44 <0.46. SDK floor remains >=0.6.11 <0.7 and the vendored public SDK is unchanged. No runtime API implementation changed.

Typecheck passed. First Node 22 test attempt had native better-sqlite3 ABI mismatch (compiled ABI 147 vs Node 22 ABI 127); tests rerun on the checkout's existing Node 26.9.0 passed: 46 tests, zero failures. bb plugin build and reload codex-migrate passed against the installed SDK 0.6.16. Final plugin status running, statusDetail null; frontend bundle sdkVersion 0.6.16, compatible true. No real source import, reconcile, bind, provider prompt or SQL operation against BB storage was performed by this plugin check. Core installer owns separate installation/data integrity verification. No plugin release/tag or remote push performed.
