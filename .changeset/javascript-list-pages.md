---
"@calmlens/sdk": minor
---

Every `list` method now returns a page you can await or iterate. Await it for one page, which has
`hasNextPage()` and `getNextPage()`. Iterate it with `for await` to get every item across pages,
or call `autoPagingToArray({ limit })` to collect up to 10,000 items. The separate iterators are
gone: replace `assets.iterate(options)` with `assets.list(options)`, and likewise `iterateChildren`
with `listChildren`, `iterateTimeline` with `listTimeline`, `iterateEntries` with `listEntries`,
and `folders`, `hashLists`, `policies`, `lenses` and `uploadPresets` `.iterate` with `.list`.
`events.pages(options)` is replaced by `events.list(options)`: iterating it yields every event
waiting after the cursor, and `getNextPage()` walks it page by page.

Results of successful calls now carry `lastResponse`, with the HTTP `status`, `requestId`,
`headers` and, for uploads, the `idempotencyKey`. It isn't enumerable, so `JSON.stringify` and
spreading leave it out. Methods declare it as `CalmLensResponse<T>`.

`hls.js` and `pdfjs-dist` are now optional peer dependencies, so a server install no longer
downloads them. Web apps that use the UI components install them alongside the SDK:
`npm install calmlens hls.js pdfjs-dist`. React Native apps don't need them.
