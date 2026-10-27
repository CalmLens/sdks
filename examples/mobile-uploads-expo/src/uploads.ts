import type { UploadFile, UploadItem } from "@calmlens/sdk/react-native";

/** A photo picked from the library, as the upload queue uploads it. */
export interface PickedPhoto extends UploadFile {
  uri: string;
  width: number;
  height: number;
  pickedAt: number;
}

/** The photo an upload in the queue is sending. */
export const photoOf = (upload: UploadItem) => upload.file as PickedPhoto;

/** Whether the photo still needs an answer from CalmLens. */
export const isBusy = (upload: UploadItem) =>
  upload.stage === "selected" ||
  upload.stage === "queued" ||
  upload.stage === "uploading" ||
  upload.stage === "checking";

/**
 * How the app treats the upload: shown to everyone, shown only to adults, refused, or not settled.
 * `limited` photos are shown, but your app keeps them out of recommendations. A photo still
 * `pending` once the queue stops checking is `stalled`, and `retry` checks it again.
 */
export const getOutcome = (
  upload: UploadItem,
):
  | "busy"
  | "shared"
  | "limited"
  | "age-restricted"
  | "refused"
  | "unknown"
  | "stalled"
  | "failed" => {
  if (upload.stage === "failed") return "failed";
  if (upload.stage !== "complete") return "busy";
  // `status` is the moderation status. It's missing only when the preset doesn't show
  // decisions to uploaders.
  switch (upload.status) {
    case "pending":
      return "stalled";
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
};
