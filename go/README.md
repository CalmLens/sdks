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

| Option                  | Default                                                      | Meaning                                                                                                                                                                              |
| ----------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `BaseURL`, `CDNBaseURL` | `https://api.calmlens.com/v1`, `https://cdn.calmlens.com/v1` | API and CDN endpoints.                                                                                                                                                               |
| `Timeout`               | `DefaultTimeout` (120 s)                                     | Bounds each attempt of an API call, including the response body, and text uploads. For `CDN.Serve` it ends when the response headers arrive.                                         |
| `UploadTimeout`         | none                                                         | Bounds each attempt of a binary upload (file content and multipart parts); zero leaves large files uncut.                                                                            |
| `ConnectTimeout`        | `DefaultConnectTimeout` (10 s)                               | Dial and TLS handshake (default transport only).                                                                                                                                     |
| `ResponseHeaderTimeout` | `DefaultResponseHeaderTimeout` (120 s)                       | Wait for response headers after the request is sent (default transport only).                                                                                                        |
| `MaxRetries`            | `DefaultMaxRetries` (2)                                      | Retries for retryable failures; `calmlens.Ptr(0)` disables them.                                                                                                                     |
| `MaxResponseBytes`      | `DefaultMaxResponseBytes` (32 MiB)                           | Largest API response body read; larger ones fail with `sdk/response-too-large`.                                                                                                      |
| `HTTPClient`            | a client with the timeouts above                             | Sends every request. A copy is used with redirects disabled, so credentials stay on the configured endpoint: a `3xx` fails with `sdk/http-error` and its status, and is not retried. |

`client.WithRequestOptions(calmlens.RequestOptions{Timeout, UploadTimeout, MaxRetries})` returns
a client with other deadlines or retries for the calls made through it. It shares the
credentials, HTTP client and lens cache; the original client is unchanged.

### Timeouts and large transfers

The default transport bounds connecting and waiting for headers, never the transfer
itself, and binary uploads have no deadline unless you set `UploadTimeout`, so uploading a
large file or streaming a CDN download can take as long as it needs. Bound any call,
including those, with a context deadline:

```go
ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
defer cancel()
asset, err := client.Assets.Create(ctx, options)
```

If you supply `HTTPClient`, keep its `Timeout` at zero: `http.Client.Timeout` covers the
whole request, including upload and download bodies.

Every request sends `User-Agent: calmlens-go/<Version> (go/<Go version>)`, and API requests
send `Accept: application/json`. `calmlens.Version` is the SDK version.

## API mapping

