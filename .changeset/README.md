# SDK releases

Run `bun run changeset` for a user-visible SDK change, select the affected SDKs and
choose patch, minor or major. Before 1.0 any change may be a patch; from 1.0 follow semantic
versioning, a breaking change major and a new feature minor. `bun run release:check` and the Version SDKs PR refuse a bump smaller than
the public surface change since each SDK's previous release (`scripts/check-surface.mjs`).
JavaScript is `@calmlens/sdk`; native SDKs use
`@calmlens/sdk-<language>` as Changesets identifiers, not registry install names.

The release workflow maintains a Version SDKs PR. Review its versions, native manifests
and changelogs, then merge it. No publishing happens from that PR branch.

This public repo tags and publishes every SDK itself. Go is tagged and validated here
(release-go-sdk.yml). The JavaScript SDK is tagged `javascript/v<version>` once its release
commit's SDK Tests and SDK examples runs have passed, and release-npm.yml publishes one packed
build to npm with provenance as both `@calmlens/sdk` and `calmlens`, skipping a name that
already has the version. The `calmlens` CLI is tagged `cli-v<version>`, and release-cli.yml
publishes its standalone executables and Homebrew formula. Python, Ruby, Rust and Java
are tagged `<language>-sdk/v<version>` once the same checks have passed, and
release-python-sdk.yml, release-ruby-sdk.yml, release-rust-sdk.yml and release-java-sdk.yml
publish that tag's code to PyPI, RubyGems, crates.io and Maven Central from main's workflow,
skipping a version the registry already has. PyPI, RubyGems and crates.io trust those
workflow files and their `pypi`, `rubygems` and `crates-io` environments; Maven Central's
token and signing key are secrets of the `maven-central` environment. A failed publish remains visible in Actions;
correct code with a new changeset/version rather than moving a published tag.

Do not hand-edit the proxy package.json versions or release.json. The version command
updates the native manifests, Rust lockfile and example dependency together.

PHP uses `@calmlens/sdk-php` and synchronizes `php/src/Version.php`. Packagist
installs `calmlens/sdk` from this repository: the root `composer.json` describes the
package, `.gitattributes` keeps its archives to `php/src`, and `release-php.yml` tags
each release `v<version>`, which Packagist's GitHub hook picks up.
