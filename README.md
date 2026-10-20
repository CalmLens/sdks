# CalmLens SDKs and examples

Official SDKs for [CalmLens](https://calmlens.com): content moderation, storage and CDN delivery.

| Language | SDK | Install |
| --- | --- | --- |
| JavaScript / TypeScript | [javascript](javascript) | `npm install @calmlens/sdk` |
| Python | [python](python) | `pip install calmlens` |
| Ruby | [ruby](ruby) | `gem install calmlens` |
| Rust | [rust](rust) | `cargo add calmlens` |
| Java | [java](java) | `com.calmlens:calmlens-sdk` |
| Go | [go](go) | `go get github.com/CalmLens/sdks/go` |

All six SDKs are published. See the [SDK documentation](https://calmlens.com/docs/sdk) for usage and API coverage.

## Examples

| Example | Language |
| --- | --- |
| [Calmgram: photo sharing](examples/calmgram) | JavaScript / TypeScript |
| [Calmform: static feedback form](examples/feedback-form-static) | JavaScript |
| [Calmsnap: mobile photo uploads](examples/mobile-uploads-expo) | TypeScript / Expo |
| [Link board](examples/link-board-python) | Python |
| [Comment thread](examples/comment-thread-ruby) | Ruby |
| [Media library](examples/media-library-rust) | Rust |
| [Marketplace listings](examples/marketplace-listing-java) | Java |
| [Voice clips](examples/voice-clips-go) | Go |

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

Each native SDK includes its own tests and development instructions. JavaScript examples use
the local JavaScript SDK; build it before installing an example's dependencies. Calmgram's fixed
examples are illustrative snapshots; its live mode uses the API.

The `javascript/src/contract` bindings and native `testdata` fixtures are generated from the
CalmLens API contract. Update SDK implementations here; regenerate bindings when the API
contract changes. Generated bindings contain only public schemas, constants and SDK helpers.
Private backend provisioning and implementation stay in the application repository.

## Releases

Registry publishing runs in the private application repository with its existing trusted
publishers and protected environments. A release pins the reviewed public commit there,
then tags that private commit with `javascript/v<version>`, `python-sdk/v<version>`,
`ruby-sdk/v<version>`, `rust-sdk/v<version>` or `java-sdk/v<version>`. Each job checks its
manifest version before publishing. Go releases use `go/v<version>` here, verified by CI
and the public Go proxy. Published versions and tags are immutable.

All SDKs and examples are available under the [MIT licence](LICENSE).
