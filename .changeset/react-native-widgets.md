---
"@calmlens/sdk": minor
---

`@calmlens/sdk/react-native` has `CalmLensUploader`, `CalmLensMedia` and `useCalmLensUpload` for React Native and Expo apps, built on the same upload queue, messages and media states as the web components and with no native modules. The uploader takes a `pick` function that opens your app's picker, such as `expo-image-picker`, and a `theme` for its colours and corner radius. The media component loads the width in `widths` that covers its measured size, and hands video and audio to your player through `renderPlayer`.

Breaking: the upload queue takes any `UploadFile`, a file with a name, MIME type, size and `arrayBuffer()`, instead of only a browser `File`. A `File` from `expo-file-system` works as it is, and its `uri` becomes the image preview. `UploadItem.file`, `CalmLensUpload.file` and the `upload` and `token` callbacks now have this type.

`resolveTheme` and `CALMLENS_THEME` hold the components' default colours, and `pickMediaSource` picks an image width for a measured box, for building your own components.

`retry` checks an upload again, with the token it was uploaded with, when the upload finished but its status check failed, instead of uploading the file again as a new asset. It also checks a finished upload that is still `pending` again.
