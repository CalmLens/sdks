# CalmLens Go SDK

Go 1.22+ client for the CalmLens public API. Uses only the standard library. Includes
typed responses, context cancellation, streaming uploads and downloads, safe automatic
retries, pagination iterators, webhook verification and an in-memory testing package
(`calmlenstest`).

## Install and quick start

Install the SDK:

```sh
go get github.com/CalmLens/sdks/go@latest
```

```go
package main

import (
    "context"
    "fmt"
    "log"
    "os"

    calmlens "github.com/CalmLens/sdks/go"
)

func main() {
    client, err := calmlens.NewServerClient(calmlens.Options{
        APIKey: os.Getenv("CALMLENS_API_KEY"),
        ProjectID: os.Getenv("CALMLENS_PROJECT_ID"),
    })
    if err != nil { log.Fatal(err) }
    asset, err := client.Assets.Classify(context.Background(), calmlens.SubmitAssetOptions{Name: "text", Content: &calmlens.Content{Type: "text/plain", PlainText: calmlens.Ptr("Great photo!")}, ExternalID: calmlens.Ptr("comment-42")})
    if err != nil { log.Fatal(err) }
    fmt.Println(asset.Classification.Moderation.Status)
}
```

`NewServerClient` validates every option before doing any other setup: a missing API key or
project ID, a negative timeout or retry count, or a base URL that is not an absolute
HTTP(S) URL returns a `*calmlens.Error` with code `sdk/invalid-config`. The client is
safe for concurrent use. `Options`, `ServerClient` and errors never print the API key.

| Option | Default | Meaning |
| --- | --- | --- |
| `BaseURL`, `CDNBaseURL` | `https://api.calmlens.com/v1`, `https://cdn.calmlens.com/v1` | API and CDN endpoints. |
| `Timeout` | `DefaultTimeout` (120 s) | Bounds each attempt of a JSON API call, including the response body. Uploads and `CDN.Serve` are never cut off by it. |
| `ConnectTimeout` | `DefaultConnectTimeout` (10 s) | Dial and TLS handshake (default transport only). |
| `ResponseHeaderTimeout` | `DefaultResponseHeaderTimeout` (120 s) | Wait for response headers after the request is sent (default transport only). |
| `MaxRetries` | `DefaultMaxRetries` (2) | Retries for retryable failures; `calmlens.Ptr(0)` disables them. |
| `MaxResponseBytes` | `DefaultMaxResponseBytes` (32 MiB) | Largest API response body read; larger ones fail with `sdk/response-too-large`. |
| `HTTPClient` | a client with the timeouts above | Sends every request. A copy is used with redirects disabled, so credentials stay on the configured endpoint. |

### Timeouts and large transfers

The default transport bounds connecting and waiting for headers, never the transfer
itself, so uploading a large file or streaming a CDN download can take as long as it
needs. Bound any call, including those, with a context deadline:

```go
ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
defer cancel()
asset, err := client.Assets.Create(ctx, options)
```

If you supply `HTTPClient`, keep its `Timeout` at zero: `http.Client.Timeout` covers the
whole request, including upload and download bodies.

Every request sends `User-Agent: calmlens-go/<Version> (<Go version>; <OS>/<arch>)`.
`calmlens.Version` is the SDK version.

## API mapping

