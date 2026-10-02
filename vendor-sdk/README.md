# Fork SDK provenance

`get-bb-plugin-sdk-0.6.10.tgz` is the public `@get-bb/plugin-sdk` package packed from `aotd1/bb` external-history-api at `7f6e2ac5e`, copied byte-for-byte from the existing Dooffin vendor-sdk artifact. The external-history contract was audited against `58ec5843077c8e060168911f0877d1220e41c05b`; that later commit fixes the installed runtime SDK marker to 0.6.10. No private core imports are used.

SHA-256:

```
84ba07fc838b1eb66d15833bd148f29400e1265cb1cd31d927c057e56ed9504f
```

`package.json` pins the local tarball and `package-lock.json` pins its integrity. `npm ci` works without resolving this fork SDK from official npm. To reproduce a fresh pack, use the public package's prepack workflow (`npm pack` in `packages/plugin-sdk`) in a separate matching fork checkout. Do not build/modify the read-only core checkout used for this task. Tarball bytes can differ if packaging metadata changes; review its declarations/runtime and update provenance and checksum together.

`bb plugin types --check` in BB 0.44.0 compares the dependency string with the numeric host version, so it warns about the `file:` pin even though both are SDK 0.6.10. Keep the reproducible local dependency. The package version, external SDK types, and built server/app metadata are checked separately. Do not run `bb plugin types` in write mode to replace this dependency with an unavailable npm release.
