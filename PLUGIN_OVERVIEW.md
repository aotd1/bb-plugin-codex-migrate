Bring selected local Codex conversations into BB through its public history API.

Preview unique folders, repository routing, existing claims and unsupported content, then choose individual conversations. Shared folders are selected together. Non-Git folders require an explicit Git initialization choice.

Supported completed history includes messages, plans, reasoning, tools, commands, file changes and uploaded user attachments. Stable external IDs and atomic bounded batches make reruns safe after interruptions or lost responses. Committed partial history remains visible; progress and reports persist in plugin-owned storage.

Safe legacy adoption preserves existing thread/session identities without copying events. Ambiguous, mismatching or invalid legacy rows remain conflicts. There is no database repair/backup path.

Continuation binds the original Codex session to a ready same-project environment without starting a model. If no environment exists, history remains passive and the report shows continuation pending; public core provisioning without a turn is currently unavailable. Explicit bind/release commands are provided. Existing archives and active user work are respected.

Requires the BB 0.44.0 external-history fork with runtime SDK >=0.6.10, the vendored matching SDK, local read-only Codex source, Codex CLI and Git. See README for installation and limitations.
