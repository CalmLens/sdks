# SDK releases

Run `bun run changeset` for a user-visible SDK change, select the affected SDKs and
choose patch, minor or major. JavaScript is `@calmlens/sdk`; native SDKs use
`@calmlens/sdk-<language>` as Changesets identifiers, not registry install names.

The release workflow maintains a Version SDKs PR. Review its versions, native manifests
and changelogs, then merge it. No publishing happens from that PR branch.

The private application checks merged release plans every 15 minutes (or run its
Release SDKs workflow manually). It updates its submodule pin, creates immutable
release tags and dispatches the existing protected registry workflows. Go is tagged
and validated in this public repo. A failed publish remains visible in Actions;
correct code with a new changeset/version rather than moving a published tag.

Do not hand-edit the proxy package.json versions or release.json. The version command
updates the native manifests, Rust lockfile and example dependency together.
