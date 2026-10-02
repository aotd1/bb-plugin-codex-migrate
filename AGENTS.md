# Repository instructions

## BB data access

- Access BB projects, environments, threads, history, search and attachments only through the public Plugin SDK and server API.
- Direct access to BB database files is forbidden, including read-only SQL, writes, backups, schema inspection, repair scripts and fallback adapters. Never inject raw canonical events or change attachment ownership directly.
- Keep source Codex data access read-only. Use the sanctioned plugin storage API for this plugin's own state; it does not grant access to BB core tables.
- Verify migration through public API contracts, SDK fixtures and isolated server stores. Never bulk-import real user history or send a provider prompt as an automatic test.

## Releases

- Use `main` as the release branch unless the user names another branch.
- Before tagging a release, review the changes since the previous release tag and update the package version and installation example.
- Create an annotated `vX.Y.Z` tag on the release commit. In the tag message, briefly state what changed on the release branch since the previous tag, using one to three factual bullet points.
- Push both the release branch and its tag.