| JavaScript                                | Go                                                                                                                                                                                                  |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `assets.create/classify`                  | `Assets.Create/Classify(ctx, SubmitAssetOptions)`                                                                                                                                                   |
| `assets.retrieve/retry`                   | `Assets.Retrieve/Retry(ctx, AssetIDOptions)`                                                                                                                                                        |
| `assets.decide`                           | `Assets.Decide(ctx, DecideAssetOptions)`: `Decision` and `Note`, plus `ConfirmPurge` to purge                                                                                                       |
| `assets.explain`                          | `Assets.Explain(ctx, ExplainAssetOptions)`                                                                                                                                                          |
| `assets.waitForDecision`                  | `Assets.WaitForDecision(ctx, WaitForDecisionOptions)`                                                                                                                                               |
| `assets.update`                           | `Assets.Update(ctx, UpdateAssetOptions)`                                                                                                                                                            |
| `assets.list`                             | `Assets.List(ctx, ListAssetsOptions)`; every page: `Assets.ListAll(ListAssetsOptions)`                                                                                                              |
| `assets.listChildren`                     | `Assets.ListChildren(ctx, ListAssetChildrenOptions)`; every page: `Assets.ListChildrenAll(…)`                                                                                                       |
| `assets.search`                           | `Assets.Search(ctx, SearchAssetsOptions)`                                                                                                                                                           |
| `assets.uploadPart`                       | `Assets.UploadPart(ctx, UploadAssetPartOptions)`                                                                                                                                                    |
| `assets.deleteContent`                    | `Assets.DeleteContent(ctx, AssetIDOptions)`                                                                                                                                                         |
| `assets.delete`                           | `Assets.Delete(ctx, AssetIDOptions)` (returns only `error`)                                                                                                                                         |
| `assets.move`                             | `Assets.Move(ctx, MoveAssetOptions)`                                                                                                                                                                |
| `assets.batch`                            | `Assets.Batch(ctx, BatchAssetsOptions)`: 1 to 500 `AssetIDs` with `AssetBatchOperationDelete` or `AssetBatchOperationRemoveContent`; returns `*BatchAssetsResponse` once queued, and is not retried |
| `assets.createSignedUrl`                  | `Assets.CreateSignedURL(ctx, SignedURLOptions)`                                                                                                                                                     |
| `folders.list`                            | `Folders.List(ctx, ListFoldersOptions{})`                                                                                                                                                           |
| `folders.retrieve/delete`                 | `Folders.Retrieve/Delete(ctx, FolderIDOptions)`                                                                                                                                                     |
| `folders.create/update/move`              | `Folders.Create/Update/Move(ctx, …FolderOptions)`                                                                                                                                                   |
| `hashLists.list`                          | `HashLists.List(ctx, ListHashListsOptions{})`                                                                                                                                                       |
| `hashLists.retrieve/delete`               | `HashLists.Retrieve/Delete(ctx, HashListIDOptions)` (`Delete` returns only `error`)                                                                                                                 |
| `hashLists.create/update`                 | `HashLists.Create/Update(ctx, CreateHashListOptions/UpdateHashListOptions)`                                                                                                                         |
| `hashLists.listEntries`                   | `HashLists.ListEntries(ctx, ListHashListEntriesOptions)`                                                                                                                                            |
| `hashLists.addEntry`                      | `HashLists.AddEntry(ctx, AddHashListEntryOptions)`                                                                                                                                                  |
| `hashLists.removeEntry`                   | `HashLists.RemoveEntry(ctx, HashListEntryIDOptions)` (returns only `error`)                                                                                                                         |
| `events.list`                             | `Events.List(ctx, ListEventsOptions)`; follow the cursor: `Events.ListAll(ListEventsOptions)`                                                                                                       |
| `ensureLens/ensureLenses`                 | `EnsureLens/EnsureLenses(ctx, …Options)`                                                                                                                                                            |
| `cdn.getAssetUrl/serve`                   | `CDN.GetAssetURL(CDNAssetURLOptions)` / `CDN.Serve(ctx, CDNServeOptions)`                                                                                                                           |
| `verifyWebhookSignature`                  | `VerifyWebhookSignature(rawBody, signature, timestamp, secret, ...WebhookOption)`                                                                                                                   |
| `constructEvent`-style helper             | `ParseWebhookEvent(rawBody, signature, timestamp, secret, ...WebhookOption)`, `VerifyWebhookRequest(r, secret, ...WebhookOption)`                                                                   |
| webhook signing (tests, local forwarding) | `SignWebhookPayload(rawBody, timestamp, secret)`                                                                                                                                                    |

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
`DefaultDecisionTimeout`, 60s; `calmlens.Ptr(time.Duration(0))` checks once); cancel `ctx` to
stop early (`sdk/cancelled`). Webhooks report decisions without polling:

```go
queued, err := client.Assets.Create(ctx, calmlens.SubmitAssetOptions{Name: "photo.jpg", Content: &calmlens.Content{Type: "image/jpeg", Data: file}})
decided, err := client.Assets.WaitForDecision(ctx, calmlens.WaitForDecisionOptions{AssetID: queued.ID, Timeout: calmlens.Ptr(30 * time.Second)})
if err == nil {
    switch decided.Classification.Moderation.Status {
    case calmlens.ModerationStatusAllowed, calmlens.ModerationStatusLimited:
        // delivered normally; a limited photo is only marked so you can reduce its reach
    default:
        blockPhoto(decided.ID)
    }
}
```

`Retry` processes an asset whose processing failed again (processing returns to `processing`
and moderation to `pending`). `DeleteContent` removes stored content but keeps the record and
report (the result's `Content.Status` is `removed` with `RemovalReason` `requested`, and the CDN
stops serving it); `Delete` removes the record and its content. Cursor lists return 50 items
unless `PageSize` says otherwise; signed URLs default to the rendered resource and 900 seconds. Lens ensures cache full definitions,
deduplicate batches/concurrent calls, and invalidate prior definitions by identifier.

### Hash lists

