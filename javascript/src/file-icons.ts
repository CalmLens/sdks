// File-type icons, on their own so an app can draw them without the upload widget: the families,
// colours and paths the widget shows for files without an image preview.

export type { FileIconFamily, UploadFileIconFamily } from "./ui/FileIcons";
export {
  FILE_ICON_COLORS,
  FILE_ICON_OUTLINE,
  FILE_ICON_SYMBOLS,
  getFileIcon,
  getFileIconLabel,
  getFileIconLayout,
  MORE_FILE_ICON_SYMBOLS,
  renderFileIconSvg,
} from "./ui/FileIcons";
