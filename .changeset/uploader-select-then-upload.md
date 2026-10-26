---
"@calmlens/sdk": minor
---

The upload widget can wait to upload: with `autoUpload: false` (the `no-auto-upload` attribute on the web component), picked files stay in a new `selected` stage until you call `start()` on the upload controller, for example when a form is submitted. Pass `controller` (from `useCalmLensUpload` or `createUploadController`) to show a queue your app owns, so it can read the picked files and start or clear them; the upload options then come from that controller. An uploader that takes one file now replaces its drop zone with the picked file and a "Choose another" button. The drop zone has a new look with an outlined picker button, and the new messages are `chooseFile`, `chooseAnother` and `selected`. The default `dropzoneTitle` and `chooseFiles` text changed.
