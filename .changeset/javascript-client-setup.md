---
"@calmlens/sdk": minor
---

`CalmLensServerClient` reads `CALMLENS_API_KEY`, `CALMLENS_PROJECT_ID` and `CALMLENS_BASE_URL`
from the environment when you leave them out, in runtimes that have one, so
`new CalmLensServerClient()` is enough on a configured server. `appInfo: { name, version, url }`
appends your app to the user agent.

Every method that sends a request takes optional request options after its own options:
`signal`, `timeoutMs`, `maxRetries`, `idempotencyKey`, `headers`, and `extraQuery` and `extraBody`
for API fields this SDK version doesn't know yet. They replace `withRequestOptions`, which is
removed: pass `{ signal, timeoutMs }` to the call instead of deriving a client.

`client.request(method, path, { query, body, headers })` sends any API request with the client's
key, retries and error handling.

Set `CALMLENS_LOG=info` or `debug` (or the `logLevel` option, with an optional `logger`) to log
retries, failures or every attempt, and pass `onAttempt` to receive each attempt's operation,
path, status, request ID, duration and retry delay. Neither ever includes the API key, upload
tokens, query strings or bodies.

The `calmlens` CLI reads the API base URL from `CALMLENS_BASE_URL`, the name the SDKs use, instead
of `CALMLENS_API_URL`.