A hash list holds perceptual (PDQ) hashes of images the project never wants again. Image
uploads are compared with every list in the project: a `HashListActionFlag` list records
matches in `Classification.Moderation.HashMatches`, and a `HashListActionBlock` list also
blocks close matches (the policy decision's `Source` is then `DecisionSourceHashList`). Add a
64-character hex `Hash` (with an optional `Quality`), or the `AssetID` of a processed image
asset to use its `Content.Image.PerceptualHash`; adding a hash already in the list returns its
entry. Deleting a list deletes its entries.

```go
list, err := client.HashLists.Create(ctx, calmlens.CreateHashListOptions{Name: "Removed images", Action: calmlens.HashListActionBlock})
entry, err := client.HashLists.AddEntry(ctx, calmlens.AddHashListEntryOptions{HashListID: list.ID, AssetID: assetID, Label: calmlens.Ptr("Report 1042")})
page, err := client.HashLists.ListEntries(ctx, calmlens.ListHashListEntriesOptions{HashListID: list.ID, PageSize: 50})
list, err = client.HashLists.Update(ctx, calmlens.UpdateHashListOptions{HashListID: list.ID, Description: calmlens.Null[string](), Action: calmlens.Ptr(calmlens.HashListActionFlag)})
```

`HashLists.List` and `ListEntries` return pages newest first; pass `page.NextCursor` as
`Cursor` while `page.HasMore` is true. `UpdateHashListOptions` sends only the fields you set, and its
`Description` is a `calmlens.Patch`, so `calmlens.Null[string]()` clears it.

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

Iteration stops when a page has no next cursor or says no more follow. A page that says more
follow but hands back a cursor the iteration already used fails with `sdk/invalid-response`
(the cursor in `Details["cursor"]`) instead of repeating pages; that page is not yielded.

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
- `Classification` (`AssetClassification`): `Status` is `pending`, `processing`, `completed` or `failed`, with `FailureReason` (why processing failed, `nil` unless `failed`), `UpdatedAt` and `CompletedAt`. Optional `PersonDetection`, `FaceDetection`, `LinkDetection`, `AIGeneratedDetection`, `TextRegions` and `Labels` sit alongside `Moderation`, which holds `Status`, `Categories`, `Score`, `Timeline`, `Policy`, `HashMatches` and reviewer details. Reviewer actions do not change classification completion time.
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
case calmlens.ModerationStatusLimited:
    publishWithReducedReach(comment) // delivered normally; keep it out of recommendations and trending
case calmlens.ModerationStatusAgeRestricted:
    publishBehindAgeGate(comment) // deliver with age confirmation only after your app checks the viewer
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
(`ClassificationStatus...`, `ModerationStatus...`, `ContentStatus...`, `ContentRemovalReason...`, `AssetFailureReason...`,
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

To moderate a reply in its conversation, pass `AuthorID` (your identifier for who wrote it)
and `Context` with the earlier posts, oldest first. CalmLens moderates only the content and
uses the earlier posts to read who it addresses and what it refers to. The SDK sends only the
posts CalmLens uses: the 5 most recent that fit in 2,000 characters
(`SelectModerationContextItems`). The asset's `AuthorID` and `Context` return what was kept,
and `Context` is `nil` once the content is removed. The same fields work on `SubmitAssetOptions`.

```go
asset, err := client.Text.Classify(ctx, calmlens.ClassifyTextOptions{
    Text:     reply,
    AuthorID: calmlens.Ptr("user-9"),
    Context: &calmlens.ModerationContext{Items: []calmlens.ModerationContextItem{
        {Text: "Anyone tried the new trail?", AuthorID: calmlens.Ptr("user-3")},
        {Text: "Yes, it was muddy.", AuthorID: calmlens.Ptr("user-7")},
    }},
})
```

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
	UploadPresetID:   "preset_4Lk8Qw2Xm9Rt5Vb3Nc7P",
	ExternalID:       calmlens.Ptr("post-42"), // optional: the uploaded asset gets this ID
	ExpiresInSeconds: 600,                      // optional: 1 to 3600, 600 by default
})
// signed.Token, signed.ExpiresAt (milliseconds since the Unix epoch)
```

See [Upload presets](https://calmlens.com/docs/guides/upload-presets). The `calmlenstest` mock client signs tokens with its own key.

## Retries and idempotency

The SDK retries up to `MaxRetries` times when it is safe to. Retry n (from 0) waits between
half and all of min(8 s, 0.5 s × 2ⁿ), unless a `Retry-After` header (seconds or an HTTP date;
`0` retries at once) says otherwise:

- `GET` and `HEAD` requests, and
- `Create`, `Classify`, `Text.Classify` and `UploadPart`, which always send an
  `Idempotency-Key` header. The SDK generates one per call and reuses it for its own
  retries; CalmLens returns the saved response instead of running the request twice.

They are retried after a connection failure or timeout, `429`, `502`, `503`, `504`, and
`idempotency/request-in-progress`. A `Retry-After` longer than a minute is returned to you as
the error instead. Other writes (`Update`, `Move`, `Delete`,
`Retry`, folder changes, `CreateSignedURL`) are never retried automatically. An upload
from a `Data` reader is only retried when the reader implements `io.Seeker` (such as
`*os.File`); other streams are sent once. `CDN.Serve` retries `GET` and `HEAD` requests the
same way and, once retries run out, returns the last response.

To retry across processes or restarts, pass your own key, for example derived from your
record ID, and send the same key every time:

```go
asset, err := client.Assets.Create(ctx, calmlens.SubmitAssetOptions{
    Name: "photo.jpg", IdempotencyKey: "upload-" + photoID, Content: content,
})
```

## Events feed

`Events.List` polls the project event feed. It returns `*calmlens.EventsPage`, the JSON
`{items, nextCursor, hasMore}` as `Items []Event`, `NextCursor string`, and `HasMore bool`.
`NextCursor` is never empty: it is where to continue polling from. Calling it without
`Cursor` returns **no events** and a cursor for "now", so you only see events created after
you connect. `Events.ListAll` follows the cursor until no more
events are available (`NextPage` and `Page` walk it a page at a time, empty pages included);
save `Cursor()` and continue from it later:

```go
start, err := client.Events.List(ctx, calmlens.ListEventsOptions{})
if err != nil { return err }
cursor := start.NextCursor // save this; start.Items is always empty
// ...later:
it := client.Events.ListAll(calmlens.ListEventsOptions{Cursor: cursor, PageSize: 100})
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

