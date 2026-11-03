# CalmLens JavaScript SDK

The official JavaScript and TypeScript SDK for [CalmLens](https://calmlens.com): content moderation and classification for text, images, documents and websites, plus optional storage and CDN delivery.

## Installation

```bash
npm install calmlens
```

The same package is also published as `@calmlens/sdk`, at the same version. Import from the name you installed: `calmlens/server` with `calmlens`, or `@calmlens/sdk/server` with `@calmlens/sdk`.

The package has two clients, each with its own import:

| Import            | Client                 | Runs                                                               | Authenticates with                                               |
| ----------------- | ---------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------- |
| `calmlens/server` | `CalmLensServerClient` | On your server: Node.js 22 or later, Bun, Deno, Cloudflare Workers | A project API key                                                |
| `calmlens/app`    | `CalmLensAppClient`    | In browsers and React Native apps                                  | An upload preset, with an optional upload token from your server |

API keys are secret, so `CalmLensServerClient` refuses to start in a web page or app. Upload from browsers and apps with `CalmLensAppClient`, and serve private content to them with signed URLs. The package ships ES modules and CommonJS with type declarations and loads no other packages at runtime.

## Quick start

Create an API key under **Developer → API Keys** in the CalmLens portal. The same page shows your **Project ID**. Keep both on your server.

```typescript
import { CalmLensServerClient } from "calmlens/server";

const client = new CalmLensServerClient({
  apiKey: process.env.CALMLENS_API_KEY!,
  projectId: process.env.CALMLENS_PROJECT_ID!,
});

// Text (comments, captions, bios): waits for the decision
const comment = await client.text.classify({ text: "Great photo!", externalId: "comment-42" });

const { status } = comment.classification.moderation;
if (status === "allowed" || status === "limited") {
  // publish it; keep "limited" out of recommendations, trending and notifications
} else {
  // "age-restricted": show it only behind your own age check; "blocked" or "purged": don't publish it
}

// Images and documents: queued, resolved by webhook or assets.retrieve()
const image = await client.assets.create({
  name: "photo.jpg",
  content: { data: file, type: "image/jpeg" },
  externalId: "post-7",
});
console.log(image.classification.status, image.classification.moderation.status); // "processing" "pending"
```

| `classification.status`   | `classification.moderation.status` | Meaning                                                                                    |
| ------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------ |
| `completed`               | `allowed`                          | Safe to show.                                                                              |
| `completed`               | `limited`                          | Delivered like `allowed`; reduce its reach, such as keeping it out of recommendations.     |
| `completed`               | `age-restricted`                   | Delivered only with `viewerClaims.ageConfirmed=true`. Show it only to age-checked viewers. |
| `completed`               | `blocked`                          | Your policy blocked it; the CDN doesn't deliver it. Don't show it.                         |
| `completed`               | `purged`                           | Your policy blocked it and deleted its content. Don't show it.                             |
| `pending` or `processing` | `pending`                          | Still being received or classified.                                                        |
| `failed`                  | `pending`                          | Processing failed; see `assets.retry`.                                                     |

The latest applied review in `classification.moderation.manualReviews` takes precedence over the automated decision. Treat a status you don't recognise as not allowed. See [How CalmLens works](https://calmlens.com/docs/how-it-works).

## What you can do

- [Moderate text](https://calmlens.com/docs/sdk/javascript#text-moderation), including [replies in a conversation](https://calmlens.com/docs/guides/threaded-moderation), and [classify images, documents, audio, video and websites](https://calmlens.com/docs/guides/classifying-assets).
- [Read classification results](https://calmlens.com/docs/guides/classification-results) by category and qualifier, and [ask for the complete policy evidence](https://calmlens.com/docs/guides/classification-results#complete-policy-evidence) behind a decision.
- Send [multipart uploads](https://calmlens.com/docs/sdk/javascript/reference#multipart-uploads) for large files, from any [content payload](https://calmlens.com/docs/sdk/javascript/reference#content-payloads), with [safe retries and idempotency keys](https://calmlens.com/docs/sdk/javascript/reference#retries-and-idempotency).
- [Upload from browsers and apps](https://calmlens.com/docs/sdk/javascript/reference#app-client) through [upload presets](https://calmlens.com/docs/guides/upload-presets) and locally signed [upload tokens](https://calmlens.com/docs/sdk/javascript/reference#upload-tokens).
- Drop in the [upload widget and media component](https://calmlens.com/docs/widgets) for React, React Native, Vue, Svelte or custom elements.
- [Deliver assets from the CDN](https://calmlens.com/docs/guides/delivering-assets) with [lenses and transforms](https://calmlens.com/docs/guides/lenses), [signed URLs](https://calmlens.com/docs/guides/delivering-assets#signed-urls) and [viewer claims](https://calmlens.com/docs/api/cdn#viewer-claims).
- Record [reviewer decisions](https://calmlens.com/docs/guides/human-review), [retry failed processing](https://calmlens.com/docs/guides/asset-lifecycle#recover-from-processing-failure), and [organise assets in folders](https://calmlens.com/docs/sdk/javascript/reference#folders).
- [Verify and parse webhooks](https://calmlens.com/docs/sdk/javascript#webhooks), or poll the [events feed](https://calmlens.com/docs/sdk/javascript/reference#events-feed).
- [Handle errors](https://calmlens.com/docs/sdk/javascript/reference#errors) by stable code, and set [timeouts and request budgets](https://calmlens.com/docs/sdk/javascript/reference#request-budgets).
- Forward events to a local handler with the bundled [`calmlens` CLI](https://calmlens.com/docs/guides/local-development): `npx calmlens listen --forward-to http://localhost:3000/api/webhooks/calmlens`.

Every public SDK operation accepts one options object, so call sites stay stable as optional fields are added. The [SDK reference](https://calmlens.com/docs/sdk/javascript/reference) lists every option and method.

## Testing

`calmlens/testing` runs the real clients against an in-memory CalmLens API and CDN, with moderation outcomes, recorded requests, injected failures and signed webhook deliveries. See [JavaScript testing](https://calmlens.com/docs/sdk/javascript/testing).

## Links

- [Documentation](https://calmlens.com/docs/sdk/javascript)
- [SDK reference](https://calmlens.com/docs/sdk/javascript/reference)
- [HTTP API reference](https://calmlens.com/docs/api)
- [Changelog](https://github.com/CalmLens/sdks/blob/main/javascript/CHANGELOG.md)
- [License](https://github.com/CalmLens/sdks/blob/main/javascript/LICENSE)
