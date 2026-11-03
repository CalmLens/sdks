# SDK releases

Run `bun run changeset` for a user-visible SDK change, select the affected SDKs and
choose patch, minor or major. JavaScript is `@calmlens/sdk`; native SDKs use
`@calmlens/sdk-<language>` as Changesets identifiers, not registry install names.

The release workflow maintains a Version SDKs PR. Review its versions, native manifests
and changelogs, then merge it. No publishing happens from that PR branch.

The private application checks merged release plans every 15 minutes (or run its
Release SDKs workflow manually). It updates its submodule pin, creates immutable
release tags and dispatches the protected Python, Ruby, Rust and Java registry workflows.

This public repo tags and publishes the rest itself. Go is tagged and validated here
(release-go-sdk.yml). The JavaScript SDK is tagged `javascript/v<version>` once its release
commit's SDK Tests and SDK examples runs have passed, and release-npm.yml publishes one packed
build to npm with provenance as both `@calmlens/sdk` and `calmlens`, skipping a name that
already has the version. The `calmlens` CLI is tagged `cli-v<version>`, and release-cli.yml
publishes its standalone executables and Homebrew formula. A failed publish remains visible in Actions;
correct code with a new changeset/version rather than moving a published tag.

Do not hand-edit the proxy package.json versions or release.json. The version command
updates the native manifests, Rust lockfile and example dependency together.

PHP uses `@calmlens/sdk-php` and synchronizes `php/src/Version.php`. Packagist
installs `calmlens/sdk` from this repository: the root `composer.json` describes the
package, `.gitattributes` keeps its archives to `php/src`, and `release-php.yml` tags
each release `v<version>`, which Packagist's GitHub hook picks up.
