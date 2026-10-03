# Public history adapter contract

Audited core: `aotd1/bb` fork PR #1, external-history-api, `0a4c15ae2eab2ff5fcf05fc69e609bd6243ced90`. Plugin SDK >=0.6.11 <0.7 uses `bb.sdk.threads`; core forces the calling plugin ID.

| Surface | Plugin behavior |
| --- | --- |
| `experimental_findExternalThread` | Durable lookup by target project, `codex-local:<primaryHostId>`, original Codex conversation UUID |
| `experimental_importHistory` | Provider `codex`, session original UUID, generation 0, preserve attention; completed semantic turns only |
| `experimental_bindExternalSession` | Separate explicit CAS binding to original UUID handle and ready same-project/source-host environment |
| `experimental_releaseExternalSession` | User-requested settled release only; core retains binding on failure/active work |
| `threads.list`, `threads.events.list` | Enumerate legacy claims in live/archived lists and public ordered event pages of 100 |
| `projects.list/create`, `environments.list/get` | Public routing and ready environment lookup |
| `projects.attachments.upload/read` | Upload new attachments; verify legacy bytes before reusing canonical references |
| `projects.get`, `environments.experimental_ensureProjectCheckout` | If no ready environment: require one recorded local source on the host with unchanged routing path; ensure with project/host/source ID/path CAS, then bind returned environment ID |
| `threads.archive` | Archive newly passive history after import; existing interactive archives require an explicit user action |
| `bb.storage.kv` | Per-turn semantic fingerprints, upload outcomes, conversation receipts, current/last run |

Turn IDs are `turn:<source turn ID>`. Orders are source snapshot ordinals, not source timestamps. Source turn timestamps convert seconds to integer milliseconds. When item times are absent, interpolation inside turn bounds is deterministic; absent turn times fall back to source thread creation plus ordinal. New snapshots must retain previous IDs, order, content and inferred times. A changed window/order is a conflict, never an automatic reset. Local fingerprints exclude canonical acknowledgements but include all source semantic content/order/time/status.

The adapter prepares complete turns, verifies semantic limits and precomputes all history batch boundaries before any history request. UTF-8 byte accounting includes plugin attribution and envelope. A turn is never split; later invalid content does not cause earlier batches to be written merely because validation was lazy. Core still validates every request atomically.

New import seeds creation/activity, formatted display title, full searchable source title (bounded by API) and plugin metadata containing source UUID/cwd. Seeds do not overwrite existing thread edits. Activity may only advance. Existing archive state is preserved; passive new archived imports use ordinary archive after history. If an existing interactive thread differs from source archive state, the report requires explicit release/archive rather than interrupting it.

Legacy adoption requires exactly one candidate and an exact ordered match of supported terminal items. Extra omitted/deferred items require a complete source turn/item ID layout match through turn scopes and accepted request IDs; only supported sequences are acknowledged. Unclaimed canonical events remain unchanged and unsupported/deferred content stays partial. Unmapped events and invalid nullable tool errors still conflict. Canonical source sequence and time are acknowledged with `existingSequence` / `existingCreatedAt`; source times remain immutable fingerprint values. Core validates session ownership and exact canonical content/time. Unsupported, invalid or mismatching rows fail without fallback. For old attachment references, public attachment reads verify source bytes. Core retains ownership and adds no duplicate timeline rows. Archived adoption accepts existing references only.

For BB-owned continuation, the original source turn ID is matched to canonical turn scope, accepted user request IDs and completed non-user items. Exact content/count is required; no search-by-text heuristic is used. Matching new turns carry acknowledgements, including canonical times. Attachments can reuse verified BB upload references. A missing source turn mapping cannot prove ownership and must not be advertised as a full reconciliation guarantee for arbitrary providers.

Continuation requires an installed registered Codex provider. Auto-bind only uses an unambiguous ready environment for the repository/source worktree on the source host; public lifecycle data filters teardown/destroyed environments, while core checks ownership atomically. If none exists, public ensure prepares only the recorded local project source with source ID/path CAS. Read-only directory/Git inspection precedes atomic create/reuse; ensure starts no runtime, setup hook, clone or branch change. It does not reserve ownership; bind checks again. Ambiguous/missing/changed sources and ensure/bind failures remain continuation pending without fallback. Archived imports and existing interactive bindings skip ensure. Runtime SDK >=0.6.11 and daemon protocol 225 are required; older SDK 0.6.10 applications must be updated before installation/live calls; matching main SDK 0.6.11 is now installed locally. Import/bind never call send, spawn or runtime APIs. Release is explicit and never calls interrupt.

No direct BB database access, raw canonical injection, backup, repair, attachment ownership mutation, private core import, model/provider bridge changes or SQL fallback exists. Source Codex SQLite reads remain read-only. Tests use public SDK fixtures and the core's pre-existing isolated public contract suite; real user history is not test data.
