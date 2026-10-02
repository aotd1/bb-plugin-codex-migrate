# Public history adapter contract

Audited core: `aotd1/bb` fork PR #1, external-history-api, `58ec5843077c8e060168911f0877d1220e41c05b`. Plugin SDK 0.6.10 uses `bb.sdk.threads`; core forces the calling plugin ID.

| Surface | Plugin behavior |
| --- | --- |
| `experimental_findExternalThread` | Durable lookup by target project, `codex-local:<primaryHostId>`, original Codex conversation UUID |
| `experimental_importHistory` | Provider `codex`, session original UUID, generation 0, preserve attention; completed semantic turns only |
| `experimental_bindExternalSession` | Separate explicit CAS binding to original UUID handle and ready same-project/source-host environment |
| `experimental_releaseExternalSession` | User-requested settled release only; core retains binding on failure/active work |
| `threads.list`, `threads.events.list` | Enumerate legacy claims in live/archived lists and public ordered event pages of 100 |
| `projects.list/create`, `environments.list/get` | Public routing and ready environment lookup; no environment provisioning workaround |
| `projects.attachments.upload/read` | Upload new attachments; verify legacy bytes before reusing canonical references |
| `threads.archive` | Archive newly passive history after import; existing interactive archives require an explicit user action |
| `bb.storage.kv` | Per-turn semantic fingerprints, upload outcomes, conversation receipts, current/last run |

Turn IDs are `turn:<source turn ID>`. Orders are source snapshot ordinals, not source timestamps. Source turn timestamps convert seconds to integer milliseconds. When item times are absent, interpolation inside turn bounds is deterministic; absent turn times fall back to source thread creation plus ordinal. New snapshots must retain previous IDs, order, content and inferred times. A changed window/order is a conflict, never an automatic reset. Local fingerprints exclude canonical acknowledgements but include all source semantic content/order/time/status.

The adapter prepares complete turns, verifies semantic limits and precomputes all history batch boundaries before any history request. UTF-8 byte accounting includes plugin attribution and envelope. A turn is never split; later invalid content does not cause earlier batches to be written merely because validation was lazy. Core still validates every request atomically.

New import seeds creation/activity, formatted display title, full searchable source title (bounded by API) and plugin metadata containing source UUID/cwd. Seeds do not overwrite existing thread edits. Activity may only advance. Existing archive state is preserved; passive new archived imports use ordinary archive after history. If an existing interactive thread differs from source archive state, the report requires explicit release/archive rather than interrupting it.

Legacy adoption requires exactly one candidate and an exact ordered match of supported terminal items. Canonical source sequence and time are acknowledged with `existingSequence` / `existingCreatedAt`; source times remain immutable fingerprint values. Core validates session ownership and exact canonical content/time. Unsupported, invalid or mismatching rows fail without fallback. For old attachment references, public attachment reads verify source bytes. Core retains ownership and adds no duplicate timeline rows. Archived adoption accepts existing references only.

For BB-owned continuation, the original source turn ID is matched to canonical turn scope, accepted user request IDs and completed non-user items. Exact content/count is required; no search-by-text heuristic is used. Matching new turns carry acknowledgements, including canonical times. Attachments can reuse verified BB upload references. A missing source turn mapping cannot prove ownership and must not be advertised as a full reconciliation guarantee for arbitrary providers.

Continuation requires an installed registered Codex provider. Auto-bind only uses an unambiguous ready environment for the repository/source worktree on the source host; public lifecycle data filters teardown/destroyed environments, while core checks ownership atomically. Public SDK lacks standalone ensure/provision: absence is reported as continuation pending, and explicit bind is available later. Import/bind never call send, spawn or runtime APIs. Release is explicit and never calls interrupt.

No direct BB database access, raw canonical injection, backup, repair, attachment ownership mutation, private core import, model/provider bridge changes or SQL fallback exists. Source Codex SQLite reads remain read-only. Tests use public SDK fixtures and the core's pre-existing isolated public contract suite; real user history is not test data.
