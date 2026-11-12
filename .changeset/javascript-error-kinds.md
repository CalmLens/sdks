---
"@calmlens/sdk": minor
---

Errors now have a class for each kind of failure, all extending `CalmLensError`:
`CalmLensApiError` and its `CalmLensBadRequestError`, `CalmLensAuthenticationError`,
`CalmLensPermissionDeniedError`, `CalmLensNotFoundError`, `CalmLensConflictError`,
`CalmLensPayloadTooLargeError`, `CalmLensUnprocessableEntityError`, `CalmLensRateLimitError`
and `CalmLensServerError`, plus `CalmLensConnectionError`, `CalmLensTimeoutError`,
`CalmLensCancelledError`, `CalmLensInvalidArgumentError` (and its `CalmLensConfigurationError`),
`CalmLensInvalidResponseError` and `CalmLensWebhookVerificationError`. `error.kind` names the kind
and `error.isKind(kind)` checks it. `instanceof` works across copies of the SDK. API errors keep
the response body as text in `error.body`, up to 4 KiB.