| JavaScript | Go |
| --- | --- |
| `assets.create/classify` | `Assets.Create/Classify(ctx, SubmitAssetOptions)` |
| `assets.retrieve/retry` | `Assets.Retrieve/Retry(ctx, AssetIDOptions)` |
| `assets.explain` | `Assets.Explain(ctx, ExplainAssetOptions)` |
| `assets.waitForDecision` | `Assets.WaitForDecision(ctx, WaitForDecisionOptions)` |
| `assets.update` | `Assets.Update(ctx, UpdateAssetOptions)` |
| `assets.list` | `Assets.List(ctx, ListAssetsOptions)`; every page: `Assets.ListAll(ListAssetsOptions)` |
| `assets.listChildren` | `Assets.ListChildren(ctx, ListAssetChildrenOptions)`; every page: `Assets.ListChildrenAll(…)` |
| `assets.search` | `Assets.Search(ctx, SearchAssetsOptions)` |
| `assets.uploadPart` | `Assets.UploadPart(ctx, UploadAssetPartOptions)` |
| `assets.deleteContent` | `Assets.DeleteContent(ctx, AssetIDOptions)` |
| `assets.delete` | `Assets.Delete(ctx, AssetIDOptions)` (returns only `error`) |
| `assets.move` | `Assets.Move(ctx, MoveAssetOptions)` |
| `assets.createSignedUrl` | `Assets.CreateSignedURL(ctx, SignedURLOptions)` |
| `folders.list` | `Folders.List(ctx, ListFoldersOptions{})` |
| `folders.retrieve/delete` | `Folders.Retrieve/Delete(ctx, FolderIDOptions)` |
| `folders.create/update/move` | `Folders.Create/Update/Move(ctx, …FolderOptions)` |
| `events.list` | `Events.List(ctx, ListEventsOptions)`; follow the cursor: `Events.ListAll(ListEventsOptions)` |
| `ensureLens/ensureLenses` | `EnsureLens/EnsureLenses(ctx, …Options)` |
| `cdn.getAssetUrl/serve` | `CDN.GetAssetURL(CDNAssetURLOptions)` / `CDN.Serve(ctx, CDNServeOptions)` |
| `verifyWebhookSignature` | `VerifyWebhookSignature(rawBody, signature, timestamp, secret, ...WebhookOption)` |
| `constructEvent`-style helper | `ParseWebhookEvent(rawBody, signature, timestamp, secret, ...WebhookOption)`, `VerifyWebhookRequest(r, secret, ...WebhookOption)` |
| webhook signing (tests, local forwarding) | `SignWebhookPayload(rawBody, timestamp, secret)` |

Every method returns `nil` (or a zero value) together with a non-nil error.
Use `calmlens.Ptr(value)` for optional scalars. `MoveAssetOptions.FolderID == nil` and
`MoveFolderOptions.ParentID == nil` move to the root. Asset updates send only the fields
you set: a nil `Name` and a zero `calmlens.Patch` are left unchanged, `calmlens.Set(value)`
changes a field and `calmlens.Null[T]()` clears it:

```go
asset, err := client.Assets.Update(ctx, calmlens.UpdateAssetOptions{
    AssetID:     assetID,
    Description: calmlens.Null[string](),
    Tags:        calmlens.Set([]string{"reviewed"}),
})
signed, err := client.Assets.CreateSignedURL(ctx, calmlens.SignedURLOptions{
    AssetID: assetID, Resource: calmlens.ResourceRendered, Lens: "thumbnail",
})
```

`Create` queues processing; `Text.Classify` and `Assets.Classify` wait for classification.
`WaitForDecision` retrieves an asset until its `Classification.Moderation.Status` is no longer
`pending`, or its `Classification.Status` is `failed`, and returns that asset, checking every few seconds. It
returns `sdk/timeout`, with `Details` `{"assetId", "classificationStatus", "moderationStatus"}`, if
there is no decision within `Timeout` (default
`DefaultDecisionTimeout`, 60s); cancel `ctx` to stop early (`sdk/cancelled`). Webhooks
report decisions without polling:

```go
queued, err := client.Assets.Create(ctx, calmlens.SubmitAssetOptions{Name: "photo.jpg", Content: &calmlens.Content{Type: "image/jpeg", Data: file}})
decided, err := client.Assets.WaitForDecision(ctx, calmlens.WaitForDecisionOptions{AssetID: queued.ID, Timeout: 30 * time.Second})
if err == nil && decided.Classification.Moderation.Status != calmlens.ModerationStatusAllowed {
    blockPhoto(decided.ID)
}
```

`Retry` processes an asset whose processing failed again (processing returns to `processing`
and moderation to `pending`). `DeleteContent` removes stored content but keeps the record and
report (the result's `Content.Status` is `removed` with `RemovalReason` `requested`, and the CDN
stops serving it); `Delete` removes the record and its content. Lists default to page index 0;
signed URLs default to the rendered resource and 900 seconds. Lens ensures cache full definitions,
deduplicate batches/concurrent calls, and invalidate prior definitions by identifier.

