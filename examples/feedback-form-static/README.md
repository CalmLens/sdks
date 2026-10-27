# Calmform: static feedback form

A feedback form on a static page. Visitors pick a type, describe the problem, attach a screenshot
and, if they want a reply, leave an email address. The page uploads the screenshot straight to
CalmLens through an upload preset open to anyone, with the feedback as its description, and shows
the moderation decision in the form. There's no backend and no API key: the page only knows the
preset ID.

The attachment is the JavaScript SDK's upload widget, `<calmlens-uploader>` from
`@calmlens/sdk/elements`, which shows the preview, upload progress, the check and the decision.
[`app.js`](app.js) gives it an upload queue that waits for the form (`autoUpload: false`) and
uploads with the feedback as the description:

```js
const controller = createUploadController({
  accept: "image/*",
  maxFileSize: 10 * 1024 * 1024,
  autoUpload: false,
  upload: async (file, { signal, onProgress }) => {
    const client = new CalmLensAppClient({
      uploadPresetId,
      signal,
      uploadFetch: createProgressFetch(onProgress),
    });
    const asset = await client.assets.create({
      name: file.name,
      description, // The category, message and reply address
      content: { data: file, type: file.type },
    });
    return { assetId: asset.id, status: asset.status };
  },
  checkStatus: async (assetId) => (await statusClient.assets.retrieve({ assetId })).status,
});
uploader.controller = controller;

// On submit:
controller.start();
```

The widget checks the upload until CalmLens decides, for up to 15 seconds. What the form does
with the decision is in [`feedback.js`](feedback.js):

| Decision                               | The form                                                                                                                                   |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `allowed`, `limited`, `age-restricted` | Sends the feedback. Screenshots are only seen by your team, so restricted ones are fine.                                                   |
| Still `pending` after 15 seconds       | Sends the feedback; your team sees the screenshot once it's checked.                                                                       |
| `blocked`, `purged`                    | Doesn't send it. The widget says the image breaks the content rules, and the visitor keeps their message and picks a different screenshot. |
| An upload error                        | Shows a message for its code, such as `upload-preset/daily-limit-reached`, and sending again retries the upload.                           |

## 1. Create the upload preset

In the CalmLens portal, open [Upload presets](https://calmlens.com/portal/upload-presets), choose **New preset** and set:

| Setting                           | Value for this example                                                               |
| --------------------------------- | ------------------------------------------------------------------------------------ |
| Who can upload?                   | **Anyone with the preset ID**                                                        |
| Daily upload limit                | Required. The most uploads you'll accept per UTC day, for example `100`.             |
| Allowed sites                     | `http://localhost:6406`                                                              |
| File types                        | `image/*`                                                                            |
| Maximum file size (MB)            | For example `10`.                                                                    |
| Show the decision to the uploader | On, so the page can say when a screenshot breaks your policy.                        |
| Folder and visibility             | Where uploads go. Leave visibility private unless you want to show uploads publicly. |

Copy the preset ID and paste it into `UPLOAD_PRESET_ID` in [`config.js`](config.js).

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

`bun run dev` bundles the SDK's app client, upload widget and stylesheet into `sdk/` and serves
the folder. Open http://localhost:6406, write a message, attach a screenshot and send it. Use
`localhost` rather than `127.0.0.1`: they're different origins, and only the one in the preset's
allowed sites can upload.

To see a refusal, attach a [test image](https://calmlens.com/docs/guides/testing): download one
from **Assets → Try test inputs** in your project.

### Demo mode

While `config.js` still holds the example preset ID, the page runs in demo mode: uploads go to
the SDK's in-memory `MockCalmLensAppClient` from `@calmlens/sdk/testing`, and nothing leaves the
page. Screenshots with `blocked` in the file name are refused; everything else is accepted.

To try a preset without editing `config.js`, set `CALMLENS_UPLOAD_PRESET_ID` (and
`CALMLENS_API_URL` for a CalmLens instance other than `https://api.calmlens.com/v1`) when starting
the server, which then serves `config.js` from them.

Run the tests for the form's logic with `bun test`.

### Using a published SDK release

Once a published `@calmlens/sdk` release includes `CalmLensAppClient`, point the
import map in [`index.html`](index.html) at it instead of `./sdk/`, for example
`https://esm.sh/@calmlens/sdk@<version>/app` and `.../elements`, link
`https://esm.sh/@calmlens/sdk@<version>/styles.css`, and drop the bundling step.

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
