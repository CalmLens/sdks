import { CALMLENS_ERROR_CODES, CalmLensError } from "@calmlens/sdk/app";
import type { UploadControllerOptions } from "@calmlens/sdk/react-native";
import { File } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import type { PickedPhoto } from "./uploads";

const uploadPresetId = process.env.EXPO_PUBLIC_CALMLENS_UPLOAD_PRESET_ID;
export const isConfigured = !!uploadPresetId;
const tokenServerUrl =
  process.env.EXPO_PUBLIC_TOKEN_SERVER_URL ?? "http://127.0.0.1:6411/upload-token";

/** This app's own error codes, for a token server it can't reach or that refuses. */
const TOKEN_SERVER_UNREACHABLE = "calmsnap/token-server-unreachable";
const TOKEN_SERVER_REFUSED = "calmsnap/token-server-refused";

/** Asks your server for a single-use upload token. The API key stays on the server. */
const fetchUploadToken = async (): Promise<string> => {
  let response: Response;
  try {
    response = await fetch(tokenServerUrl, { method: "POST" });
  } catch {
    throw new CalmLensError(TOKEN_SERVER_UNREACHABLE);
  }
  if (!response.ok) {
    throw new CalmLensError(TOKEN_SERVER_REFUSED, { status: response.status });
  }
  const { token } = (await response.json()) as { token: string };
  return token;
};

/**
 * The upload queue's settings. No API key here: each upload goes through the preset with a new
 * token, which its status checks reuse. Photos are checked after they're stored, so the queue
 * checks each one until CalmLens decides, for up to a minute.
 */
export const uploadOptions: UploadControllerOptions = {
  uploadPresetId,
  token: fetchUploadToken,
  // Only set for a local backend. Leave it unset to use https://api.calmlens.com/v1.
  baseUrl: process.env.EXPO_PUBLIC_CALMLENS_BASE_URL || undefined,
  accept: "image/*",
  // Keep every photo this session in the queue, for the Recent list.
  multiple: true,
  maxFiles: 50,
  decisionTimeoutMs: 60_000,
};

/**
 * Picks a photo from the library as a file the queue can upload. `expo-file-system` reads its
 * bytes when its upload starts.
 */
export const pickPhoto = async (): Promise<PickedPhoto | undefined> => {
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    // HEIC photos arrive as JPEG; JPEG and PNG files arrive unchanged.
    preferredAssetRepresentationMode:
      ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
    quality: 1,
  });
  if (result.canceled) return undefined;
  const picked = result.assets[0];
  const file = new File(picked.uri);
  const type = picked.mimeType ?? "image/jpeg";
  return {
    uri: picked.uri,
    type,
    name: picked.fileName ?? `photo.${type.split("/")[1] ?? "jpg"}`,
    size: picked.fileSize ?? file.size,
    width: picked.width,
    height: picked.height,
    pickedAt: Date.now(),
    arrayBuffer: () => file.arrayBuffer(),
  };
};

const MESSAGES: Record<string, string> = {
  [TOKEN_SERVER_UNREACHABLE]: `Couldn't reach the token server at ${tokenServerUrl}.`,
  [TOKEN_SERVER_REFUSED]: "The token server didn't return a token. Check its logs.",
  [CALMLENS_ERROR_CODES.UPLOAD_PRESET_NOT_FOUND]:
    "This app's upload preset doesn't exist. Check EXPO_PUBLIC_CALMLENS_UPLOAD_PRESET_ID.",
  [CALMLENS_ERROR_CODES.UPLOAD_PRESET_DISABLED]: "Uploads are paused right now. Try again later.",
  [CALMLENS_ERROR_CODES.UPLOAD_PRESET_TOKEN_REQUIRED]:
    "The upload preset requires a token, and none was sent.",
  [CALMLENS_ERROR_CODES.UPLOAD_PRESET_CONTENT_TYPE_NOT_ALLOWED]:
    "This type of file can't be uploaded here. Choose a photo.",
  [CALMLENS_ERROR_CODES.UPLOAD_PRESET_TOO_LARGE]: "This photo is too large. Choose a smaller one.",
  [CALMLENS_ERROR_CODES.UPLOAD_PRESET_DAILY_LIMIT_REACHED]:
    "Today's upload limit has been reached. Try again tomorrow.",
  [CALMLENS_ERROR_CODES.UPLOAD_PRESET_ORIGIN_NOT_ALLOWED]:
    "The upload preset only accepts uploads from listed websites. Apps send no website, so remove the preset's allowed sites.",
  [CALMLENS_ERROR_CODES.UPLOAD_PRESET_FIELD_NOT_ALLOWED]:
    "The upload set a field that the preset controls.",
  [CALMLENS_ERROR_CODES.UPLOAD_TOKEN_INVALID]:
    "The upload token was rejected. Check that the token server signs for this preset with a key from the same project.",
  [CALMLENS_ERROR_CODES.UPLOAD_TOKEN_EXPIRED]: "The upload took too long to start. Try again.",
  [CALMLENS_ERROR_CODES.UPLOAD_TOKEN_USED]:
    "This upload token was already used. Each upload needs a new one.",
  [CALMLENS_ERROR_CODES.TIMEOUT]:
    "CalmLens took too long to answer. Check your connection and try again.",
  [CALMLENS_ERROR_CODES.TRANSPORT_ERROR]: "Couldn't reach CalmLens. Check your connection.",
};

/** A message for the person using the app, for a failed upload's error code. */
export const describeError = (code: string | undefined): string =>
  (code && MESSAGES[code]) || "Something went wrong. Try again.";