| Field                  | Meaning                                                                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `Code`                 | An API code (constants such as `calmlens.CodeAssetNotFound`, generated from the API's error list) or an `sdk/` code below.      |
| `Status`               | HTTP status, or 0 when no response arrived.                                                                                     |
| `RequestID`            | The `X-Request-Id` response header, or the error body's `requestId` without it; include it when contacting support.            |
| `Header`, `RetryAfter` | Response headers and the parsed `Retry-After` delay (`*time.Duration`, nil without the header).                                 |
| `Details`              | Structured API details, such as validation issues, or SDK details such as `cursor`; nil for transport failures.                 |
| `Cause`                | The underlying error; `errors.Is` and `errors.As` reach it through `Unwrap`.                                                    |

`Error()` includes the code, status, message and request ID. `IsRetryable(err)` (or
`apiErr.Retryable()`) reports whether repeating the request may succeed.

| SDK code                                                       | When                                                                                                      |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `sdk/transport-error`                                          | Connection refused or reset, TLS, malformed HTTP, decompression or a truncated body.                      |
| `sdk/timeout`, `sdk/cancelled`                                 | A timeout or context deadline expired, or the context was cancelled.                                      |
| `sdk/invalid-response`                                         | A success body was empty, not JSON or unexpected.                                                         |
| `sdk/response-too-large`                                       | A response body was larger than `MaxResponseBytes`.                                                       |
| `sdk/http-error`                                               | A non-2xx response without a CalmLens error body, or a redirect.                                          |
| `sdk/invalid-argument`                                         | An argument (such as an empty, `.` or `..` ID) was rejected, or could not be encoded, before any request. |
| `sdk/invalid-config`                                           | `NewServerClient` rejected an option.                                                                     |
| `sdk/invalid-webhook-signature`, `sdk/invalid-webhook-payload` | Webhook verification or decoding failed.                                                                  |

Upload payload checks that mirror the API (missing name or content, part sizes, MIME
type) use the API's own codes, such as `upload/invalid-payload`.

## Webhooks

Deliveries are POSTs with three headers, exported as constants:

| Header                 | Constant                          | Value                                     |
| ---------------------- | --------------------------------- | ----------------------------------------- |
| `x-calmlens-signature` | `calmlens.WebhookSignatureHeader` | `v1=<hex>` (comma-separated list allowed) |
| `x-calmlens-timestamp` | `calmlens.WebhookTimestampHeader` | unix seconds                              |
| `x-calmlens-delivery`  | `calmlens.WebhookDeliveryHeader`  | unique delivery ID, for deduplication     |

Deliveries are JSON `{id, projectId, type, severity, title, description, assetId, asset, facts,
createdAt}`, the same shape `Events.List` returns, decoded into an `Event`, and are signed as `v1=<hex HMAC-SHA256 of "<timestamp>.<raw body>">`. Verification needs the
**exact raw bytes** of the body: the functions take `[]byte`, never a decoded value, and
re-encoding JSON changes the bytes. Any matching `v1=` entry is accepted, and timestamps
more than `DefaultWebhookTolerance` (5 minutes) from now are rejected. Header names match in
any case, and repeated signature headers are joined into one list. A verified body must be an
event (string `id`, `type` and `projectId`, numeric `createdAt`, and the API's types for its
other known fields), or parsing fails with `sdk/invalid-webhook-payload`. The parsed `*Event`
keeps the whole body, including fields added after this SDK, in `Raw`, and
`event.Facts.IsTest()` reports a test send from the portal or CLI.

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
decode, `VerifyWebhookHeaders(rawBody, header, secret)` to verify against an `http.Header`, or
`VerifyWebhookSignature` for a plain boolean. Options: `calmlens.WithTolerance(d)` (zero
accepts only the signing second), `calmlens.WithNow(t)` and `calmlens.WithMaxBodyBytes(n)`.
`SignWebhookPayload(rawBody, timestamp, secret)` produces the signature header value
(arguments in the same order as `VerifyWebhookSignature`), for example to sign test
deliveries.

## CDN

`CDN.Serve` returns the response, including non-2xx statuses, with the body streamed:
`defer response.Body.Close()` is required. `Options.Timeout` ends when the response headers
arrive, so large downloads finish; pass a context deadline to bound them. Retryable responses
are retried as described under Retries, and a redirect fails with `sdk/http-error`. `Resource` is `calmlens.ResourceRendered`
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
and the detailed form, `Redact` (`&calmlens.ImageRedaction{Text: calmlens.Ptr(true)}`) blurs the
text or personal-information regions found when the image was processed, and `Quality` takes a number (`&calmlens.ImageQuality{Value: 80}`) or a
level (`&calmlens.ImageQuality{Level: calmlens.ImageQualityHigh}`). A selector has one path
segment per step, such as `fit=cover,width=640/format=webp`: options are sorted `key=value`
pairs, nested options are dotted (`border.color=ff0000`) and hex colours drop the `#`. A lens
and a transform are joined with `/`, as in `/rendered/@thumbnail/width=320`.

A public asset whose moderation status is `age-restricted` is served from its public URL only
when the URL carries a JSON `viewerClaims` query parameter containing `{ "ageConfirmed": true }`; otherwise delivery is refused, even with a signed URL or API key. Set
`ViewerClaims` with `AgeConfirmed` pointing to `true` on `CDNAssetURLOptions` (also used by `CDN.Serve`) to append it. Set it
only where your app has already decided the viewer may see age-restricted content.

## Local webhook forwarding

Use the standalone [CalmLens CLI](https://calmlens.com/docs/guides/local-development) for local development with any SDK. Install it separately through Homebrew, a platform download or npm.

## Testing

```go
import "github.com/CalmLens/sdks/go/calmlenstest"

mock, err := calmlenstest.NewServerClient(calmlenstest.Options{
    ProjectID: "proj_8fK2mQx7Lp4NvB3tRz9Y",
    Now: func() int64 { return 123 },
    CreateID: func(prefix string) string { return prefix + "_00000000000000000001" },
})
asset, err := mock.Assets.Classify(ctx, calmlens.SubmitAssetOptions{Name: "text", Content: &calmlens.Content{Type: "text/plain", PlainText: calmlens.Ptr("Hello")}})
```

The mock embeds the real client and runs its validation, encoding and error handling
over an in-memory transport. Its `Options` accept the same `APIKey`, `ProjectID`,
`BaseURL`, `CDNBaseURL`, `Timeout` and `MaxRetries` as `calmlens.Options` (validated the
same way), plus database/content storage, deterministic IDs/timestamps (`CreateID` receives the
object's ID prefix, such as `asset` or `fldr`; by default the mock mints IDs like the API's,
such as `asset_5Gm2Rk8XqT3wLp9VbN4c`), upload outcomes
(`QueuedOutcome`, default `OutcomePending`, for `Create`; `AnalyzedOutcome`, default
`OutcomeAllowed`, for `Classify`; each `OutcomePending`, `OutcomeAllowed`, `OutcomeLimited`,
`OutcomeAgeRestricted`, `OutcomeBlocked`, `OutcomePurged` or `OutcomeFailed`, which fails with `FailureReason` `processing-error`) and mock CDN URLs. It behaves like the API where it matters for tests:

- Errors use the API's codes, HTTP statuses (404 for `asset/not-found`, 409 for
  `folder/not-empty`, ...), details and error body (`{code, message, requestId, details}`), with
  an `X-Request-Id` on every response. An unknown route is `misc/route-not-found`.
  Requests the API's schema refuses fail with `validation/<issue>` and the field in
  `details.path` (page sizes from 1 to 100, event limits from 1 to 100, search limits from 1 to
  20 and queries of 1 to 200 characters). Refusals the client makes before sending, such as
  multipart part and image sizes, carry the status the API would answer with.
- `Assets.List` and `ListChildren` apply RSQL filters (`==`, `!=`, `=in=`, `=out=`,
  comparisons, `;` binding tighter than `,`, parentheses), ordering, `FolderID` and paging.
  Cursors resume after the last returned asset, so creates and deletes between pages don't
  shift later pages, and a cursor only continues the query (filter, folder and ordering) it
  came from.
- `Assets.Search` runs the API's keyword search: every query word (case-insensitive, up to
  8) must appear in the name, ID, external ID, description, tags, type, content format or
  extension, or moderation status, and results are ranked by the API's score, then newest first.
