# CalmLens Java SDK

A synchronous, thread-safe Java 17+ client for [CalmLens](https://calmlens.com) moderation, storage, events, webhooks and CDN delivery, with typed requests and immutable response records.

## Installation

```xml
<dependency>
  <groupId>com.calmlens</groupId>
  <artifactId>calmlens-sdk</artifactId>
  <version>0.20.0</version>
</dependency>
```

The JAR declares the module name `com.calmlens` (`requires com.calmlens;`).

Versions follow semantic versioning: see [Versioning and support](https://calmlens.com/docs/sdk#versioning-and-support).

## Entry points

| Class                                   | Use                                                                |
| --------------------------------------- | ------------------------------------------------------------------ |
| `com.calmlens.CalmLensServerClient`     | The server client: create one per API key, share it across threads |
| `com.calmlens.Models`                   | Request builders and response records                              |
| `com.calmlens.MockCalmLensServerClient` | The real client in front of an in-memory CalmLens, for tests       |

## Quick start

Keep your API key on your server. Create one client, share it across threads and close it on shutdown.

```java
import com.calmlens.CalmLensServerClient;
import com.calmlens.Models.*;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;

try (var client = CalmLensServerClient.builder(System.getenv("CALMLENS_API_KEY"), System.getenv("CALMLENS_PROJECT_ID")).build()) {
  Asset asset = client.text.classify("Hello world");
  if (asset.classification().moderation().status() == AssetModerationStatus.ALLOWED) System.out.println(asset.id());

  Asset queued = client.assets.create(new SubmitAsset("photo.jpg", Content.file(Path.of("photo.jpg"), "image/jpeg"))
      .externalId("post-42").tags(List.of("posts")).visibility(Visibility.PRIVATE));
  Asset decided = client.assets.waitForDecision(new WaitForDecision(queued.id()).timeout(Duration.ofSeconds(30)));
  client.assets.update(new UpdateAsset(decided.id()).description(Patch.clear()));
}
```

`assets.create` queues processing; `assets.classify` and `text.classify` wait for the decision. `waitForDecision` returns once the asset is settled: its `classification().status()` is `COMPLETED` or `FAILED`. Webhooks report queued decisions without polling.

Act on `asset.classification().moderation().status()`:

| Status           | What to do                                                                              |
| ---------------- | --------------------------------------------------------------------------------------- |
| `ALLOWED`        | Show it                                                                                 |
| `LIMITED`        | Show it, but keep it out of recommendations, trending and notifications                 |
| `AGE_RESTRICTED` | Show it only behind your own age gate, through signed URLs                              |
| `BLOCKED`        | Don't show it                                                                           |
| `PURGED`         | Don't show it; the content has been removed                                             |
| `PENDING`        | Not decided yet: wait for a webhook or `waitForDecision`                                |
| Unknown          | A status added after your SDK version (`isKnown()` is `false`): treat it as not allowed |

## What you can do

- [Classify text, images, audio, video and websites](https://calmlens.com/docs/guides/classifying-assets), synchronously or queued, and [read the results](https://calmlens.com/docs/guides/classification-results).
- [Upload files and streams](https://calmlens.com/docs/sdk/java/reference#uploads) without holding them in memory. Content larger than `partSizeBytes` (8 MiB by default) goes in [parts](https://calmlens.com/docs/sdk/java/reference#multipart-uploads) automatically, each retried on its own and resumable with the same idempotency key, and every upload uses [idempotent retries](https://calmlens.com/docs/sdk/java/reference#idempotency-keys).
- [Moderate replies in context](https://calmlens.com/docs/sdk/java/reference#conversation-context) with the earlier posts of a conversation.
- Turn on [optional analyses](https://calmlens.com/docs/sdk/java/reference#optional-analyses) such as [OCR](https://calmlens.com/docs/guides/ocr).
- [Manage assets](https://calmlens.com/docs/sdk/java/reference#assets): update, move, retry, explain, record reviewer decisions, remove content, delete and [batch operations](https://calmlens.com/docs/sdk/java/reference#batch-operations).
- [Search](https://calmlens.com/docs/guides/search), list and [page through](https://calmlens.com/docs/sdk/java/reference#pagination) assets, [folders](https://calmlens.com/docs/sdk/java/reference#folders), hash lists, policies, lenses and the [events feed](https://calmlens.com/docs/api/events#reading-the-feed), sorted with `sort` or item by item with an `iterate` method.
- Block or flag known images with [hash lists](https://calmlens.com/docs/sdk/java/reference#hash-lists).
- [Manage the organisation's moderation policies](https://calmlens.com/docs/sdk/java/reference#policies) and choose the one the project uses.
- Keep a project's configuration in code: `uploadPresets` (`list`, `iterate`, `ensure` by key and `delete`), `projectSettings` (`get` and `update`) and `metadataFields` (`list`, `ensure` by ID and `delete`). Send the `revision` you read to refuse a change made since.
- Sign [upload tokens](https://calmlens.com/docs/sdk/java/reference#upload-tokens) for browser uploads through [upload presets](https://calmlens.com/docs/guides/upload-presets).
- [Verify and parse webhooks](https://calmlens.com/docs/sdk/java/reference#webhooks) in Spring or servlets.
- [Deliver content through the CDN](https://calmlens.com/docs/sdk/java/reference#cdn): build URLs, stream content, sign URLs, apply and manage [lenses and transforms](https://calmlens.com/docs/sdk/java/reference#transforms) and pass [viewer claims](https://calmlens.com/docs/sdk/java/reference#viewer-claims).
- Handle [errors](https://calmlens.com/docs/sdk/java/reference#errors) by stable code, and tune [retries and timeouts](https://calmlens.com/docs/sdk/java/reference#retries-and-timeouts).

## Testing

`MockCalmLensServerClient` runs the real client against an in-memory CalmLens, so tests can upload, decide, list events and serve content offline. To test against a real project, `TestInputs.generateTestTextCode`, `TestInputs.paintTestImage` and `TestInputs.generateMediaTestCode` sign test inputs with the project's test input key from the portal. See [Java testing](https://calmlens.com/docs/sdk/java/testing).

## Links

- [Documentation](https://calmlens.com/docs/sdk/java)
- [Java SDK reference](https://calmlens.com/docs/sdk/java/reference)
- [API reference](https://calmlens.com/docs/api)
- [Changelog](https://github.com/CalmLens/sdks/blob/main/java/CHANGELOG.md)
- [License](https://github.com/CalmLens/sdks/blob/main/java/LICENSE)
