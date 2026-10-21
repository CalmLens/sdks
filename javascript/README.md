# @calmlens/sdk

Official JavaScript/TypeScript SDK for CalmLens API

CalmLens provides content moderation and classification for text, images, documents and websites, plus optional storage and CDN delivery. This SDK makes it easy to integrate CalmLens into your JavaScript/TypeScript applications.

## Installation

```bash
npm install @calmlens/sdk
```

The package has two clients, each with its own import:

| Import | Client | Runs | Authenticates with |
| --- | --- | --- | --- |
| `@calmlens/sdk/server` | `CalmLensServerClient` | On your server: Node.js 22 or later, Bun, Deno, Cloudflare Workers | A project API key |
| `@calmlens/sdk/app` | `CalmLensAppClient` | In browsers and React Native apps | An [upload preset](#browser-and-app-uploads-with-upload-presets), with an optional upload token from your server |

`@calmlens/sdk` itself exports the shared types, `CalmLensError`, the error codes and `SDK_VERSION`. The package ships ES modules and CommonJS with type declarations and loads no other packages at runtime: importing only `verifyWebhookSignature` adds about 5 KB (minified) to a bundle, `CalmLensAppClient` about 19 KB and `CalmLensServerClient` about 28 KB.

API keys are secret, so `CalmLensServerClient` refuses to start in a web page or app. Upload from browsers and apps with `CalmLensAppClient`, and serve private content to them with [signed URLs](#assetscreatesignedurloptions).

Every public SDK operation accepts one options object. This keeps call sites stable as optional fields are added.

## Quick Start

Create an API key under **Developer → API Keys** in the CalmLens portal. The same page shows your **Project ID**. Keep both on your server.

```typescript
import { CalmLensServerClient } from "@calmlens/sdk/server";

const client = new CalmLensServerClient({
  apiKey: process.env.CALMLENS_API_KEY!,
  projectId: process.env.CALMLENS_PROJECT_ID!,
});

// Text (comments, captions, bios): waits for the decision
const comment = await client.text.classify({ text: "Great photo!", externalId: "comment-42" });

if (comment.classification.moderation.decision === "approved") {
  // publish it; if comment.classification.moderation.action is "alert", also queue it for review
} else {
  // "rejected": don't publish it
}

// Images and documents: queued, resolved by webhook or assets.retrieve()
const image = await client.assets.create({
  name: "photo.jpg",
  content: { data: file, type: "image/jpeg" },
  externalId: "post-7",
});
console.log(image.classification.status, image.classification.moderation.decision); // "processing" "pending"
```

| `classification.status` | `classification.moderation.decision` | `classification.moderation.action` | Meaning |
| --- | --- | --- | --- |
| `completed` | `approved` | `null` | Safe to show. |
| `completed` | `approved` | `alert` | Show it, but your policy asked to be alerted. |
| `completed` | `rejected` | `hide` or `purge` | Your policy hid or purged it. Don't show it. |
| `pending` or `processing` | `pending` | `null` | Still being received or classified; `upload.status` is `uploading` while parts are arriving. |
| `failed` | `pending` | `null` | Processing failed; see `assets.retry`. |

The latest applied review in `classification.moderation.manualReviews` takes precedence over the automated one in
`classification.moderation.decision`; `classification.moderation.action` keeps what your policy did.

See [How CalmLens works](https://calmlens.com/docs/how-it-works) and [Testing your integration](https://calmlens.com/docs/guides/testing) for test inputs that trigger rejections safely.

## API Reference

### CalmLensServerClient

The client for your server, with every API method. Import it from `@calmlens/sdk/server`.

#### Constructor

```typescript
new CalmLensServerClient(options: CalmLensServerClientOptions)
```

**Options:**
- `apiKey` (string, required): Your CalmLens API key
- `projectId` (string, required): Your CalmLens project ID
- `baseUrl` (string, optional): API base URL (defaults to `https://api.calmlens.com/v1`)
- `cdnBaseUrl` (string, optional): CDN base URL (defaults to `https://cdn.calmlens.com/v1`)
- `fetch` (optional): The `fetch` implementation for every request, for example one with a proxy or instrumentation. Defaults to the global `fetch`
- `uploadFetch`, `cdnFetch` (optional): Override `fetch` for content uploads or for `cdn.serve` only
- `timeoutMs` (positive integer, optional): Deadline for each API request attempt, including reading the response body (defaults to `120000`). For `cdn.serve` it ends when response headers arrive
- `uploadTimeoutMs` (positive integer, optional): Deadline for each binary upload attempt. Unset by default, so large files are never cut off; text content uses `timeoutMs`
- `maxRetries` (integer, optional): Retries for failed requests that are safe to repeat (defaults to `2`, `0` disables them). See [Retries and idempotency](#retries-and-idempotency)
- `maxResponseBytes` (positive integer, optional): Largest JSON response the client reads (defaults to 32 MiB)
- `signal` (AbortSignal, optional): Cancels every request made by this client
- `dangerouslyAllowBrowser` (boolean, optional): Lets the client run in a web page or app. Only for trusted internal tools: anyone who can open the page can read the API key

Options are validated before anything else is set up: a missing `apiKey` or `projectId`, a `timeoutMs` that is not a positive integer, or a `baseUrl`/`cdnBaseUrl` that is not an absolute `http(s)` URL throws a `CalmLensError` with the code `sdk/invalid-config`. The client keeps its API key out of `console.log`, `util.inspect` and `JSON.stringify`.

#### Methods

##### assets.create(options)

Queue an asset for processing and return the created asset immediately.

```typescript
async assets.create(options: SubmitAssetOptions): Promise<Asset>
```

**Options:**
- `name` (string, required): Name of the asset
- `content` (optional): Binary or plain-text content and its concrete MIME type, e.g. `{ plainText: "hello", type: "text/plain" }` or `{ data: file, type: file.type }`
- `url` (string, optional): External URL to fetch instead of sending content
- `part` (optional): First part of a sequential multipart upload
- `description` (string, optional): Description of the asset
- `processingOptions.keepContentAfterProcessing` (boolean, optional): Retain content after processing
- `processingOptions.features` (object, optional): Optional analyses to run, each turned on with `enabled: true`: `ocr`, and in beta `personDetection` and `faceDetection` (with `ageEstimation`). Person and face results are returned in `asset.classification.personDetection` and `asset.classification.faceDetection`. See [People and faces](https://calmlens.com/docs/guides/people-and-faces).
- `visibility` (string, optional): "public" or "private"

**Example:**
```typescript
// Submit from file content
const asset = await client.assets.create({
  name: "document.pdf",
  content: {
    base64: "JVBERi0xLjQKJcfs...",
    type: "application/pdf",
  },
  description: "Important document",
  visibility: "private"
});

// Submit from URL
const asset = await client.assets.create({
  name: "website-content",
  url: "https://example.com/page",
  description: "Web page to classify"
});
```

##### assets.classify(options) and text.classify(options)

Submit an asset and wait for classification to finish. Accepts the same options as `assets.create()` for text, images, documents, and URLs. `text.classify({ text, name?, externalId?, ... })` is a shortcut that sends `text` as `text/plain` content named `text` by default.

```typescript
async assets.classify(options: SubmitAssetOptions): Promise<Asset>
async text.classify(options: ClassifyTextOptions): Promise<Asset>
```

Both resolve to the stored `Asset`, a plain object with camelCase keys exactly as the API returns it:

```typescript
const asset = await client.text.classify({ text: "Great photo!", externalId: "comment-42" });
asset.id;            // string
asset.classification.status;  // "pending" | "processing" | "completed" | "failed"; audio and video keep processing in the background
asset.classification.moderation.decision;  // "pending" | "approved" | "rejected"
asset.classification.moderation.action;  // "alert" | "hide" | "purge", what your policy did with flagged content; null when nothing was flagged
asset.classification.moderation?.score;                         // number, the overall score
asset.classification.moderation.categories?.harassment.status;  // "evaluated" | "partial" | "not-evaluated"
asset.content.status;     // "temporary" | "stored" | "removed"
asset.content.removalReason; // "policy" | "retention" | "requested" | "parent-removed" | "disposed" | null
asset.type;               // "plaintext-document" for text
asset.createdAt;          // milliseconds since the Unix epoch
```

Always present: `id`, `projectId`, `name`, `type`, `createdAt`, `updatedAt`, `upload`, `classification` and `content`. Classification contains its progress, completion time and results grouped by capability. `classification.moderation.categories` and `score` are absent until findings are available; optional detections appear only when requested. Moderation decisions and reviewer details sit under `classification.moderation`. Content is removed after classification unless `processingOptions.keepContentAfterProcessing` is enabled. Check each category’s evaluation `status` before reading its score.

##### assets.retrieve(options)

Retrieve details of a specific asset.

```typescript
async assets.retrieve(options: { assetId: string }): Promise<Asset>
```

**Example:**
```typescript
const asset = await client.assets.retrieve({ assetId: "asset-uuid-here" });
console.log(asset.classification.moderation.decision);
console.log(asset.classification.moderation); // Classification results
```

##### ensureLens(options)

Create a project-scoped named lens, or update it safely. A lens can start at any positive version. Repeating the exact same version and definition is idempotent; any other update must use a version greater than the current one. A stale or conflicting version throws `lens/version-conflict`.

```typescript
const lens = await client.ensureLens({
  identifier: "picmagic-normal",
  name: "PicMagic normal",
  type: "image",
  active: true,
  version: 1,
  transforms: [
    {
      type: "imageTransform",
      options: { fit: "scale-down", width: 1024, format: "png" },
    },
  ],
});

const image = await client.cdn.serve({
  assetIdentifier: assetId,
  lens: lens.identifier,
});
```

For several lenses, use `ensureLenses()` to ensure them together: new definitions go in one request, or in consecutive requests of up to 100 each, in order. Each lens keeps the same independent versioning rules.

```typescript
const [normal, uhd] = await client.ensureLenses({ lenses: [normalLens, uhdLens] });
```

The CDN uses named lenses with an `@` prefix in URLs, such as `/content/@picmagic-normal`. The SDK adds it automatically when you supply `lens`. Use `transform` for one-off direct transforms, either as structured steps, for example `client.cdn.serve({ assetIdentifier: assetId, transform: { type: "imageTransform", options: { format: "png", width: 1024 } } })`, or as a selector string such as `"imageTransform[format=png,width=1024]"`. Pass an array of steps to chain transforms. `assets.createSignedUrl` accepts the same forms. Supply either `lens` or `transform`, not both. The resolved lens version is part of CalmLens's CDN cache and ETag identity, so changing a lens with the next version invalidates prior derived output.

##### assets.list(options)

List assets in your project with pagination.

```typescript
async assets.list(options: {
  cursor?: string;
  pageSize?: number;
  ordering?: Array<{ field: "createdAt" | "id"; direction: "ASC" | "DESC" }>;
  filter?: string | null;
}): Promise<{
  items: Asset[];
  hasMore: boolean;
  nextCursor: string | null;
  pageSize: number;
}>
```

**Example:**
```typescript
const result = await client.assets.list({
  pageSize: 20
});

console.log(`Received ${result.items.length} assets`);
result.items.forEach(asset => {
  console.log(`${asset.name}: ${asset.classification.moderation.decision}`);
});
```

To read every matching asset, iterate instead of paging by hand. Pages are fetched as you go using continuation cursors. Inserting or deleting other assets does not shift the cursor position. To page manually, pass `nextCursor` as `cursor` with the same filters and ordering until it is null. Lists are not snapshots; assets may still be deleted or change filter membership during traversal.

```typescript
for await (const asset of client.assets.iterate({ filter: "classification.moderation.decision==rejected", pageSize: 100 })) {
  console.log(asset.id);
}
```

##### assets.listChildren(options)

List assets extracted from a website or multimedia document.

```typescript
const children = await client.assets.listChildren({
  assetId: parentAssetId,
  pageSize: 20,
});

for await (const child of client.assets.iterateChildren({ assetId: parentAssetId })) {
  console.log(child.name);
}
```

##### assets.createSignedUrl(options)

Create a short-lived URL for private CDN content or previews.

```typescript
const signed = await client.assets.createSignedUrl({
  assetId,
  resource: "preview",
  lens: "thumbnail",
  expiresInSeconds: 900,
});
```

##### assets.move(options)

Move an asset into a folder, or to the project root by passing `null`.

```typescript
// Move asset to a folder
await client.assets.move({
  assetId: "asset-uuid",
  folderId: "folder-uuid",
});

// Move asset to project root
await client.assets.move({
  assetId: "asset-uuid",
  folderId: null,
});
```

##### assets.retry(options)

Process an asset whose processing failed (`classification.status` `failed`) again. It returns to
`processing` and is moderated like a new upload, so handle the result the same way (webhook or polling). Its content must still be stored:
otherwise this throws `asset/content-unavailable`, and you need to upload it again.

```typescript
const asset = await client.assets.retry({ assetId: "asset-uuid" });
// asset.classification.status === "processing"
```

##### assets.waitForDecision(options)

Wait for an asset's moderation decision and get the decided asset: it returns once `classification.moderation.decision`
is `approved` or `rejected`, or `classification.status` is `failed`. The SDK checks the asset every few seconds and rejects with `sdk/timeout` if there's no decision within
`timeoutMs` (default 60000). Pass `signal` to stop waiting early (`sdk/cancelled`). Use it after
`assets.create`, or with an asset ID you stored earlier. Webhooks report decisions without polling.

```typescript
const queued = await client.assets.create({ name: "photo.jpg", content: { blob, type: "image/jpeg" } });
const decided = await client.assets.waitForDecision({ assetId: queued.id, timeoutMs: 30_000 });
if (decided.classification.moderation.decision === "rejected") hidePhoto(decided.id);
```

##### folders.list(options)

Fetch one page of immediate child folders. Omit `parentId` for the project root. The response contains `folders`, visible `ancestors`, and `hasMore`; advance `pageIndex` to load more.

```typescript
const page = await client.folders.list({ parentId: "folder-uuid", pageSize: 100 });
```

##### folders.retrieve(options)

Retrieve details of a specific folder by ID.

```typescript
const folder = await client.folders.retrieve({ folderId: "folder-uuid" });
```

##### folders.create(options)

Create a folder at the project root or nested under another folder.

```typescript
// Create root folder
const marketing = await client.folders.create({ name: "Marketing" });

// Create nested subfolder
const launch = await client.folders.create({
  name: "Launch 2026",
  parentId: marketing.id,
});
```

##### folders.update(options)

Rename an existing folder.

```typescript
const updated = await client.folders.update({
  folderId: "folder-uuid",
  name: "New Name",
});
```

##### folders.move(options)

Move a folder under another folder, or to the project root by passing `parentId: null`. Moving a folder into itself or a descendant throws `folder/parent-cycle`.

```typescript
// Move folder to another parent
await client.folders.move({
  folderId: child.id,
  parentId: anotherParent.id,
});

// Move folder to project root
await client.folders.move({
  folderId: child.id,
  parentId: null,
});
```

##### folders.delete(options)

Delete an empty folder. If the folder still contains assets or child folders, this throws `folder/not-empty`.

```typescript
await client.folders.delete({ folderId: "folder-uuid" });
```

##### cdn.getAssetUrl(options) and cdn.serve(options)

`getAssetUrl` constructs a CDN URL without fetching it. `serve` fetches the resource and sends the client's API key.

```typescript
const url = client.cdn.getAssetUrl({
  assetIdentifier: assetId,
  resource: "content",
  lens: "thumbnail",
});

const response = await client.cdn.serve({
  assetIdentifier: assetId,
  resource: "content",
});
```

`serve` returns the `Response` as soon as headers arrive, so you can stream the body (for example `return new Response(response.body, response)`); `timeoutMs` covers only the wait for headers. Non-2xx responses are returned rather than thrown. Pass `init` for extra `fetch` options such as `method: "HEAD"`.

Private CDN content cannot be read directly with API keys. Use a short-lived signed URL for application clients.

##### Multipart upload flow

Use `create` with `part` to start multipart uploads, and `uploadPart` for subsequent chunks. `partNumber` defaults to `1` and `isFinal` defaults to `false` when starting an upload.

The queue mode is chosen when the upload starts and saved by CalmLens: an upload started with `create` is queued when its final part arrives, one started with `classify` waits for the decision. Later parts can come from another process that only knows the asset ID. Pass `queue` to `uploadPart` to override the saved choice for the final part. Pass `totalSizeInBytes` when you start the upload if you know the file's size, so CalmLens rejects an upload that could never finish before you send the rest.

Image upload sizes use distinct direct and multipart paths:

- Direct image uploads must be smaller than `10MB`.
- Multipart image uploads must total between `10MB` and `20MB`, inclusive. CalmLens accumulates the uploaded parts and rejects a final image outside that range; callers do not need to provide a total-size field.
- Retained multipart image originals remain in private backing storage. Public or authorized delivery and transformations use CalmLens CDN URLs.

Each non-final multipart part must be at least `5MiB`; only the final part may be smaller. If you send base64, split the original bytes first, then base64-encode each part. Do not split one full base64 string into substrings.

Payloads can be sent as `{ plainText: string }` (text content only), `{ base64: string }`, `{ uint8Array: number[] | Uint8Array }`, `{ buffer: Buffer | ArrayBuffer }`, `{ data: Blob | Response | ReadableStream }`. Use `{ data: file }` for `File` objects. To upload a file from disk in Node.js without reading it into memory, pass `{ data: await openAsBlob(path), type }` (`openAsBlob` from `node:fs`); unlike a stream, a `Blob` can be sent again if a retry is needed. Upload metadata is URL query data and the SDK sends the binary payload as the raw request body without constructing multipart form data. Multipart `ReadableStream` uploads must include the exact `sizeInBytes` so CalmLens can stream each part without buffering it.

Use a concrete asset MIME type such as `image/png`, `application/pdf`, or `text/plain`. The SDK rejects ambiguous/container request MIME types such as `application/octet-stream` and `multipart/*`.

**Example (queued finalization):**
```typescript
const uploading = await client.assets.create({
  name: "large-image.png",
  part: {
    uint8Array: firstPartBytes,
    type: "image/png"
  }
});

await client.assets.uploadPart({
  assetId: uploading.id,
  part: {
    base64: secondPartBase64,
    partNumber: 2,
  },
});

const completed = await client.assets.uploadPart({
  assetId: uploading.id,
  part: {
    base64: finalPartBase64,
    partNumber: 3,
    isFinal: true,
  },
});
```

**Example (single-call synchronous analysis):**
```typescript
const analyzed = await client.assets.classify({
  name: "large-image.png",
  part: {
    base64: finalPartBase64,
    type: "image/png",
    isFinal: true
  }
});
console.log(analyzed.classification.moderation.decision);
```

#### Static Methods

##### verifyWebhookSignature(options)

Verify that a webhook delivery came from CalmLens and is fresh. Also exported as a standalone `verifyWebhookSignature` function; see [Webhooks](#webhooks) for `parseWebhookEvent`, which verifies and parses in one step.

```typescript
static async verifyWebhookSignature(options: {
  payload: string | Uint8Array | ArrayBuffer; // the raw request body (a Buffer works too)
  signature?: string | null;          // x-calmlens-signature header
  timestamp?: string | number | null; // x-calmlens-timestamp header
  headers?: Headers | Record<string, string | string[] | undefined>; // read when signature/timestamp are omitted
  secret: string;
  toleranceSeconds?: number;          // default WEBHOOK_SIGNATURE_TOLERANCE_SECONDS (300)
  now?: Date | number;                // default Date.now(), for tests
}): Promise<boolean>
```

It returns `true` only when the `x-calmlens-signature` header contains a `v1=` HMAC-SHA256 of `"<timestamp>.<raw body>"` (one match in a comma-separated list is enough) and the timestamp is within `toleranceSeconds` of now. Passing parsed JSON as `payload` throws `sdk/invalid-argument`: re-serializing it can change the signed bytes.

## Browser and app uploads with upload presets

`CalmLensAppClient` uploads from a browser or app through an upload preset, without an API key. Create presets in the portal under Developer → Upload presets.

```ts
import { CalmLensAppClient } from "@calmlens/sdk/app";

// In the browser: no API key
const client = new CalmLensAppClient({
  uploadPresetId: "your-upload-preset-id",
  // Only for presets that require a token: called once per new upload
  token: () => fetch("/api/upload-token", { method: "POST" }).then((r) => r.json()).then((b) => b.token),
});

const asset = await client.assets.classify({ name: file.name, content: { data: file, type: file.type } });
// asset.status (the moderation status) is present when the preset shows decisions to uploaders
```

**Options:** `uploadPresetId` (required), `token` (a string, or a function that returns one or a promise of one), plus `baseUrl`, `fetch`, `uploadFetch`, `timeoutMs`, `uploadTimeoutMs`, `maxRetries`, `maxResponseBytes` and `signal` as for `CalmLensServerClient`. Passing `apiKey` throws `sdk/invalid-config`.

The client has `assets.create`, `assets.classify`, `assets.uploadPart` and `assets.retrieve`, for its own uploads, and each returns an `UploadedAsset`. It fetches a new token for each upload and reuses that token for the upload's parts and status checks.

The same client works in React Native and Expo apps. Mobile apps send no `Origin` header, so use a preset that requires a token and leave its allowed sites empty. Pass the picked file's bytes, for example `content: { buffer: await new File(uri).arrayBuffer(), type }` with `expo-file-system`. See the [Calmsnap example](https://github.com/CalmLens/sdks/tree/main/examples/mobile-uploads-expo).

On your server, sign a single-use token for each upload with `CalmLensServerClient`. Signing is local and makes no request:

```ts
const { token, expiresAt } = await client.uploadTokens.sign({
  uploadPresetId: "your-upload-preset-id",
  externalId: "post-42", // optional
  expiresInSeconds: 600, // optional, up to 3600
});
```

Server uploads can also pass `uploadPresetId` to `assets.create` or `assets.classify` to apply a preset's folder, visibility, file types and size limit. See [Upload presets](https://calmlens.com/docs/guides/upload-presets).

## Asset Types

Assets can be of the following types:
- `image` - Images (JPEG, PNG, GIF, WebP, etc.)
- `video` - Video files (MP4, WebM, etc.)
- `audio` - Audio files (MP3, WAV, etc.)
- `plaintext-document` - Plain-text formats such as TXT, JSON, CSV, and YAML
- `multimedia-document` - Documents such as PDF, DOCX, DOC, RTF, and ODT
- `website` - Web pages and URLs
- `file` - Other supported binary files

## Asset Status

Upload, classification and content each have a status; moderation has its own decision:

- `upload.status`: `uploading` while source content is arriving, then `completed`
- `classification.status`: `pending`, `processing`, `completed` or `failed`
- `classification.moderation.decision`: `pending` until moderation finishes, then `approved` or `rejected`. The latest applied review in `classification.moderation.manualReviews` takes precedence over the automated one. `classification.moderation.action` is what your policy did with flagged content (`alert`, `hide` or `purge`), or `null` when nothing was flagged; an `alert` leaves the asset `approved`.
- `content.status`: `temporary` (kept only until processing finishes), `stored` or `removed`, with `content.removalReason` `policy` (purged), `retention` (`keepContentAfterProcessing` off), `requested`, `parent-removed` or `disposed`

## Moderation Reports

Completed reports always contain the six parent categories: `sexual`, `violence`, `self-harm`, `harassment`, `hate`, and `criminal-activity`. Category-specific detail is nested under `qualifiers`, for example `classification.moderation.categories.violence.qualifiers["violence-graphic"]`. Reports have no `subcategories` field or dedicated minor-safety placeholder. Retired generic qualifier IDs are rejected.

Always narrow on a category's `status` before reading `score`. An `evaluated` or `partial` result includes `score` and `likelihood`; a `not-evaluated` result includes a reason and represents unknown coverage, not a safe zero score.

```typescript
const violence = asset.classification.moderation.categories?.violence;
if (violence?.status === 'evaluated' || violence?.status === 'partial') {
  console.log(violence.score);
}
```

See the [classification results guide](https://calmlens.com/docs/guides/classification-results) for aggregation, provider coverage, OCR merging, and policy actions. General Sexual Content moderation does not estimate age or provide dedicated CSAM detection.

## Asset Visibility

- `public` - Retained content can be requested directly from the CDN
- `private` - Retained content requires a signed URL or an authenticated owner session

## Error Handling

Every failure is a `CalmLensError`, whether the API returned an error or the request never completed. Branch on its stable `code`:

```typescript
import { CALMLENS_ERROR_CODES, CalmLensError } from "@calmlens/sdk";

try {
  await client.assets.retrieve({ assetId });
} catch (error) {
  if (!CalmLensError.isCalmLensError(error)) throw error;
  if (error.code === CALMLENS_ERROR_CODES.ASSET_NOT_FOUND) return undefined;
  console.error(error.code, error.status, error.requestId, error.details);
  throw error;
}
```

| Property | Meaning |
| --- | --- |
| `code` | A stable identifier such as `asset/not-found` or `sdk/timeout`. `CALMLENS_ERROR_CODES` lists the documented ones |
| `status` | The HTTP status, when the API responded |
| `requestId` | The `X-Request-Id` response header. Include it when you contact support |
| `headers` | The response headers, when the API responded |
| `retryAfter` | Seconds to wait, from the `Retry-After` header (on `429` and `idempotency/request-in-progress`) |
| `details` | Structured diagnostics from the API, such as validation issues and `traceId` |
| `cause` | The underlying error, for transport failures |

`error.isNotFound()` is true for `404`, and `error.isRetryable()` for transport failures, `429`, `502`, `503`, `504` and `idempotency/request-in-progress`. `instanceof CalmLensError` and `CalmLensError.isCalmLensError(error)` recognise errors from any copy of the SDK, including the ES module and CommonJS builds loaded side by side.

Codes the SDK raises itself:

| Code | Meaning |
| --- | --- |
| `sdk/invalid-argument` | A method argument is missing or invalid, for example an empty `assetId` |
| `sdk/invalid-config` | The client options are invalid |
| `sdk/transport-error` | The request could not be completed (DNS, TLS, refused or reset connections, truncated bodies, decompression errors) |
| `sdk/timeout` | A deadline passed |
| `sdk/cancelled` | Your `AbortSignal` cancelled the request |
| `sdk/invalid-response` | A successful response whose body is not the expected JSON |
| `sdk/http-error` | An HTTP failure without a CalmLens error body, for example from a proxy |
| `sdk/response-too-large` | A response larger than `maxResponseBytes` |
| `sdk/invalid-webhook-signature`, `sdk/invalid-webhook-payload` | Thrown by `parseWebhookEvent` |

Upload content is checked before it is sent with the same codes the API uses, such as `upload/invalid-payload` and `upload/invalid-mime-type`.

## Retries and idempotency

The client retries a request when repeating it is safe: reads (`GET`), and creates and uploads, which always carry an `Idempotency-Key` header. It retries failures that happened before any response, `429`, `502`, `503`, `504` and `idempotency/request-in-progress`, up to `maxRetries` times (default 2) with jittered exponential backoff, waiting for `Retry-After` when the API sends one (up to 60 seconds; longer waits are returned to you as the error's `retryAfter`). Other writes, such as `assets.move`, and uploads of a `ReadableStream`, which the first attempt consumed, are never retried.

`assets.create`, `assets.classify`, `text.classify` and `assets.uploadPart` generate a new key for each call and reuse it for their own retries, so a retry returns the original response instead of creating a second asset. To retry safely across processes or restarts, pass your own key:

```typescript
await client.text.classify({
  text: comment.body,
  externalId: `comment-${comment.id}`,
  idempotencyKey: `comment-${comment.id}`,
});
```

The API keeps a response for 24 hours. Reusing a key for a different request fails with `idempotency/key-reused`.

## Forward compatibility

The SDK does not validate responses against its types, so fields and values added to the API later reach your code unchanged. `AssetClassificationStatus`, `AssetModerationStatus`, `AssetModerationAction`, `AssetReviewerAction`, `AssetContentStatus`, `AssetContentRemovalReason`, `AssetType` and `AssetVisibility` include `string` for that reason: handle values you don't know (for example, treat an unknown status as "not ready"). Event types and fact keys are typed for the ones this version knows; keep a default branch when you switch on them.

## Testing

`@calmlens/sdk/testing` exports `MockCalmLensServerClient`, an in-memory stand-in for `CalmLensServerClient`,, in-memory storage implementations, mock API key helpers, webhook delivery builders and `generateMediaTestCode`, for testing without network requests. `generateMediaTestCode(signal, testInputKey)` asynchronously returns the spoken or on-screen test phrase authenticated with your project's secret test input key, shown under **Assets → Try it → Test inputs** in the portal; a phrase with another project's key is moderated normally.

The `@calmlens/sdk`, `/server` and `/app` entry points do not load or export testing helpers, to keep production bundles small. Keep `/testing` imports in test files.

```typescript
import { MockCalmLensServerClient, createMockApiKey } from "@calmlens/sdk/testing";

const client = new MockCalmLensServerClient({
  apiKey: createMockApiKey(),
  projectId: crypto.randomUUID(),
});
```

`MockCalmLensServerClient` accepts the same options as `CalmLensServerClient` (`apiKey`, `projectId`, `baseUrl`, `cdnBaseUrl`, `timeoutMs`, ...) and validates them the same way, plus `mockOptions`. `cdn.getAssetUrl` uses `cdnBaseUrl` (default `mock://calmlens/v1`).

It behaves like the API where tests depend on it: errors carry the API's code, HTTP `status`, a `requestId` and `headers`; `assets.list` applies `ordering`, `folderId` and simple `filter` expressions (comparisons joined by `;` and `,`; anything else throws `sdk/invalid-argument` rather than returning wrong results); `assets.search` matches names, IDs, external IDs, descriptions and tags; multipart parts must arrive in order and the queue mode chosen at the start applies to the final part; `mockOptions.queuedOutcome` (default `pending`) and `mockOptions.analyzedOutcome` (default `approved`) set where queued and waited-for uploads end up (`pending`, `approved`, `rejected` or `failed`); content is removed with reason `retention` once processing is done unless `keepContentAfterProcessing` is set, and `assets.deleteContent` removes it with reason `requested`; a reused `idempotencyKey` replays the first result; and `cdn.serve` returns CDN-like responses with JSON error bodies. `client.enqueueEvent({ type, ... })` adds an event that `events.list` and `events.pages` then return.

Every call is recorded in `client.calls` as `{ operation, options }`, where `operation` is the method path (`"text.classify"`, `"assets.retrieve"`, `"events.list"`, ...) and `options` is the object you passed. `client.callsTo(operation)` filters them. To test failure handling, `client.failNextRequest()` makes the next call throw the same `CalmLensError` the real client throws when the network fails (`sdk/transport-error`); pass `"timeout"` for `sdk/timeout`, or any `Error` to throw it as is, and `{ operation }` to fail only that method. Each queued failure is used once.

```typescript
const client = new MockCalmLensServerClient({ apiKey: createMockApiKey(), projectId, timeoutMs: 5_000 });

client.failNextRequest("timeout", { operation: "text.classify" });
await expect(postComment(client, "hello")).rejects.toMatchObject({ code: "sdk/timeout" });

await postComment(client, "hello");
expect(client.callsTo("text.classify")[0]?.options).toMatchObject({ text: "hello" });
```

To test a webhook handler, build a signed delivery the way CalmLens sends it:

```typescript
import { createWebhookHeaders, toWebhookEventPayload } from "@calmlens/sdk/testing";

const event = client.enqueueEvent({ type: "asset.approved", assetId: asset.id });
const body = JSON.stringify(toWebhookEventPayload(event));
const headers = await createWebhookHeaders({ secret, body, deliveryId: "delivery-1" });
const response = await app.request("/api/webhooks/calmlens", { method: "POST", body, headers });
```

For `mockOptions`, deterministic timestamps and IDs, storage inspection, and testing recipes, see the [JavaScript SDK Testing Guide](https://calmlens.com/docs/sdk/javascript/testing).

## Webhooks

A `webhook` connector POSTs each event to your URL as JSON:

```json
{
  "id": "…",
  "type": "asset.flagged",
  "createdAt": 1760000000000,
  "projectId": "…",
  "data": {
    "severity": "high",
    "title": "…",
    "description": null,
    "assetId": "…",
    "asset": null,
    "facts": [{ "key": "asset-name", "value": "photo.jpg" }]
  }
}
```

Each delivery has these headers (the names are exported as constants):

| Header | Constant | Value |
|---|---|---|
| `x-calmlens-delivery` | `WEBHOOK_DELIVERY_HEADER` | Delivery ID (the same across retries) |
| `x-calmlens-timestamp` | `WEBHOOK_TIMESTAMP_HEADER` | Unix time in seconds when the delivery was signed |
| `x-calmlens-signature` | `WEBHOOK_SIGNATURE_HEADER` | `v1=<lowercase hex HMAC-SHA256(secret, "<timestamp>.<raw body>")>` |

Verify the exact raw request body before parsing it; re-serializing parsed JSON can change the signed bytes. `parseWebhookEvent` verifies the delivery and returns the parsed event, or throws `sdk/invalid-webhook-signature` (bad signature or a timestamp more than `WEBHOOK_SIGNATURE_TOLERANCE_SECONDS`, 5 minutes, from your clock, which stops replays) or `sdk/invalid-webhook-payload`. `verifyWebhookSignature` takes the same options and returns a boolean. Both accept the body as a string, `Uint8Array`/`Buffer` or `ArrayBuffer`, and read the two headers from `headers` (a `Headers` object or Node's `req.headers`) when you don't pass `signature` and `timestamp`.

The result is typed as an extensible `WebhookEventPayload`. Event types and fact keys may be unfamiliar, and fact values are `unknown`; validate the facts your handler uses. Extra fields remain available. The [webhooks guide](https://calmlens.com/docs/guides/webhooks#event-types) lists current event types. Deliveries are retried, so make your handler idempotent by `event.id`.

**Fetch API** (Next.js route handlers, Remix, Cloudflare Workers, Bun, Deno):

```typescript
import { CalmLensError, parseWebhookEvent } from "@calmlens/sdk/server";

export async function POST(request: Request) {
  let event;
  try {
    event = await parseWebhookEvent({
      payload: await request.text(),
      headers: request.headers,
      secret: process.env.CALMLENS_WEBHOOK_SECRET!,
    });
  } catch (error) {
    if (CalmLensError.isCalmLensError(error)) return new Response("Invalid delivery", { status: 401 });
    throw error;
  }
  // Queue the work, keyed by event.id, then respond quickly.
  return new Response(null, { status: 204 });
}
```

**Express**: use `express.raw()` for this route so `req.body` is the unparsed `Buffer`:

```typescript
app.post("/api/webhooks/calmlens", express.raw({ type: "application/json" }), async (req, res) => {
  try {
    const event = await parseWebhookEvent({
      payload: req.body,
      headers: req.headers,
      secret: process.env.CALMLENS_WEBHOOK_SECRET!,
    });
    // ...
    res.sendStatus(204);
  } catch {
    res.sendStatus(401);
  }
});
```

**Hono**: `payload: await c.req.text()`, `headers: c.req.raw.headers`.

**Fastify**: register a raw body parser for the route, for example `fastify.addContentTypeParser("application/json", { parseAs: "buffer" }, (_req, body, done) => done(null, body))`, then pass `payload: request.body` and `headers: request.headers`.

## Command-line tool

Install the standalone [CalmLens CLI](https://calmlens.com/docs/guides/local-development) through Homebrew, a platform download or npm. Webhook connectors must use public HTTPS URLs, so during development use it to forward events to a local handler instead. Each event is sent with the same body, headers and signature as a real delivery:

```bash
npx calmlens listen --forward-to http://localhost:3000/api/webhooks/calmlens --env-file .env.local
```

The CLI reads `CALMLENS_API_KEY`, `CALMLENS_PROJECT_ID` and `CALMLENS_WEBHOOK_SECRET` from the environment or `--env-file`; without a secret it prints a generated one for your app. `npx calmlens trigger [harassment|hate|criminal-activity|clean]` moderates a harmless test input so events appear (one upload each). Run `npx calmlens --help` for all options. To install the command globally, use `npm install -g calmlens`. The CLI is released separately from the SDK.

The same feed is available in code with [`events.list`](#events-feed).

## Events feed

`client.events.list({ after?, limit? })` reads the project's events, oldest first, without a public webhook URL. It resolves to an `EventsPage`:

```typescript
{
  events: TypedEvent[]; // { id, projectId, type, severity, title, description?, assetId?, asset?, facts, createdAt, updatedAt }
  cursor: string;       // pass back as `after` to continue after the last event returned
  hasMore: boolean;     // true when more events are already waiting after `cursor`
}
```

- Without `after` (or with an empty string), it returns **no events** and a `cursor` for the current time, so you only see events created after you start reading. It does not return history.
- With `after`, it returns up to `limit` events (default 50) created after that cursor. When there are none, `cursor` is the `after` you passed.
- Keep passing the latest `cursor` as `after` until `hasMore` is `false`, then wait before polling again. Store the cursor if you want to resume after a restart.
- An unknown or malformed cursor fails with the `CalmLensError` code `events/invalid-cursor`.

`client.events.pages({ after, limit })` follows the cursor for you: it yields each page until no more events are waiting.

```typescript
let { cursor } = await client.events.list(); // no events, cursor = "now"

async function drainEvents() {
  for await (const page of client.events.pages({ after: cursor, limit: 100 })) {
    for (const event of page.events) {
      // narrow on event.type to read its typed facts
      console.log(event.type, event.facts);
    }
    cursor = page.cursor; // save it to resume after a restart
  }
}

setInterval(drainEvents, 5_000);
```

Events carry `facts: { key, value, url? }[]`; webhook deliveries carry the same events reshaped as `{ id, type, createdAt, projectId, data }`.

## Request budgets

Set `timeoutMs` (default 120000), `uploadTimeoutMs`, `maxRetries` or `signal` on the client. Use `client.withRequestOptions({ signal, timeoutMs: 30000 })` to scope them to an operation without changing the original client; the scoped client shares the original's credentials and lens cache. `timeoutMs` applies to each attempt and includes reading the response body; binary uploads have no deadline unless you set `uploadTimeoutMs`, and `cdn.serve`'s deadline ends when headers arrive, so large transfers are never cut off. Requests never follow redirects, so the API key is never sent to another origin.

Requests send `User-Agent: calmlens-js/<version> (<runtime>/<version>)` from server runtimes; `SDK_VERSION` exports the version. Core model types (`Asset`, `Folder`, `Lens`, `AssetPage`, `EventsPage`, `ClassificationReport`) and request types are exported from the package root.

`text.classify` is a convenience wrapper around asset moderation: it supplies `text/plain` content and defaults the asset name to `text`. `assets.create` queues processing; `assets.classify` waits for classification.

## Releasing

Stable releases are published automatically from `main` when packed SDK contents differ from npm `latest` and an SDK Changeset is present. Contributors must run `bun run changeset` to choose the release type and write release notes. CI updates and commits this package's `CHANGELOG.md` automatically. See the repository's [.changeset release guide](../../.changeset/README.md).

### Test-input images

The optional `@calmlens/sdk/test-inputs` entry generates and recognises the same
project-specific colour grids used by the CalmLens portal:

```ts
import { paintTestImage, detectTestImage } from "@calmlens/sdk/test-inputs";

const width = 512;
const height = 512;
const rgba = await paintTestImage("violence", projectTestInputKey, width, height);
const signal = await detectTestImage({ width, height, rgba }, projectTestInputKey);
// signal === "violence"
```

Encode the returned RGBA bytes with your image library to download a PNG. To
recognise a downloaded image, decode it into RGBA first. These helpers have no
DOM, image-codec, or Cloudflare dependencies. The grid tolerates resizing and
lossy compression; cropping, rotation, and severe colour changes are unsupported.
The entry also exports `generateTestTextCode` and `detectTestTrigger` for text
test inputs. Use your project's test input key; another project's key does not
activate its test signals.

Image moderation considers readable text directly. Optional OCR (`processingOptions.features.ocr.enabled: true` on the wire) adds a text moderation pass and stores retained text in the image’s `content.extractedText`. No separate text child is created. Read the image’s combined `classification.moderation`; removing its content also removes the extracted text.
