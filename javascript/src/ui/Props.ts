import type { MediaOptions, MediaState } from "./Media";
import type { CalmLensMessages } from "./Messages";
import type { UploadController, UploadControllerOptions, UploadFile } from "./UploadController";

/** Props every framework's uploader takes, on top of the upload options. */
export interface UploaderDisplayOptions<F extends UploadFile = UploadFile> {
  disabled?: boolean;
  /** Opens the camera on phones: `user` for the front camera, `environment` for the back. */
  capture?: "user" | "environment";
  /** Replaces some or all of the text the uploader shows. */
  messages?: Partial<CalmLensMessages>;
  /**
   * Shows this upload queue instead of creating one, such as `useCalmLensUpload`'s `controller`,
   * so your app can read the picked files and call `start()`. The upload options then come from
   * the controller, and the uploader leaves its uploads running when it unmounts.
   */
  controller?: UploadController<F>;
}

export type UploaderProps<F extends UploadFile = UploadFile> = UploadControllerOptions<F> &
  UploaderDisplayOptions<F>;

/** Props every framework's media component takes, on top of the media options. */
export interface MediaDisplayOptions {
  /**
   * Describes the image, and labels a video, audio, PDF or file icon. Leave it empty only for
   * decorative images.
   */
  alt?: string;
  /** Width divided by height, which you store with the upload, so the box keeps its size. */
  aspectRatio?: number;
  /** The intrinsic width, used with `height` for the aspect ratio and the image attributes. */
  width?: number;
  height?: number;
  /** The `sizes` attribute for `widths`, such as `(min-width: 768px) 50vw, 100vw`. */
  sizes?: string;
  /** The asset's `content.preview.averageColor`, shown behind the media while it loads. */
  averageColor?: string;
  /** How the media fills its box: `cover` (default) or `contain`. */
  fit?: "cover" | "contain";
  /** The CSS `object-position`, such as `top` or `30% 50%`. */
  position?: string;
  /** Load the image only when it nears the viewport. Defaults to `true`. */
  lazy?: boolean;
  fetchPriority?: "high" | "low" | "auto";
  /** Video and audio controls. Defaults to `true`. */
  controls?: boolean;
  messages?: Partial<CalmLensMessages>;
  /**
   * Called when the viewer presses the reveal button on age-restricted media. Run your app's own
   * check, then render again with `ageConfirmed`. Without it, the notice has no button.
   */
  onReveal?: () => void;
}

export type MediaProps = MediaOptions & MediaDisplayOptions;

/** The aspect ratio a media component's box keeps, if it knows one. */
export const getMediaAspectRatio = ({ aspectRatio, width, height }: MediaDisplayOptions) =>
  aspectRatio ?? (width && height ? width / height : undefined);

/** A key that changes whenever a media component must load something new. */
export const getMediaLoadKey = (state: MediaState): string => {
  switch (state.kind) {
    case "image":
      return `${state.src} ${state.srcSet ?? ""}`;
    case "video":
      return `${state.src} ${state.poster ?? ""}`;
    case "audio":
      return `${state.src} ${state.waveformUrl ?? ""} ${state.peaks?.length ?? 0}`;
    case "pdf":
      return state.src;
    case "file":
      return `file ${state.icon}`;
    case "unavailable":
      return state.reason === "regional" ? "unavailable-regional" : state.kind;
    default:
      return state.kind;
  }
};

/**
 * The blurred placeholder a media component shows, if any: behind the age notice, while signed
 * URLs load, and until an image loads.
 */
export const getShownPlaceholder = (state: MediaState, loaded: boolean): string | undefined =>
  state.kind === "gated" || state.kind === "pending" || (state.kind === "image" && !loaded)
    ? state.placeholderUrl
    : undefined;

/** The size of the file icon shown for an asset with nothing else to show. */
export const MEDIA_FILE_ICON_SIZE = 64;
