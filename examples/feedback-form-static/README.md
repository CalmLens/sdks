# Calmform: static feedback form

A feedback form on a static page. Visitors describe a problem and attach a screenshot, and the
page uploads it straight to CalmLens through an upload preset open to anyone. There's no
backend and no API key: the page only knows the preset ID.

The whole integration is in [`app.js`](app.js):

```js
const client = new CalmLensAppClient({ uploadPresetId: "your-upload-preset-id" });

const asset = await client.assets.classify({
  name: file.name,
  description: message,
  content: { data: file, type: file.type },
});

if (asset.status === "rejected") {
  // "This image can't be posted."
}
```

`assets.classify` waits for the decision. Errors with an `upload-preset/*` code, such as
`upload-preset/daily-limit-reached` and `upload-preset/content-type-not-allowed`, are turned into
friendly messages.

## 1. Create the upload preset

In the CalmLens portal, open [Upload presets](https://calmlens.com/portal/upload-presets), choose **New preset** and set:

| Setting | Value for this example |
| --- | --- |
| Who can upload? | **Anyone with the preset ID** |
| Daily upload limit | Required. The most uploads you'll accept per UTC day, for example `100`. |
| Allowed sites | `http://localhost:6406` |
| File types | `image/*` |
| Maximum file size (MB) | For example `10`. |
| Show the decision to the uploader | On, so the page can say when a screenshot is rejected. |
| Folder and visibility | Where uploads go. Leave visibility private unless you want to show uploads publicly. |

Copy the preset ID and paste it into `UPLOAD_PRESET_ID` in [`app.js`](app.js).

## 2. Run it

No published `@calmlens/sdk` release includes `CalmLensAppClient` yet, so this example
uses the SDK built from this repo. From the repo root, build it once:

```bash
(cd javascript && bun install && bun link)
```

Then start the page:

```bash
cd examples/feedback-form-static
bun run dev
```

`bun run dev` bundles the SDK's `@calmlens/sdk/app` build into `sdk/calmlens.js` and serves the folder. Open
http://localhost:6406, write a message, attach a screenshot and send it. Use `localhost`
rather than `127.0.0.1`: they're different origins, and only the one in the preset's allowed
sites can upload.

### Using a published SDK release

Once a published `@calmlens/sdk` release includes `CalmLensAppClient`, point the
`@calmlens/sdk/app` entry of the import map in [`index.html`](index.html) at it instead of
`./sdk/calmlens.js`, for example with `https://esm.sh/@calmlens/sdk@<version>/app`, and drop the
bundling step.

Uploads appear in the preset's folder in the portal. To hear about them without a server,
connect Slack or email in
[Webhooks & connectors](https://calmlens.com/portal/connectors).

## What protects a preset open to anyone

- **Anyone with the preset ID can upload**, up to the daily limit. The ID is in your page's
  source, so treat it as public. The daily limit is what caps your usage; once it's reached,
  uploads fail with `upload-preset/daily-limit-reached` until the next UTC day.
- **Allowed sites only stop other websites.** Browsers send an `Origin` header that CalmLens
  checks, but a script or command-line tool can send any header it likes. Keep the daily limit
  even when allowed sites are set.
- **The browser can't change the rules.** The folder, visibility, metadata and processing
  options come from the preset. The page can only set the upload's name and description.
- **Visitors only see their own decision**, and only when the preset shows decisions. Reports,
  metadata and URLs are never returned to the browser.

If people need to sign in to upload, use a preset that requires upload tokens instead and sign
them on your server. See the [upload presets guide](https://calmlens.com/docs/guides/upload-presets).