### Pagination

`ListAll`, `ListChildrenAll` and `Events.ListAll` return iterators that fetch pages
lazily:

```go
it := client.Assets.ListAll(calmlens.ListAssetsOptions{PageSize: 100, Filter: calmlens.Ptr("classification.moderation.status==allowed")})
for it.Next(ctx) {
    fmt.Println(it.Asset().ID)
}
if err := it.Err(); err != nil { return err }
```

On Go 1.23 or later you can range over `All`, which yields `(item, error)` pairs; a
failure is yielded once and ends the loop:

```go
for asset, err := range client.Assets.ListAll(options).All(ctx) {
    if err != nil { return err }
    fmt.Println(asset.ID)
}
```

### Classification results

`Assets.Classify`, `Assets.Create`, and `Text.Classify` return `(*calmlens.Asset, error)`.
`Asset` is a typed struct with exported Go field names (`ID`, `Processing`, `Moderation`,
`Content`, ...); it decodes from, and marshals back to, the API's camelCase JSON keys (`id`,
`processing`, `moderation`, `content`, ...). The state is in three nested structs:

- `Upload` (`AssetUpload`): `Status` is `uploading` or `completed`; `PartsReceived` counts multipart parts while they arrive, and `UpdatedAt` records the latest upload state change.
- `Classification` (`AssetClassification`): `Status` is `pending`, `processing`, `completed` or `failed`, with `UpdatedAt` and `CompletedAt`. Optional `PersonDetection`, `FaceDetection` and `Labels` sit alongside `Moderation`, which holds `Status`, `Categories`, `Score`, `Timeline`, `Policy` and reviewer details. Reviewer actions do not change classification completion time.
- `Content` (`AssetContent`): `Status` is whether CalmLens holds the content
  (`ContentStatusTemporary` until processing finishes, `ContentStatusStored` or
  `ContentStatusRemoved`, with `RemovalReason`), plus `Format` (MIME type), `Extension`,
  `SizeInBytes`, `Checksums`, `Image`, `SafetyHold` and `ExtractedText`.

Fields that may be missing are pointers, maps, or slices and are `nil` when absent:
`Classification.Moderation.Categories` is `nil` until classification produces findings, and optional fields such as `Content.SizeInBytes`,
`FolderID`, `ExternalID` and `Description` are `nil`
when unset. Inside a report, `Categories` is keyed by category name and each
`CategoryResult.Score` is `*float64`:

```go
asset, err := client.Text.Classify(ctx, calmlens.ClassifyTextOptions{Text: comment})
if err != nil { return err }
switch asset.Classification.Moderation.Status {
case calmlens.ModerationStatusAllowed:
    publish(comment)
case calmlens.ModerationStatusAgeRestricted:
    publishBehindAgeGate(comment) // deliver only through signed URLs to verified adults
default:
    // pending, blocked, purged or a status added later: don't show it
}
```

Every field of an asset and its report is typed: `Content.Checksums`, `Content.Image`,
`Content.SafetyHold`, `Content.ExtractedText`, `ProcessingOptions`,
report `Labels` (`[]ClassificationLabel`) and category `Qualifiers`
(`map[string]QualifierResult`, keyed by the `Qualifier...` constants). Enumerations such as
the processing, moderation and content statuses, `Type`, `Visibility`,
`Likelihood` and result `Status` are plain strings with exported constants
(`ClassificationStatus...`, `ModerationStatus...`, `ContentStatus...`, `ContentRemovalReason...`,
`ModerationDecision...`, `AssetType...`, `ModerationAction...`, `Likelihood...`, `ResultEvaluated`, `Category...`), so
values added to the API later still decode; treat an unknown status as
"not allowed". `Asset`, reports, category results and events expose `Raw` with every field
the API sent, including ones added after this SDK version. Numbers in `Raw`, metadata
values and fact values decode as `json.Number`, so large integers keep their precision. An
absent category `Score` is `nil`, not a safe zero. Check the category's `Status` before
reading it.

