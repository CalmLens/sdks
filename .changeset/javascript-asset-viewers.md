---
"@calmlens/sdk": minor
---

Asset viewers for images, websites, text, documents and spreadsheets (preview).

- `CalmLensImageViewer`, `CalmLensWebsiteViewer`, `CalmLensTextViewer`, `CalmLensDocumentViewer` and `CalmLensSpreadsheetViewer` in React, Vue and Svelte, and the `<calmlens-image-viewer>`, `<calmlens-website-viewer>`, `<calmlens-text-viewer>`, `<calmlens-document-viewer>` and `<calmlens-spreadsheet-viewer>` custom elements. Each takes an API `asset` and, for private assets, the same `getSignedUrl` as `CalmLensMedia`, which they call again for a fresh URL when one stops working, such as once it expires. `calmlens/ui` has the framework-free viewers (`createImageViewer` and the others) and `getAssetViewerKind`, which names the viewer for an asset.
- The image viewer fits the rendered image inside its element over its placeholder; the website viewer shows the screenshot with a link to the page's `externalUrl`; the text viewer shows text as text, never as markup.
- The document viewer shows a PDF (or a document rendered as one) a page at a time with pdf.js, which is a new dependency (`pdfjs-dist` 6.4.299) loaded only when a document is shown: page and zoom controls, keys, each page's text for screen readers, and a link to the PDF when it can't be shown. `pdf.workerSrc` reads documents in a worker your app serves.
- The spreadsheet viewer shows the sheets of a spreadsheet's extracted text as tabs and tables, a page of rows at a time (`pageSize`), with hidden sheets, rows and columns marked. `parseSpreadsheetText` reads that text.
