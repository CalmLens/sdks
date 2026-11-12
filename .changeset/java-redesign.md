---
"@calmlens/sdk-java": minor
---

Redesign the Java SDK so new API fields and values arrive without breaking your code.

- **Packages and module.** The SDK is the module `com.calmlens` (`requires com.calmlens;`). Request params are in `com.calmlens.params`, response models and enums are top-level classes in `com.calmlens.models`, exceptions are in `com.calmlens.exception`, and `MockCalmLensServerClient`, `MockDecision` and `TestInputs` are in `com.calmlens.testing`. `Models` is gone. Public types carry JSpecify nullness annotations, so Kotlin sees which values can be null.
- **Client setup.** `CalmLensServerClient.fromEnv()` reads `CALMLENS_API_KEY`, `CALMLENS_PROJECT_ID` and `CALMLENS_BASE_URL` (or the `calmlens.apiKey`, `calmlens.projectId` and `calmlens.baseUrl` system properties). `builder()` takes no arguments: set `apiKey(...)` and `projectId(...)`, and `build()` refuses a missing one. `appInfo(name, version, url)` names your integration in the `User-Agent`.
- **Resources.** Resources are methods: `client.assets()`, `client.folders()`, `client.cdn()` and so on.
- **Params.** Each operation takes its IDs as arguments and its other options as immutable params from a builder, for example `client.assets().update(assetId, AssetUpdateParams.builder().setName("cover.png").clearDescription().build())`. `build()` refuses a missing required option. `clearX()` sends null to clear a field. `putExtraParam` sends a field this SDK version doesn't declare.
- **Request options.** Every method takes a `RequestOptions` as its last argument: timeout, upload timeout, retries, idempotency key, extra headers and extra query or body fields. `RequestOptions` is now an immutable builder.
- **Models.** Models are immutable classes with getters. A field the API may leave out or send as null has an `Optional` getter, and `hasField` tells a missing field from one sent as null. Reading a field the API always sends throws `sdk/invalid-response` when the response lacked it. `validate()`, or the builder's `responseValidation(true)`, checks a whole response at once. `getRawJsonObject()` and `getAdditionalProperties()` keep the fields this SDK version doesn't declare, and `getLastResponse()` gives each result's request ID, status and headers.
- **Enums.** Fixed sets of values, such as asset types, failure reasons, likelihoods, policy actions and event types, are Java enums. A value added after your SDK version reads as `UNKNOWN`, so a `switch` keeps working.
- **Moderation decision.** `classification.moderation.decision` is an `Optional<AssetModerationDecision>`, empty until the asset is decided.
- **Exceptions.** Each kind of failure has its own class under `CalmLensException`:
  - `ApiException`, with `BadRequestException`, `AuthenticationException`, `PermissionDeniedException`, `NotFoundException`, `ConflictException`, `PayloadTooLargeException`, `UnprocessableEntityException`, `RateLimitException` and `ServerException` beneath it.
  - `ConnectionException`, `TimeoutException` and `CancelledException`.
  - `InvalidArgumentException`, with `ConfigurationException` beneath it.
  - `InvalidResponseException` and `WebhookVerificationException`.

  `getBody()` keeps the raw response body, such as a proxy's error page, and `getRequestId()` returns an `Optional`.
- **Async client.** `client.async()` returns the same operations as `CompletableFuture`s.
- **Raw requests.** `client.request(method, path, query, body, requestOptions)` calls an API path the SDK has no method for yet, with the client's authentication, retries and errors.
- **Logging and hooks.** `CALMLENS_LOG=info|debug` (or `logLevel(...)` and `logger(...)`) logs retries, failures and requests through `System.Logger`. `requestListener(...)` receives every request attempt with its operation, status, request ID, duration and retry delay. Neither ever includes the API key, bodies, query strings or signed URLs.
- **Events.** `events().iterate(...)` yields every event across pages, and `events().pages(...)` still yields whole pages.
- **Option changes.** `FolderUpdateParams.setName`, `HashListUpdateParams.setName` and `HashListUpdateParams.setAction` take plain values, since a name and an action can't be cleared. Folders have no description option, and `assets().update` has no folder option: move an asset with `assets().move`.