Processing options are typed; unset fields are not sent:

```go
asset, err := client.Assets.Classify(ctx, calmlens.SubmitAssetOptions{
    Name:    "photo.jpg",
    Content: &calmlens.Content{Data: file, Type: "image/jpeg"},
    ProcessingOptions: &calmlens.ProcessingOptions{
        KeepContentAfterProcessing: calmlens.Ptr(true),
        FlaggedContentPolicy:       &calmlens.FlaggedContentPolicy{Action: calmlens.ModerationActionBlock},
        Features: &calmlens.ProcessingFeatures{
            FaceDetection: &calmlens.FaceDetectionFeatureOptions{Enabled: true, AgeEstimation: calmlens.Ptr(true)},
        },
    },
})
```

Person and face detection (beta) results are in `Report.Features`, typed as
`PersonDetectionResult` and `FaceDetectionResult`; each feature is `nil` when it wasn't
requested. See [People and faces](https://calmlens.com/docs/guides/people-and-faces).

## Uploads

Supply exactly one of `Content`, `Part`, or `URL`. `Content` accepts exactly one of
`PlainText`, `Base64` (including data URLs), `Bytes`, or `Data` (`io.Reader`). Uploads
send raw bytes with metadata in query fields. URL submissions use JSON. `Data` is
streamed without buffering:

```go
file, err := os.Open("photo.jpg")
if err != nil { return err }
defer file.Close()
info, err := file.Stat()
if err != nil { return err }
asset, err := client.Assets.Create(ctx, calmlens.SubmitAssetOptions{
    Name: "photo.jpg",
    Content: &calmlens.Content{Type: "image/jpeg", Data: file, SizeInBytes: calmlens.Ptr(info.Size())},
})
```

Use `Part: &calmlens.Content{Type: "image/png", Bytes: firstChunk}` to start a
multipart upload, optionally with `TotalSizeInBytes` so CalmLens rejects an upload that
could never complete before storing it. Continue with:

```go
asset, err := client.Assets.UploadPart(ctx, calmlens.UploadAssetPartOptions{
    AssetID: upload.ID,
    Part: calmlens.Content{Bytes: finalChunk, PartNumber: 2, IsFinal: true},
})
```

Each non-final part must be at least 5MiB. Multipart images must total 10–20MiB;
direct images must be below 10MiB (enforced by the API). Split original bytes before
base64 encoding chunks; `io.NewSectionReader` gives each part of a file without reading
it into memory. Multipart readers require exact `SizeInBytes`. Send parts sequentially.
The queue mode chosen when the upload started (`Create` queues, `Classify` waits) is saved
by CalmLens, so any client or process can send the remaining parts with only the asset ID;
set `UploadAssetPartOptions.Queue` to override it for the final part.

## Upload presets

Set `UploadPresetID` on `SubmitAssetOptions` (or `ClassifyTextOptions`) to apply an upload preset's folder, visibility, file types and size limit. To let a browser upload through a preset that requires tokens, sign a single-use token on your server. Signing happens locally with your API key and makes no request.

```go
signed, err := client.UploadTokens.Sign(ctx, calmlens.SignUploadTokenOptions{
	UploadPresetID:   "your-upload-preset-id",
	ExternalID:       calmlens.Ptr("post-42"), // optional: the uploaded asset gets this ID
	ExpiresInSeconds: 600,                      // optional: 1 to 3600, 600 by default
})
// signed.Token, signed.ExpiresAt (milliseconds since the Unix epoch)
```

See [Upload presets](https://calmlens.com/docs/guides/upload-presets). The `calmlenstest` mock client signs tokens with its own key.

## Retries and idempotency

The SDK retries, with jittered exponential backoff (0.5 s, 1 s, … up to 8 s), up to
`MaxRetries` times when it is safe to:

- `GET` and `HEAD` requests, and
- `Create`, `Classify`, `Text.Classify` and `UploadPart`, which always send an
  `Idempotency-Key` header. The SDK generates one per call and reuses it for its own
  retries; CalmLens returns the saved response instead of running the request twice.

They are retried after a connection failure or timeout, `429`, `502`, `503`, `504`, and
`idempotency/request-in-progress`. A `Retry-After` header is honoured; one longer than a
minute is returned to you as the error instead. Other writes (`Update`, `Move`, `Delete`,
`Retry`, folder changes, `CreateSignedURL`) are never retried automatically. An upload
from a `Data` reader is only retried when the reader implements `io.Seeker` (such as
`*os.File`); other streams are sent once.

To retry across processes or restarts, pass your own key, for example derived from your
record ID, and send the same key every time:

```go
asset, err := client.Assets.Create(ctx, calmlens.SubmitAssetOptions{
    Name: "photo.jpg", IdempotencyKey: "upload-" + photoID, Content: content,
})
```

## Events feed

`Events.List` polls the project event feed. It returns `*calmlens.EventsPage`, the JSON
`{events, cursor, hasMore}` as `Events []Event`, `Cursor string`, and `HasMore bool`.
Calling it without `After` returns **no events** and a cursor for "now", so you only
see events created after you connect. `Events.ListAll` follows the cursor until no more
events are available; save `Cursor()` and continue from it later:

```go
start, err := client.Events.List(ctx, calmlens.ListEventsOptions{})
if err != nil { return err }
cursor := start.Cursor // save this; start.Events is always empty
// ...later:
it := client.Events.ListAll(calmlens.ListEventsOptions{After: cursor, Limit: 100})
for it.Next(ctx) {
    event := it.Event()
    fmt.Println(event.Type, event.ID, event.Facts)
}
cursor = it.Cursor() // store it even after an error
if err := it.Err(); err != nil { return err }
```

Each `Event` carries `Facts` (`calmlens.EventFacts`, a list of `{Key, Value, URL}`); there
is no metadata object. `Type` is one of the `Event...` constants and `Asset` is a typed
`*EventAsset` snapshot of the asset's `Classification.Status`, `Classification.Moderation.Status`
and `Content.Status` when the event was created. A fact's `Value` depends on its key, so read it with `Text`,
`Int64`, `Bool` or `Strings`, or decode all of an event's facts into the typed struct for
its type:

```go
switch event.Type {
case calmlens.EventAssetBlocked, calmlens.EventAssetPurged:
    var facts calmlens.AssetDecisionFacts
    if err := event.Facts.Decode(&facts); err != nil { return err }
    fmt.Println(facts.DecidedBy, facts.FlaggedCategories)
}
if event.Facts.IsTest() { /* a test send from the portal */ }
```

## Errors

Every failure, including invalid arguments and encoding errors, is a `*calmlens.Error`:

```go
var apiErr *calmlens.Error
if errors.As(err, &apiErr) {
    fmt.Println(apiErr.Code, apiErr.Status, apiErr.RequestID, apiErr.RetryAfter, apiErr.Details)
}
if calmlens.IsNotFound(err) { /* 404 */ }
if calmlens.ErrorCode(err) == calmlens.CodeDuplicateExternalID { /* ... */ }
```

| Field | Meaning |
| --- | --- |
| `Code` | An API code (constants such as `calmlens.CodeAssetNotFound`, generated from the API's error list) or an `sdk/` code below. |
| `Status` | HTTP status, or 0 when no response arrived. |
| `RequestID` | The `X-Request-Id` response header; include it when contacting support. |
| `Header`, `RetryAfter` | Response headers and the parsed `Retry-After` delay. |
| `Details` | Structured API details, with `network: true` and any `traceId`. |
| `Cause` | The underlying error; `errors.Is` and `errors.As` reach it through `Unwrap`. |

`Error()` includes the code, status, message and request ID. `IsRetryable(err)` (or
`apiErr.Retryable()`) reports whether repeating the request may succeed.

| SDK code | When |
| --- | --- |
| `sdk/transport-error` | Connection refused or reset, TLS, malformed HTTP, decompression or a truncated body. |
| `sdk/timeout`, `sdk/cancelled` | A timeout or context deadline expired, or the context was cancelled. |
| `sdk/invalid-response` | A success body was empty, not JSON or unexpected. |
| `sdk/response-too-large` | A response body was larger than `MaxResponseBytes`. |
| `sdk/http-error` | A non-2xx response without a CalmLens error body. |
| `sdk/invalid-argument` | An argument (such as an empty, `.` or `..` ID) was rejected, or could not be encoded, before any request. |
| `sdk/invalid-config` | `NewServerClient` rejected an option. |
| `sdk/invalid-webhook-signature`, `sdk/invalid-webhook-payload` | Webhook verification or decoding failed. |

Upload payload checks that mirror the API (missing name or content, part sizes, MIME
type) use the API's own codes, such as `upload/invalid-payload`.

## Webhooks

Deliveries are POSTs with three headers, exported as constants:

| Header | Constant | Value |
| --- | --- | --- |
| `x-calmlens-signature` | `calmlens.WebhookSignatureHeader` | `v1=<hex>` (comma-separated list allowed) |
| `x-calmlens-timestamp` | `calmlens.WebhookTimestampHeader` | unix seconds |
| `x-calmlens-delivery` | `calmlens.WebhookDeliveryHeader` | unique delivery ID, for deduplication |

Deliveries are JSON `{id, type, createdAt, projectId, data}` (`WebhookEventPayload`),
signed as `v1=<hex HMAC-SHA256 of "<timestamp>.<raw body>">`. Verification needs the
**exact raw bytes** of the body: the functions take `[]byte`, never a decoded value, and
re-encoding JSON changes the bytes. Any matching `v1=` entry is accepted, and timestamps
more than `DefaultWebhookTolerance` (5 minutes) from now are rejected.

With `net/http`, `VerifyWebhookRequest` reads the body (up to 1 MiB), verifies it and
returns the event. It leaves the raw bytes in `r.Body` for later handlers:

```go
func handleWebhook(w http.ResponseWriter, r *http.Request) {
    event, err := calmlens.VerifyWebhookRequest(r, os.Getenv("CALMLENS_WEBHOOK_SECRET"))
    if err != nil {
        http.Error(w, "Invalid webhook", http.StatusUnauthorized)
        return
    }
    // Deduplicate by event.ID, queue the work, then respond quickly.
    w.WriteHeader(http.StatusNoContent)
}
```

Routers built on `net/http`, such as chi, pass the same `*http.Request`, so the handler
above works unchanged; register it before any middleware that reads or decodes the body.
With gin, use `c.Request` before binding:

```go
router.POST("/webhooks", func(c *gin.Context) {
    event, err := calmlens.VerifyWebhookRequest(c.Request, secret)
    if err != nil {
        c.AbortWithStatus(http.StatusUnauthorized)
        return
    }
    c.Status(http.StatusNoContent)
    _ = event
})
```

When you already have the raw bytes (from a queue, or a framework that buffers the
body), use `ParseWebhookEvent(rawBody, signature, timestamp, secret)` to verify and
decode, or `VerifyWebhookSignature` for a plain boolean. Options:
`calmlens.WithTolerance(d)`, `calmlens.WithNow(t)` and `calmlens.WithMaxBodyBytes(n)`.
`SignWebhookPayload(rawBody, timestamp, secret)` produces the signature header value
(arguments in the same order as `VerifyWebhookSignature`), for example to sign test
deliveries.

## CDN

`CDN.Serve` returns the response, including non-2xx statuses, with the body streamed:
`defer response.Body.Close()` is required. It is not bounded by `Options.Timeout`, so
large downloads finish; pass a context deadline to bound them. `Resource` is `calmlens.ResourceRendered`
(the default), `calmlens.ResourceOriginal` or `calmlens.ResourcePlaceholder`; only the rendered resource
takes a lens or transform. Supply a lens, a direct transform, or both. When combined, the lens runs first. Private content should be delivered through a signed URL.

A transform is either a selector string or structured steps (`CDN.GetAssetURL`,
`CDN.Serve` and `Assets.CreateSignedURL` accept both, but not together):

```go
// Selector string.
url, err := client.CDN.GetAssetURL(calmlens.CDNAssetURLOptions{
    AssetIdentifier: "asset-id",
    Transform:       "format=png,width=1024",
})

// Structured steps, serialized to the same selector.
url, err = client.CDN.GetAssetURL(calmlens.CDNAssetURLOptions{
    AssetIdentifier: "asset-id",
    TransformSteps: []calmlens.LensTransform{
        calmlens.ImageTransform(calmlens.ImageTransformOptions{Width: calmlens.Ptr(1024), Format: calmlens.ImageFormatPNG}),
    },
})
```

`ImageTransformOptions` types every image option; `Gravity` and `Trim` accept both the
named form (`&calmlens.ImageGravity{Side: "face"}`, `&calmlens.ImageTrim{Border: &calmlens.ImageTrimBorder{}}`)
and the detailed form, and `Quality` takes a number (`&calmlens.ImageQuality{Value: 80}`) or a
level (`&calmlens.ImageQuality{Level: calmlens.ImageQualityHigh}`). A selector has one path
segment per step, such as `fit=cover,width=640/format=webp`: options are sorted `key=value`
pairs, nested options are dotted (`border.color=ff0000`) and hex colours drop the `#`. A lens
and a transform are joined with `/`, as in `/rendered/@thumbnail/width=320`.

A public asset whose moderation status is `age-restricted` is served from its public URL only
when the URL carries `?allowAgeRestricted=true`; otherwise it needs a signed URL or an API key. Set
`AllowAgeRestricted: true` on `CDNAssetURLOptions` (also used by `CDN.Serve`) to append it. Set it
only where your app has already decided the viewer may see age-restricted content.

## Local webhook forwarding

Use the standalone [CalmLens CLI](https://calmlens.com/docs/guides/local-development) for local development with any SDK. Install it separately through Homebrew, a platform download or npm.

## Testing

```go
import "github.com/CalmLens/sdks/go/calmlenstest"

mock, err := calmlenstest.NewServerClient(calmlenstest.Options{
    ProjectID: "project",
    Now: func() int64 { return 123 },
    CreateID: func() string { return "asset-1" },
})
asset, err := mock.Assets.Classify(ctx, calmlens.SubmitAssetOptions{Name: "text", Content: &calmlens.Content{Type: "text/plain", PlainText: calmlens.Ptr("Hello")}})
```

The mock embeds the real client and runs its validation, encoding and error handling
over an in-memory transport. Its `Options` accept the same `APIKey`, `ProjectID`,
`BaseURL`, `CDNBaseURL`, `Timeout` and `MaxRetries` as `calmlens.Options` (validated the
same way), plus database/content storage, deterministic IDs/timestamps, upload outcomes
(`QueuedOutcome`, default `OutcomePending`, for `Create`; `AnalyzedOutcome`, default
`OutcomeAllowed`, for `Classify`; each `OutcomePending`, `OutcomeAllowed`,
`OutcomeAgeRestricted`, `OutcomeBlocked`, `OutcomePurged` or `OutcomeFailed`) and mock CDN URLs. It behaves like the API where it matters for tests:

- Errors use the API's codes, HTTP statuses (404 for `asset/not-found`, 409 for
  `folder/not-empty`, ...) and error body, with an `X-Request-Id` on every response.
- `Assets.List` and `ListChildren` apply RSQL filters (`==`, `!=`, `=in=`, `=out=`,
  comparisons, `;`, `,`, parentheses), ordering, `FolderID` and paging.
- `Assets.Search` matches keywords in name, ID, external ID, description and tags.
- A decided upload finishes processing (`completed`); like the API, its content is then removed
  (`Content.Status` `removed`, `RemovalReason` `retention`) and no longer served unless the
  upload set `KeepContentAfterProcessing`. `OutcomePurged` always removes the content, with
  `RemovalReason` `policy`. `Retry` needs failed processing and content that
  was not removed.
- Multipart uploads keep the queue mode chosen at the start, check part numbers
  (`details.expectedPartNumber`) and `TotalSizeInBytes`.
- `Idempotency-Key` requests are replayed, and a key reused for another request returns
  `idempotency/key-reused`.
- `EnqueueEvent` adds events to the feed, which `Events.List` and `ListAll` return after
  cursors taken earlier.
- `CDN.Serve` answers with content type and length, and `Cache-Control` as the CDN sets it
  (`public` only when anyone may see the asset, otherwise `private`; `max-age=31536000, immutable`
  for images, `max-age=3600` otherwise), and supports single byte ranges. Like the
  CDN, blocked, purged and failed assets and removed content return 403 `asset/not-available`
  whatever the key. A private asset, or a public age-restricted one requested without
  `AllowAgeRestricted: true`, returns 403 `asset/api-key-missing-permission` unless the key has
  the `assets:download` permission; the default key has no grants.
- `Decide(assetID, OutcomeBlocked)` (or `OutcomeAllowed`, `OutcomeAgeRestricted`,
  `OutcomePurged`) applies a reviewer's decision and adds the matching `asset.<decision>` event
  with a `decided-by: reviewer` fact.
- Waits take no real time: retry backoff and `Assets.WaitForDecision` only advance the mock
  client's clock, so `WaitForDecision` returns `sdk/timeout` straight away for an asset whose
  moderation stays pending.

It does not classify content, transform media or fetch URLs, and its signed URLs are not
production URLs. Inspect or seed `DatabaseStorage` and `ImageStorage` between calls, or
use `WithStorage` to change them while other goroutines send requests. `CreateMockAPIKey`
accepts grants for private and age-restricted CDN permission tests. Retries are off by default in the mock
(`MaxRetries` 0) so that `FailNext` fails exactly one call.

Every request is captured, decoded, for assertions; `FailNext` queues transport
failures so you can test error handling without a network:

```go
mock.FailNext(errors.New("connection reset"), context.DeadlineExceeded)
_, err = mock.Folders.List(ctx, ListFoldersOptions{}) // *calmlens.Error, Code "sdk/transport-error"
_, err = mock.Folders.List(ctx, ListFoldersOptions{}) // *calmlens.Error, Code "sdk/timeout"

for _, req := range mock.Requests() {
    // Method "POST", Path "/projects/project/assets" (relative to BaseURL,
    // unescaped), Query url.Values, Header, Body calmlens.JSON (decoded JSON bodies),
    // RawBody []byte (exact bytes, including uploads), CDN bool.
    fmt.Println(req.Method, req.Path, req.Query.Get("queue"), req.Body)
}
mock.ClearRequests()
```

Failed requests are captured too, then fail before reaching the in-memory backend.

```sh
go test -race ./...
go vet ./...
go test ./...       # generated API error codes are updated with the API contract
```

See [cross-language parity](https://calmlens.com/docs/sdk).

This SDK is maintained in the public [CalmLens SDK repository](https://github.com/CalmLens/sdks).
Go discovers versions from `go/v<version>` tags there. The private release workflow checks
`Version` in `version.go`, tests the SDK and example, syncs the approved export, creates the
public tag and requests the version from the Go module proxy. It uses the SDK sync GitHub
App; no Go registry token is needed.


`Text.Classify` is a convenience wrapper around asset moderation: it supplies `text/plain` content and defaults the asset name to `text`, returning the same `*calmlens.Asset` described under [Classification results](#moderation-results). `assets.create` queues processing; `assets.classify` waits for classification. The old asset analyze method is removed.

Image moderation considers readable text directly. Optional OCR (`processingOptions.features.ocr.enabled: true` on the wire) adds a text moderation pass and stores retained text in the image’s `content.extractedText`. No separate text child is created. Read the image’s combined `classification.moderation`; removing its content also removes the extracted text.

Folder listings return a page with `folders`, visible `ancestors`, and `hasMore`. Set `parentId` to open a branch (omit it for project root), and advance `pageIndex` to load another page. `pageSize` is at most 100. `search` with `searchAll` finds names in unopened branches; `ids` with `resolveOnly` resolves selected folder paths. Use the SDK’s language-specific option names.