- The default clock advances at least 1 ms per reading, so assets created in a row have
  increasing `createdAt` values; a `Now` you supply is used as is.
- A decided upload finishes processing (`completed`); like the API, its content is then removed
  (`Content.Status` `removed`, `RemovalReason` `retention`) and no longer served unless the
  upload set `KeepContentAfterProcessing`. `OutcomePurged` always removes the content, with
  `RemovalReason` `policy`. A classified image gets a ThumbHash, which the `placeholder`
  resource serves as a PNG and which goes with its content. Fields that are not set are `null`.
  `Retry` needs failed processing and content that was not removed.
- Like the API, retrying an asset records an `asset.retried` event, removing its content an
  `asset.content-removed` event and deleting it an `asset.deleted` event.
- Multipart uploads keep the queue mode chosen at the start, check part numbers
  (`details.expectedPartNumber` and `receivedPartNumber`), image totals (10 to 20 MiB) and
  `TotalSizeInBytes`.
- `Idempotency-Key` requests are replayed, and a key reused for another request returns
  `idempotency/key-reused`. A failed request frees its key, and keys must be 1 to 255
  printable ASCII characters without a space at either end (`idempotency/invalid-key`).
- Lenses: an unchanged definition returns the stored lens, a change needs a greater version
  (`lens/version-conflict` with `currentVersion`, `requestedVersion` and `minimumVersion`), and
  lenses saved before a conflict stay saved. Folder names are unique among siblings (case
  matters), lists sort by code point, and moves refuse cycles.
