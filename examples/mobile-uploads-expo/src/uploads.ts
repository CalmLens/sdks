import type { UploadedAsset } from "@calmlens/sdk/app";

/** A photo picked from the library. */
export interface PickedPhoto {
  uri: string;
  name: string;
  type: string;
  width: number;
  height: number;
}

/**
 * One photo's upload, from picking it to CalmLens's decision:
 *
 * - `uploading`: sending the photo.
 * - `checking`: uploaded and `pending`, so the app polls `assets.retrieve` for the decision.
 * - `stalled`: still `pending` after the app stopped polling; the person can check again.
 * - `decided`: CalmLens decided; `asset.status` holds the decision.
 * - `failed`: the upload or a check failed; the person can try again.
 */
export type Upload = {
  key: string;
  photo: PickedPhoto;
  startedAt: number;
} & (
  | { stage: "uploading" }
  | { stage: "checking" | "stalled" | "decided"; asset: UploadedAsset }
  | { stage: "failed"; message: string; code?: string; asset?: UploadedAsset }
);

export type UploadEvent =
  | { type: "started"; key: string; photo: PickedPhoto; at: number }
  | { type: "retried"; key: string }
  | { type: "checked"; key: string; asset: UploadedAsset }
  | { type: "stalled"; key: string }
  | { type: "failed"; key: string; message: string; code?: string };

/** Applies an event to the uploads, newest first. */
export const uploadsReducer = (uploads: Upload[], event: UploadEvent): Upload[] => {
  if (event.type === "started") {
    const upload: Upload = {
      key: event.key,
      photo: event.photo,
      startedAt: event.at,
      stage: "uploading",
    };
    return [upload, ...uploads.filter((other) => other.key !== event.key)];
  }
  return uploads.map((upload): Upload => {
    if (upload.key !== event.key) return upload;
    const base = { key: upload.key, photo: upload.photo, startedAt: upload.startedAt };
    switch (event.type) {
      case "retried":
        return { ...base, stage: "uploading" };
      case "checked":
        // `status` is the moderation status: `pending` until CalmLens decides. It's missing only
        // when the preset doesn't show decisions to uploaders, which counts as decided here.
        return {
          ...base,
          stage: event.asset.status === "pending" ? "checking" : "decided",
          asset: event.asset,
        };
      case "stalled":
        return upload.stage === "checking"
          ? { ...base, stage: "stalled", asset: upload.asset }
          : upload;
      case "failed":
        return {
          ...base,
          stage: "failed",
          message: event.message,
          code: event.code,
          asset: "asset" in upload ? upload.asset : undefined,
        };
      default:
        return upload;
    }
  });
};

/** Whether the photo still needs an answer from CalmLens. */
export const isBusy = (upload: Upload) =>
  upload.stage === "uploading" || upload.stage === "checking";

/**
 * How the app treats the upload: shown to everyone, shown only to adults, refused, or not settled.
 * `limited` photos are shown, but your app keeps them out of recommendations.
 */
export const getOutcome = (
  upload: Upload,
):
  | "busy"
  | "shared"
  | "limited"
  | "age-restricted"
  | "refused"
  | "unknown"
  | "stalled"
  | "failed" => {
  switch (upload.stage) {
    case "uploading":
    case "checking":
      return "busy";
    case "stalled":
      return "stalled";
    case "failed":
      return "failed";
    case "decided":
      switch (upload.asset.status) {
        case "allowed":
          return "shared";
        case "limited":
          return "limited";
        case "age-restricted":
          return "age-restricted";
        case "blocked":
        case "purged":
          return "refused";
        default:
          return "unknown";
      }
  }
};

/**
 * Whether trying again should upload the photo again (the upload never finished) or check the
 * existing upload (it was uploaded, and a status check failed or timed out).
 */
export const getRetryKind = (upload: Upload): "upload" | "check" | undefined => {
  if (upload.stage === "stalled") return "check";
  if (upload.stage !== "failed") return undefined;
  return upload.asset ? "check" : "upload";
};
