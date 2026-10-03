# Fork SDK provenance

`get-bb-plugin-sdk-0.6.11.tgz` is the public `@get-bb/plugin-sdk` package packed by the core thread from `aotd1/bb` external-history-api at `0a4c15ae2eab2ff5fcf05fc69e609bd6243ced90`, copied byte-for-byte from its `artifacts/get-bb-plugin-sdk-0.6.11.tgz`. External history and ensure checkout contracts were audited against that source commit. No private core imports are used.

SHA-256:

```
6202184def479b559065deb98d4c42dd57d21ed77875ec9a0e04509b83f5f53d
```

`package.json` pins the local tarball and `package-lock.json` pins its integrity. `npm ci` works without resolving this fork SDK from official npm. To reproduce a fresh pack, use the public package's prepack workflow (`npm pack` in `packages/plugin-sdk`) in a separate matching fork checkout. Do not build/modify the read-only core checkout used for this task. Tarball bytes can differ if packaging metadata changes; review its declarations/runtime and update provenance and checksum together.

The runtime floor is `>=0.6.11 <0.7`, with daemon protocol 225. Installed main remains SDK 0.6.10; do not install this plugin there or downgrade the floor. Build with the matching fork CLI (its already built `apps/cli/dist/index.js plugin build` can target this checkout without modifying core). Both generated server/app metadata must report SDK 0.6.11. Do not run `bb plugin types` in write mode to replace the dependency with an unavailable npm release.