- Hash lists and their entries live in `DatabaseStorage` (`HashLists`, `HashListEntries`).
  `AddEntry` answers 201 for a new entry and 200 with the existing one for a hash already
  listed, takes an asset's `content.image.perceptualHash` and `perceptualHashQuality` for
  `AssetID` (`hash-list/asset-not-hashed` without one), and deleting a list deletes its
  entries. Uploads are not matched against the lists.
- `EnqueueEvent` adds events to the feed, and returns them as stored, which `Events.List` and
  `ListAll` return after cursors taken earlier (50 per page by default).
- `CDN.Serve` answers with content type and length, and `Cache-Control` as the CDN sets it
  (`public` only when anyone may see the asset, otherwise `private`; `max-age=31536000, immutable`
  for images, `max-age=3600` otherwise), `Cache-Tag`, `X-Content-Type-Options: nosniff`,
  `Content-Security-Policy` and, for images, `ETag` and `Expires`. Like the
  CDN, blocked, purged and failed assets and removed content return 403 `asset/not-available`
  whatever the key. An age-restricted asset requested without `ViewerClaims` with `AgeConfirmed`
  pointing to `true` returns 403 `viewer/age-confirmation-required` whatever the key. A private
  asset returns 403 `asset/api-key-missing-permission` unless the key has the `assets:download` permission; the default key has no grants, and `SetAPIKeyGrants`
  replaces them (the key stays the same). The placeholder is served for every image whatever its
  visibility or moderation, and refused once purged or removed.
