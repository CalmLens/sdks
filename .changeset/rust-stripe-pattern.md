---
"@calmlens/sdk-rust": minor
---

Options types are `#[non_exhaustive]`, so a minor release can add an option. Build them with
`new`, which takes the required fields, and a chained setter per optional field, such as
`UpdateAsset::new(id).name("Holiday").clear_description()`; `clear_*` sends `null`. Path ID
types such as `AssetId` also convert from `&str` and `String`. Types with required fields no
longer implement `Default`.

`classification.moderation.decision` replaces `classification.moderation.status`: it is an
`Option<AssetModerationDecision>`, `None` until there is a decision, and
`AssetModerationStatus` is removed. An event's asset snapshot reads it with
`moderation_decision()`.

Enums keep values this SDK version doesn't list as `Unknown(UnknownValue)`, which can be read
with `as_str()` but not constructed. The variant is deprecated: to act on a value this version
doesn't list, compare `as_str()` in a `_` arm. `ErrorCode::Other` is now `ErrorCode::Unknown`.
Enums compare and hash by their wire value.

A response that lacks a field the API always sends now fails with `sdk/invalid-response`
instead of decoding as an empty value. Fields the API always sends are no longer `Option`s,
such as `Asset::name`, `Asset::created_at`, `Lens::id`, `Event::severity` and every page's
`has_more`. `Policy::updated_at` is an `Option`. More fields are typed enums, including event
fact keys (`EventFactKey`), regions, review reasons and stream statuses.
`ListChildren::filter` and `UpdateAsset::folder_id`, which the API doesn't accept, are removed;
move assets with `move_asset`. Project settings updates take a `HumanReviewDefinition`, whose
fields are optional.

`Error::kind()` returns an `ErrorKind`, such as `NotFound`, `RateLimit` or `Connection`, and
`Error::is(kind)` also matches the broader kinds, such as `ErrorKind::Api` for every non-2xx
response. `Error::status()` and `ErrorCode::http_status()` return an `http::StatusCode`.
`Error::raw_body()` keeps an error response's body, such as a proxy's HTML page.

The client uses reqwest 0.13 and no longer takes your own reqwest client: set a proxy with
`ServerClientBuilder::proxy` and trust extra PEM root certificates with
`add_root_certificate`. The `rustls` feature verifies certificates with the operating system's
trust store, and `rustls-native-roots` is removed.

`ServerClient::from_env()` reads `CALMLENS_API_KEY`, `CALMLENS_PROJECT_ID` and
`CALMLENS_BASE_URL`, and `app_info` names your application in the `User-Agent`.
`client.with_options(RequestOptions::new()...)` sets a timeout, retry limit, idempotency key,
headers, query parameters and body properties for its calls, and `client.request` calls any API
endpoint with the client's authentication, retries and error mapping. Results have
`last_response()`, with the status, request ID and headers. `on_attempt` reports every HTTP
attempt, the `tracing` feature emits it as a `tracing` event and `CALMLENS_LOG=info|debug`
writes it to standard error, never with the API key, tokens, signed URL grants or bodies.
