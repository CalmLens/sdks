# UI components

Front-end components for apps that moderate content with CalmLens, each written for React, Vue,
Svelte and plain JavaScript. The [CalmLens docs](https://calmlens.com/docs/guides/sensitive-media)
show these files, so they are type-checked and built here.

| Component       | Files                                   | What it does                                                                                     |
| --------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Photo upload    | `PhotoUpload`, `photo-upload.js`        | Uploads a file with a token from your server and waits for the moderation decision.              |
| Comment form    | `CommentForm`, `comment-form.js`        | Posts a comment to your server and shows why it was refused.                                     |
| Avatar          | `Avatar`, `avatar.js`                   | Shows an allowed or limited profile picture through the `avatar` lens, or the person's initial.  |
| Sensitive image | `SensitiveImage`, `sensitive-image.js`  | Shows the blurred placeholder for age-restricted images until your app lets the viewer see them. |
| Feed            | `Feed`, `media-feed.js`                 | Lists allowed, limited and age-restricted posts through the sensitive image component.           |
| Upload widget   | `PhotoUploader`, `photo-uploader.js`    | The SDK's ready-made uploader, through an upload preset with tokens from your server.            |
| Own API upload  | `OwnApiUploader`, `own-api-uploader.js` | The same uploader, sending files to your own API with progress and status checks.                |
| Post photo      | `PostPhoto`, `post-photo.js`            | The SDK's asset component, with responsive sources, the age-restricted gate and URL refresh.     |

Each library's components are in [`src/react`](src/react), [`src/vue`](src/vue),
[`src/svelte`](src/svelte) and [`src/html`](src/html). The avatar and sensitive image components
build public CDN URLs with `cdn.getAssetUrl` from `CalmLensAppClient` (`calmlens/app`), which needs
no API key. Once your app lets a viewer see sensitive media, the sensitive image component adds the
`ageConfirmed` viewer claim to age-restricted images' URLs. The post photo component is the SDK's
`CalmLensAsset` (`<calmlens-asset>` in plain JavaScript): it takes the asset URL your server sends,
public or signed with `cdn.signAssetUrl`, and reads whether the viewer can see it from the CDN.

## Run the demo pages

The components call your server for upload tokens (`POST /api/upload-token`), comments
(`POST /api/posts/:postId/comments`), uploads to your own API (`POST /api/photos` and
`GET /api/photos/:assetId`) and a fresh signed asset URL once one expires
(`GET /api/photos/:assetId/url`, answering `{ url }` from `cdn.signAssetUrl`); the guides on the
docs site show those endpoints. Set your
project ID and replace the sample asset IDs in [`src/demo.ts`](src/demo.ts) with public assets
from your project.

```bash
bun install
VITE_CALMLENS_PROJECT_ID=proj_8fK2mQx7Lp4NvB3tRz9Y bun run dev
```

Vite serves `react.html`, `vue.html`, `svelte.html` and `index.html` (plain JavaScript).

## Check

```bash
bun run check
bun run build
```
