# CalmLens Rust SDK

The Rust SDK for [CalmLens](https://calmlens.com) moderation, storage and CDN delivery: an async client (Tokio and reqwest), an optional blocking client, typed models, streamed uploads and downloads, retries with idempotency keys, webhook verification and an offline mock. It requires Rust 1.88 or later.

## Installation

```sh
cargo add calmlens
cargo add tokio --features macros,rt-multi-thread
```

| Feature      | Default | Adds                                                                          |
| ------------ | ------- | ----------------------------------------------------------------------------- |
| `async`      | yes     | The async `calmlens::ServerClient`                                            |
| `rustls`     | yes     | TLS through rustls, verifying certificates with the operating system's store  |
| `native-tls` |         | TLS through the platform library                                              |
| `blocking`   |         | `calmlens::blocking::ServerClient`, the same API without `async`              |
| `tracing`    |         | A `tracing` event, with the target `calmlens`, for every HTTP attempt         |
| `testing`    |         | `calmlens::testing::MockServerClient`; enable it in `[dev-dependencies]` only |

With `default-features = false` the crate contains only the models and the webhook helpers, with no HTTP stack, for services that only receive webhooks.

Versions follow semantic versioning: see [Versioning and support](https://calmlens.com/docs/sdk#versioning-and-support). The minimum supported Rust version is 1.88; a minor release may raise it to a version released at least six months earlier, and a patch release never does.

## Clients

| Client                                | Use it for                                                                  |
| ------------------------------------- | --------------------------------------------------------------------------- |
| `calmlens::ServerClient`              | Async servers. Create one at startup and share it: clones share connections |
| `calmlens::blocking::ServerClient`    | Synchronous code; never call it directly from async code                    |
| `calmlens::testing::MockServerClient` | Offline tests, with queued responses or an in-memory CalmLens               |

## Quick start

Create an API key and copy your project ID as described in [Authentication](https://calmlens.com/docs/guides/authentication), and keep them on your server.

```rust
use calmlens::{models::*, ServerClient};

#[tokio::main]
async fn main() -> calmlens::Result<()> {
    // Or ServerClient::from_env(), which reads CALMLENS_API_KEY and CALMLENS_PROJECT_ID.
    let client = ServerClient::new("your-api-key", "proj_8fK2mQx7Lp4NvB3tRz9Y")?;
    let asset = client.assets().classify(SubmitAsset::text("Hello world")).await?;
    if asset.classification.moderation.decision == Some(AssetModerationDecision::Allowed) {
        println!("{}", asset.id);
    }
    let queued = client
        .assets()
        .create(SubmitAsset::new("note.txt", Content::bytes(b"Hello".to_vec(), "text/plain")))
        .await?;
    client
        .assets()
        .update(UpdateAsset::new(queued.id).name("Note").clear_description())
        .await?;
    Ok(())
}
```

`assets().classify` and `text().classify` wait for the decision; `assets().create` queues processing, and `assets().wait_for_decision` or a webhook reports the result. `wait_for_decision` returns once the asset is settled: its `classification.status` is `completed`, with the decision in `classification.moderation.decision`, or `failed`, with the reason in `classification.failure_reason`. While it is `queued` or `processing` it keeps waiting. The decision decides delivery:

| Decision         | Meaning                                                                                                   |
| ---------------- | --------------------------------------------------------------------------------------------------------- |
| `None`           | Not decided yet; don't show the content                                                                   |
| `allowed`        | Show it                                                                                                   |
| `limited`        | Delivered like `allowed`, but reduce its reach: keep it out of recommendations and rank it lower          |
| `age-restricted` | Show it only behind your own age check; the CDN requires `ViewerClaims::new().age_confirmed(true)`      |
| `blocked`        | Not delivered; the content is kept                                                                        |
| `purged`         | Not delivered, and the stored content is deleted                                                          |

Treat a missing or unknown decision as not allowed:

```rust
let publishable = matches!(
    asset.classification.moderation.decision,
    Some(AssetModerationDecision::Allowed | AssetModerationDecision::Limited)
);
```

Options types are `#[non_exhaustive]`: build them with `new`, which takes the required fields, and the chained setters (`clear_*` sends `null`), so a minor release can add an option. Enums keep values this SDK version doesn't list as `Unknown`; to act on one, compare `as_str()` in a `_` arm rather than matching `Unknown`, which stops matching once a later version lists the value.

## What you can do

- Classify text and files, and read the decision: [Rust SDK](https://calmlens.com/docs/sdk/rust#moderate-content), [Reading classification results](https://calmlens.com/docs/guides/classification-results)
- Wait for queued decisions: [Waiting for a decision](https://calmlens.com/docs/sdk/rust#waiting-for-a-decision)
- Stream uploads from bytes, readers, streams and files, with content over 8 MiB sent in resumable parts automatically: [Uploads](https://calmlens.com/docs/sdk/rust/reference#uploads), [Multipart uploads](https://calmlens.com/docs/guides/multipart-uploads)
- Turn on OCR and other optional analyses: [Processing features](https://calmlens.com/docs/sdk/rust/reference#processing-features)
- Moderate replies with their conversation: [Conversations](https://calmlens.com/docs/sdk/rust/reference#conversations)
- Declare a project's configuration in code, sending each `revision` you read to refuse a change made since: `upload_presets()` (`list`, `iterate`, `ensure` by key, `delete`), `project_settings()` (`get`, `update`, which replaces the settings) and `metadata_fields()` (`list`, `ensure` by ID, `delete`): [Upload presets](https://calmlens.com/docs/guides/upload-presets)
- Sign upload tokens for browser uploads through a preset: [Upload tokens](https://calmlens.com/docs/sdk/rust/reference#upload-tokens), [Upload presets](https://calmlens.com/docs/guides/upload-presets)
- Manage assets, folders and batches, and record reviewer decisions: [Methods](https://calmlens.com/docs/sdk/rust#methods), [Reviewer decisions](https://calmlens.com/docs/sdk/rust/reference#reviewer-decisions), [Batch operations](https://calmlens.com/docs/sdk/rust/reference#batch-operations)
- Build asset URLs with lenses and transforms, sign private assets' URLs, read their display info and stream content: [CDN URLs](https://calmlens.com/docs/sdk/rust/reference#cdn-urls), [Delivering assets](https://calmlens.com/docs/guides/delivering-assets)
- Block known images with hash lists: [Hash lists](https://calmlens.com/docs/sdk/rust/reference#hash-lists)
- Page through assets and poll the events feed: [Pagination](https://calmlens.com/docs/sdk/rust#pagination), [Events](https://calmlens.com/docs/api/events)
- Verify webhooks with axum or actix-web: [Webhooks](https://calmlens.com/docs/sdk/rust#webhooks), [Webhook helpers](https://calmlens.com/docs/sdk/rust/reference#webhook-helpers)
- Configure timeouts, retries, a proxy, extra root certificates and your app's name, and override them per call: [Client configuration](https://calmlens.com/docs/sdk/rust/reference#client-configuration), [Retries and idempotency](https://calmlens.com/docs/sdk/rust/reference#retries-and-idempotency)
- Observe every HTTP attempt with a hook, `tracing` or `CALMLENS_LOG`, read each result's `last_response()`, and call endpoints without a method through `request`: [Client configuration](https://calmlens.com/docs/sdk/rust/reference#client-configuration)
- Handle errors by kind or code: [Errors and retries](https://calmlens.com/docs/sdk/rust#errors-and-retries), [Error details](https://calmlens.com/docs/sdk/rust/reference#error-details)

## Testing

`calmlens::testing::MockServerClient` (feature `testing`) runs your code offline against queued responses or an in-memory CalmLens that simulates moderation outcomes, events and CDN delivery. Against a real project, `generate_test_text_code`, `paint_test_image` and `generate_media_test_code` build signed test inputs, with your project's test input key, that CalmLens decides as a chosen scenario. See [Rust testing](https://calmlens.com/docs/sdk/rust/testing).

## Links

- [Documentation](https://calmlens.com/docs/sdk/rust)
- [API reference](https://calmlens.com/docs/api)
- [Changelog](https://github.com/CalmLens/sdks/blob/main/rust/CHANGELOG.md)
- [License](https://github.com/CalmLens/sdks/blob/main/rust/LICENSE) (MIT)
