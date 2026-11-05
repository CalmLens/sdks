---
"@calmlens/sdk": minor
---

`CalmLensMedia` shows each asset the way `content.rendered.kind` describes it, in React, Vue, Svelte, React Native and the custom elements: an image as before; video plays its rendered file with the preview as its poster; audio plays its rendered file under its waveform preview, with the played part drawn from `content.rendered.peaks`; a PDF is embedded with a link to open it; an asset with no rendered file shows its preview, or its file icon. An optional `getSignedUrl(resource)` callback supplies signed URLs for private assets and a fresh one when a URL expires during playback, which then resumes where it stopped. Video and audio now play the rendered file rather than the original. In React Native, `renderPlayer` also receives the poster, peaks, a resume position and error and load callbacks.
