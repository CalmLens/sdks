import type { AssetAvailability } from "../client/CalmLensTypes";
import type { AssetOptions } from "./Asset";
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

/** Props every framework's `CalmLensAsset` takes, on top of the asset options. */
export interface AssetDisplayOptions {
  /**
   * Describes an image or still, and labels video, audio, documents, text and file icons. Leave it
   * empty only for decorative images.
   */
  alt?: string;
  /** How the content fills its box: `contain` (default) or `cover`. */
  fit?: "contain" | "cover";
  /** Width divided by height, which reserves the box's size before the info arrives. */
  aspectRatio?: number;
  /** Load images only when they near the viewport. Defaults to `true`. */
  lazy?: boolean;
  fetchPriority?: "high" | "low" | "auto";
  /** Replaces some or all of the text the component shows. */
  messages?: Partial<CalmLensMessages>;
}

/** What `CalmLensAsset` reports, in every binding (as callbacks, events or `on*` props). */
export interface AssetEventHandlers {
  /** The content shown loaded: an image, a player's metadata, or a viewer's content. */
  onLoad?: () => void;
  /** The content couldn't be shown, after any refresh of the asset URL. */
  onError?: () => void;
  /** The viewer's availability became known or changed, from the info or the CDN's refusal. */
  onAvailabilityChange?: (availability: AssetAvailability) => void;
  /**
   * The viewer pressed the reveal button on age-restricted content. Run your app's age check,
   * then render again with `viewerClaims.ageConfirmed`. Without it, the notice has no button.
   */
  onAgeConfirmRequest?: () => void;
  onPlay?: () => void;
  onEnded?: () => void;
  /** Video or audio played on, with its position in seconds. */
  onTimeUpdate?: (currentTime: number) => void;
}

export type AssetProps = AssetOptions & AssetDisplayOptions & AssetEventHandlers;

/** The size of the file icon shown for an asset with nothing else to show. */
export const ASSET_FILE_ICON_SIZE = 64;
