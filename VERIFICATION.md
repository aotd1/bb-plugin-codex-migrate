# Verification of the API migration

Checked 2026-10-03 in `/Users/aotd/Documents/Projects/bb-plugin-codex-migrate-api`, branch `codex-migrate-bb-history-api`, based on `origin/main` `f136cd8613ae999b06137e3bc19fdace059764b8` (v0.3.13). No release/version bump, push or installation was performed. The original installed checkout was not modified.

## Completed checks

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed, backend and app against vendored SDK 0.6.10 |
| `npm test` | 40 passed, 0 failed |
| `bb plugin build` | Passed; server/app artifacts generated |
| Built metadata + installed dependency assertions | Both SDK 0.6.10, built with BB 0.44.0, plugin ID codex-migrate |
| SDK tarball checksum | Matches documented SHA-256 and local dependency/lock pin |
| Public SDK scanner | No violations or private dependencies |
| BB DB-path / private import / SQL-adapter scan | No execution paths; only negative assertion patterns in tests |
| `git diff --check` | Passed |

The plugin tests cover full replay, repeated batches, a response lost after commit followed by resume, whole rich semantic turns, source identity/order/time, deterministic title handling, upload caching and missing attachment markers, verified legacy attachment reads, atomic invalid batch rejection, prevalidation of later batches, whole-turn/text/batch limits, explicit unsupported and unfinished content, archive-before-bind policy and archived replay, matching/ambiguous/conflicting/invalid legacy rows, changed claims, active/queued/context conflicts, ready environment ambiguity/lifecycle, BB-owned sequence acknowledgements, original Codex handle, explicit bind/release CAS, folder/conversation selection, routing/shared roots/multiple repositories, partial reports and reload/interrupted progress. Source Codex databases are disposable source-only fixtures. BB behavior is supplied by the public SDK fake host; no plugin test opens or writes a BB database.

## Core contract evidence

Separately ran the existing core tests in the read-only checkout at `58ec5843077c8e060168911f0877d1220e41c05b`:

```sh
# From the core checkout's apps/server directory:
../../node_modules/.bin/vitest run --config vitest.config.ts \
  test/public/public-external-history.test.ts \
  test/public/public-external-session.test.ts
```

**2 files / 21 tests passed.** Core's own isolated harness validates shared timeline/search projections, rich completed turns/uploads and atomic ownership, source timestamps/title seeds, invalid batches/conflicts, namespace attribution, exact legacy adoption (including archives), BB-owned acknowledgement, settled bind/release and retained active work. These tests exercise fixture runtimes, not real provider/model requests. The core checkout remained at the audited commit with a clean git status. No core source or BB application was edited.

This is separate core contract evidence and plugin fake-SDK evidence, not an installed-plugin live migration test. No real user history was imported and no provider prompt was sent as an automatic test. Provider bridge code/contracts were not changed, so no new bridge conformance scope was introduced.

## SDK and readiness limits

`bb --version` reports 0.44.0. `bb plugin types --check` identifies host SDK 0.6.10 but warns because its comparison expects the literal npm version `0.6.10` rather than the intentional `file:vendor-sdk/...` dependency. The dependency is retained: this fork SDK is not published to npm. Package/declarations/provenance and both artifact metadata versions were checked instead. Build also emits Node's existing module.register deprecation warning; it exits successfully.

The local artifacts are ready for installation on the matching external-history fork. Installation/reload and a user-selected real migration remain unperformed. The main installed plugin still uses its prior checkout/version until explicitly replaced.

Core thread `thr_sbs4wm9872` confirmed and recorded the standalone ready-environment provisioning gap: a newly imported passive thread cannot be bound when no ready environment exists, and neither restoreEnvironment nor scheduled/dummy spawn is an acceptable workaround. History remains saved and the report shows continuation pending. Existing ready environments can be bound explicitly, without model launch. Public lifecycle flags are used for preliminary filtering; core checks ownership atomically.

Known invalid legacy nullable tool errors are explicit conflicts; no repair API or SQL workaround is present. Unsupported specialized content is named in preview/report. Multiple batches may be committed before an error; rerun the same selection for API replay. Automatic reset/generation migration and arbitrary-provider reconciliation are outside this importer.
