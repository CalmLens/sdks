---
"@calmlens/sdk": minor
---

`calmlens plan`, `apply`, `trigger` and `listen` take `--json`, which prints JSON on standard output
(for `listen`, one line per delivery attempt) and the readable output on standard error.
`calmlens plan --detailed-exitcode` exits 2 when the project would change. `--log-level` (or
`CALMLENS_LOG`) logs the CLI's CalmLens requests to standard error. `--profile <name>` (or
`CALMLENS_PROFILE`) keeps a separate login per profile, so several projects can be signed in at
once.

`CalmLensProvider` (React and React Native), `provideCalmLens` (Vue) and `setCalmLensContext`
(Svelte) give every uploader beneath them the same `uploadPresetId`, `tokenUrl`, `token`,
`baseUrl` or `createClient`.

The type declarations need TypeScript 5.9 or later, which every build now checks.
