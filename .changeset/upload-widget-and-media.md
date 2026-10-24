---
"@calmlens/sdk": minor
---

Adds an upload widget and a media component for React (`@calmlens/sdk/react`), Vue (`@calmlens/sdk/vue`), Svelte 5 (`@calmlens/sdk/svelte`) and web components (`@calmlens/sdk/elements`), on a framework-free core in `@calmlens/sdk/ui`.

`CalmLensUploader` uploads through an upload preset or your own `upload` function, shows byte progress, waits for the moderation decision and shows a message for each outcome and error code. `CalmLensMedia` serves an asset's rendered image from the CDN, in the format the browser accepts, with `srcset` widths and a blurred placeholder, keeps age-restricted assets behind the placeholder and a reveal button until `canView` is set, and shows an unavailable notice for blocked and purged assets. The stylesheet is also published as `@calmlens/sdk/styles.css`.

`@calmlens/sdk/testing` adds `MockCalmLensAppClient`, which applies upload preset rules and stores uploads in a `MockCalmLensServerClient`. The mock server client's `queuedOutcome` and `analyzedOutcome` accept a function of the asset, and its `cdn.serve` refuses blocked assets and serves placeholders whatever the moderation status, as the CDN does.
