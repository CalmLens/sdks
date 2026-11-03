# CalmLens SDKs and examples

Official SDKs for [CalmLens](https://calmlens.com): content moderation, storage and CDN delivery.

| Language                | SDK                      | Install                                                    |
| ----------------------- | ------------------------ | ---------------------------------------------------------- |
| JavaScript / TypeScript | [javascript](javascript) | `npm install calmlens` (also published as `@calmlens/sdk`) |
| Python                  | [python](python)         | `pip install calmlens`                                     |
| Ruby                    | [ruby](ruby)             | `gem install calmlens`                                     |
| Rust                    | [rust](rust)             | `cargo add calmlens`                                       |
| Java                    | [java](java)             | `com.calmlens:calmlens-sdk`                                |
| PHP                     | [php](php)               | `composer require calmlens/sdk`                            |
| Go                      | [go](go)                 | `go get github.com/CalmLens/sdks/go`                       |

See the [SDK documentation](https://calmlens.com/docs/sdk) for usage and API coverage.

## Examples

| Example                                                         | Language                           |
| --------------------------------------------------------------- | ---------------------------------- |
| [Calmgram: photo sharing](examples/calmgram)                    | JavaScript / TypeScript            |
| [Calmform: static feedback form](examples/feedback-form-static) | JavaScript                         |
| [UI components](examples/ui-components)                         | React, Vue, Svelte, JavaScript     |
| [Widget playground](examples/widget-playground)                 | React, Vue, Svelte, web components |
| [Calmsnap: mobile photo uploads](examples/mobile-uploads-expo)  | TypeScript / Expo                  |
| [Link board](examples/link-board-python)                        | Python                             |
| [Comment board](examples/comment-board-laravel)                 | PHP / Laravel                      |
| [Chirp: short posts with images](examples/chirp-php)            | PHP                                |
| [Comment thread](examples/comment-thread-ruby)                  | Ruby                               |
| [Media library](examples/media-library-rust)                    | Rust                               |
| [Marketplace listings](examples/marketplace-listing-java)       | Java                               |
| [Voice clips](examples/voice-clips-go)                          | Go                                 |

## Development

This repository is the source of truth for the SDKs and standalone examples. Open SDK issues
and pull requests here. The private CalmLens application pins this repository as a Git submodule.

Install [Bun](https://bun.sh), then run:

```sh
bun install --frozen-lockfile
bun run --cwd javascript check
bun run --cwd javascript test
bun run --cwd javascript build
```

The JavaScript SDK's React, Vue, Svelte and web component bindings are tested in
[`javascript/ui-tests`](javascript/ui-tests), which installs the UI libraries apart from the SDK:

```sh
(cd javascript/ui-tests && bun install --frozen-lockfile && bun run check && bun run test)
```

Each native SDK has its own checks; run them from its directory. CI runs every one.

| SDK    | Checks                                                                                                                                                                        |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Python | `PYTHONPATH=. python -m unittest discover -s tests -v` and `python -m mypy` (CI runs Python 3.10 and 3.14)                                                                    |
| Go     | `go vet ./...` and `go test -race ./...`                                                                                                                                      |
| Rust   | `cargo test --locked`, `cargo clippy --locked --all-targets -- -D warnings` and `cargo check --no-default-features` (CI runs Rust 1.88 and stable)                            |
| Ruby   | `bundle install`, `bundle exec ruby -Ilib -e 'Dir["test/*_test.rb"].each { \|file\| require_relative file }'`, `bundle exec rubocop`, `steep check` and `rbs -I sig validate` |
| Java   | `mvn verify` (tests and Javadoc with doclint)                                                                                                                                 |
| PHP    | `composer install`, `composer check` and `composer test` (CI runs PHP 8.2 and 8.5)                                                                                            |

Every SDK replays the shared contract fixtures in its `testdata/` (PHP reads Ruby's) and checks its
generated error-code list. `bun run build:cli` in `javascript/` builds the CLI's npm entry, and
`bun run build:cli:binary` a standalone executable in `dist/`; set `CALMLENS_BUILD_TARGET`, such as
`bun-linux-x64`, to cross-compile it.

JavaScript examples use
the local JavaScript SDK; build it before installing an example's dependencies. Calmgram's fixed
examples are illustrative snapshots; its live mode uses the API.

`bun install && bun run dev` opens a dashboard that starts each example in its offline demo.
Its `m` key switches to local mode, which provisions the examples on a CalmLens development
instance at `localhost:6110` that only the CalmLens team runs. To use your own project, follow
an example's README instead.

The `javascript/src/contract` bindings and native `testdata` fixtures are generated from the
CalmLens API contract. Update SDK implementations here; regenerate bindings when the API
contract changes. Generated bindings contain only public schemas, constants and SDK helpers.
Private backend provisioning and implementation stay in the application repository.

## Releases

Add a changeset with `bun run changeset` when an SDK needs a release. Select the SDKs
and bump type; the Version SDKs workflow maintains a release PR containing the native
version updates and per-SDK changelogs. Merge that PR to release.

The JavaScript SDK, Go, PHP and the CLI are released from this repository. When a merged plan
includes the JavaScript SDK and its commit's SDK Tests and SDK examples runs have passed,
`release-npm.yml` tags `javascript/v<version>` and publishes one packed build to npm with
provenance, as `calmlens` and as `@calmlens/sdk`. `release-cli.yml` tags `cli-v<version>`,
attaches the CLI's standalone executables to that GitHub release and updates the Homebrew
formula in `Formula/`. Go tags and proxy validation run here too. `release-php.yml` tags PHP
releases `v<version>`; Packagist installs `calmlens/sdk` from those tags, through the root
`composer.json`, with `.gitattributes` keeping the archive to the PHP package.

Python, Ruby, Rust and Java are published by the private application repository with its
existing trusted publishers and protected environments. Its Release SDKs workflow checks
tested public release plans every 15 minutes (or on manual dispatch), advances the submodule
pin, creates immutable release tags and dispatches those publishing jobs. Check both
repositories' Actions for completion.

See [.changeset/README.md](.changeset/README.md) for package identifiers and retry guidance.
The small native `package.json` files are version records for Changesets, not npm packages.
Published versions and tags are immutable.

All SDKs and examples are available under the [MIT licence](LICENSE).
