---
"@calmlens/sdk": minor
---

The upload widget shows a file-type icon, coloured by kind of file and labelled with its extension, for files without an image preview. The icons are also available on their own from `@calmlens/sdk/file-icons` (`getFileIcon`, `renderFileIconSvg` and the families' colours and paths), so apps can show files the same way elsewhere. `UploadItemView.extension` is replaced by `fileIcon`, the icon's SVG markup. The focus ring is themeable with `--calmlens-focus-ring`, `--calmlens-focus-width` and `--calmlens-focus-offset`, and outlined buttons tint with the accent colour on hover.
