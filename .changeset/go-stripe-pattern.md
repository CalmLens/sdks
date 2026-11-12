---
"@calmlens/sdk-go": minor
---

The module path is now `calmlens.com/go/calmlens`, so the import needs no alias:
`go get calmlens.com/go/calmlens@latest`, then `import "calmlens.com/go/calmlens"`. The SDK requires
Go 1.25 or later, and `it.All(ctx)` returns an `iter.Seq2`.

Every method's options embed `calmlens.Params`, for one call's `Headers`, `ExtraQuery` and `ExtraBody`
fields the SDK doesn't declare yet, `Timeout`, `MaxRetries` and `IdempotencyKey`. An `IdempotencyKey` makes any
write safe to retry. Upload options take their key in `Params` too:
`SubmitAssetOptions{..., Params: calmlens.Params{IdempotencyKey: key}}`. `CDN.Serve` takes its
request headers in `Params.Headers`. `Policies.RetrieveAssigned`, `ProjectSettings.Get` and
`MetadataFields.List` take options for their `Params`. `client.WithRequestOptions` is removed:
pass `Params` instead.

Every model a method returns has `LastResponse`, with the response's `StatusCode`, `Header`,
`RequestID` and `IdempotencyKey`.

Every model, nested ones included, has `RawJSON()`, the JSON object the API sent, and
`ExtraFields()`, the fields it has no Go field for. They replace `Asset.Raw`, `Event.Raw`,
`CategoryResult.Raw` and `AssetModeration.Extra`.

`Options.HTTPClient` takes any `calmlens.HTTPDoer`, such as a client that logs or traces requests,
as well as an `*http.Client`.

Enumerations are named string types with typed constants, such as `ClassificationStatus`,
`ModerationDecision`, `Category`, `EventType`, `EventFactKey`, `Visibility` and `LensType`, used
in request and response fields. Values added to the API later still decode. New constants cover
upload, HLS and pending-review statuses and reasons, regions, jurisdictions, remote URL rule modes,
metadata field types and icons, link sources and category policy sources.

`Error.Code` is a `calmlens.ErrorCode`, as are the `Code...` constants. The helper that reads the code
from an error chain is now `calmlens.CodeOf(err)`.

Tell kinds of error apart with `errors.Is`: `calmlens.ErrAPI` for any non-2xx answer, and beneath it
`ErrBadRequest`, `ErrAuthentication`, `ErrPermissionDenied`, `ErrNotFound`, `ErrConflict`,
`ErrPayloadTooLarge`, `ErrUnprocessableEntity`, `ErrRateLimit` and `ErrServer`. There are also
`ErrConnection`, `ErrTimeout`, `ErrCancelled`, `ErrInvalidArgument` (with `ErrConfiguration`
beneath it), `ErrInvalidResponse` and `ErrWebhookVerification`. An error of a kind matches each
kind above it, and `Error.Kind()` returns the most specific one. `*Error` keeps the response's
`Body`, up to 16 KiB, such as a proxy's HTML page. It also records the request's `Method`, `Path`
and `Attempts`, and implements `slog.LogValuer` without its body.

The client reads `CALMLENS_API_KEY`, `CALMLENS_PROJECT_ID` and `CALMLENS_BASE_URL` when you don't
pass them; set `IgnoreEnvironment` to stop it. `Options.AppInfo` adds your application to the user
agent. `Options.Logger` takes a `*slog.Logger`, or set `CALMLENS_LOG=info` or `debug`, to log each
request's outcome and retries without the API key, tokens, signed URLs or bodies.
`Options.OnAttempt` receives every attempt's operation, method, path, attempt number, retry delay,
status, request ID and duration. `Options.MaxRetryDelay` caps the wait before a retry.
`Params.ExtraQuery` and `Params.ExtraBody` send query parameters and body fields the SDK doesn't
declare yet. `client.Request` sends an API route the SDK has no method for, with the client's
authentication, retries and errors.
