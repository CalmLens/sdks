# Widget playground

Try the CalmLens upload widget and media component in React, Vue, Svelte and web components on
one page. Upload in one library and the shared gallery renders the result with each library's
media component, so you can compare them side by side.

## Run it

Build the SDK from this repository, then install and start the playground:

```bash
(cd ../../javascript && bun install && bun run build)
bun install
bun run dev
```

Open the URL Vite prints. Rebuild the SDK and run `bun install` again after changing it, because
Bun copies local packages.

### Mock mode (default)

With no credentials the dev server answers the upload API and CDN itself, using the SDK's
`MockCalmLensAppClient` and `MockCalmLensServerClient`, so nothing leaves your machine. The
mock decides from the file name: names containing `sensitive` are age-restricted and names
containing `blocked` are blocked. Everything else is allowed after a short check. The preset
needs a token, accepts images, video and audio up to 25 MB, and the CDN applies the same
moderation gate as the real one (lenses and transforms are ignored).

The sample buttons drop files on the current uploader, through the same handler as a real drop.

### Live mode

To use your own project, create an upload preset that requires a token, shows the decision to
the uploader and keeps content with public visibility, allow `http://localhost:5173` (or the
port you use) as a site, then:

```bash
CALMLENS_API_KEY=... CALMLENS_PROJECT_ID=... CALMLENS_UPLOAD_PRESET_ID=... bun run dev
```

The dev server signs an upload token for each file at `POST /api/upload-token`. A real app checks
who is asking and passes the ID of the record being created as `externalId`; see
[Build an upload component](https://calmlens.com/docs/guides/upload-component).

## What to look at

| File                                                         | What it shows                                                              |
| ------------------------------------------------------------ | -------------------------------------------------------------------------- |
| [`src/react/App.tsx`](src/react/App.tsx)                     | `@calmlens/sdk/react`                                                      |
| [`src/vue/App.vue`](src/vue/App.vue)                         | `@calmlens/sdk/vue`                                                        |
| [`src/svelte/App.svelte`](src/svelte/App.svelte)             | `@calmlens/sdk/svelte`                                                     |
| [`src/elements.ts`](src/elements.ts)                         | `<calmlens-uploader>` and `<calmlens-media>` from `@calmlens/sdk/elements` |
| [`server/playground-server.ts`](server/playground-server.ts) | Token signing and the mock API and CDN                                     |

"Viewer may see sensitive media" stands in for your app's own age check: off, age-restricted
images stay behind the blurred placeholder; on, they load with the `allowAgeRestricted` opt-in.

## Check

```bash
bun run check
```