- `Assets.Decide` validates and applies a decision like the API: a pending asset can only be
  blocked or purged (`asset/decision-not-allowed`), the current status is refused
  (`asset/decision-unchanged`), purged content can only be blocked (`asset/content-purged`),
  and an unknown asset is `asset/not-found`.
- Folders list by name (or `Ordering` by `createdAt`), then ID, with cursors like the API's;
  hash lists list newest first. Every cursor list returns 50 items by default.
- `Decide(assetID, OutcomeBlocked)` (or `OutcomeAllowed`, `OutcomeLimited`, `OutcomeAgeRestricted`,
  `OutcomePurged`) applies a reviewer's decision and adds the matching `asset.<decision>` event
  with a `decided-by: reviewer` fact; purging removes the content with `RemovalReason`
  `requested` and records `asset.content-removed` first.
- Waits take no real time: retry backoff and `Assets.WaitForDecision` only advance the mock
  client's clock, so `WaitForDecision` returns `sdk/timeout` straight away for an asset whose
  moderation stays pending.

It does not classify content, transform media or fetch URLs, and its signed URLs are not
production URLs. Inspect or seed `DatabaseStorage` and `ImageStorage` between calls, or
use `WithStorage` to change them while other goroutines send requests. `CreateMockAPIKey`
accepts grants for private and age-restricted CDN permission tests. Retries are off by default in the mock
(`MaxRetries` 0) so that `FailNext` fails exactly one call.

Every request is captured, decoded, for assertions; `FailNext` queues transport
failures, and `FailNextRequest(failure, operation)` fails the next request (or the next one of
`operation`, such as `"assets.create"` or `"cdn.serve"`) with `calmlenstest.FailureTransportError`,
`FailureTimeout` or an API error code, so you can test error handling without a network:

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
`calmlenstest.SignUploadToken(apiKey, options, now, nonce)` signs an upload token at a fixed
time and nonce, for comparing exact tokens.

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

`Folders.List` returns a `FolderPage` of one folder's children (`ParentID`; omit it for the project root) in `Items`, the folders above them in `Ancestors`, and `HasMore` and `NextCursor` for the next page. `PageSize` is 1 to 100 (50 by default). `Search` keeps the children whose names contain it, and `Ordering` sorts by `name` (the default, `calmlens.OrderAscending`) or `createdAt`.

### Viewer context for CDN delivery

CDN methods accept optional viewer claims (`viewerClaims`, or the language's `viewer_claims` / `ViewerClaims` field). The object contains `region` and `ageConfirmed`, using the SDK's normal field naming. Region defaults to the country of the connection reaching CalmLens; age confirmation defaults to false. Proxies should forward the incoming viewer country rather than rely on their outgoing connection's country. CalmLens accepts these as customer assertions without independently verifying them.

Age-restricted content returns `403` with `viewer/age-confirmation-required` unless age confirmation is true, including API-key and signed-URL requests. Private assets separately require access permission. Blocks and safety holds cannot be overridden by claims. Applications that never use age-restricted content should leave confirmation false, including processing jobs.

Raw HTTP clients can send a JSON `viewerClaims` query parameter or the JSON `X-CalmLens-Viewer-Claims` header; the query takes precedence. Signed URLs include claims when created and must be forwarded unchanged. Asset retrieval returns stored moderation results without a request-specific `delivery` object. Proxy caches must not bypass current viewer and moderation checks; honour `private, no-store` responses.
