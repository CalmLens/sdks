import {
  CALMLENS_ERROR_CODES,
  CalmLensAppClient,
  CalmLensError,
  type UploadedAsset,
} from "@calmlens/sdk/app";
import { File } from "expo-file-system";

const uploadPresetId = process.env.EXPO_PUBLIC_CALMLENS_UPLOAD_PRESET_ID;
export const isConfigured = !!uploadPresetId;
const tokenServerUrl =
  process.env.EXPO_PUBLIC_TOKEN_SERVER_URL ?? "http://127.0.0.1:6411/upload-token";

class TokenServerError extends Error {}

/** Asks your server for a single-use upload token. The API key stays on the server. */
const fetchUploadToken = async (): Promise<string> => {
  let response: Response;
  try {
    response = await fetch(tokenServerUrl, { method: "POST" });
  } catch {
    throw new TokenServerError(`Couldn't reach the token server at ${tokenServerUrl}.`);
  }
  if (!response.ok) {
    throw new TokenServerError(`The token server answered with HTTP ${response.status}.`);
  }
  const { token } = (await response.json()) as { token: string };
  return token;
};

// No API key here: the client uploads through the preset, with a new token for each upload.
const client = uploadPresetId
  ? new CalmLensAppClient({
      uploadPresetId,
      token: fetchUploadToken,
      // Only set for a local backend. Leave it unset to use https://api.calmlens.com/v1.
      baseUrl: process.env.EXPO_PUBLIC_CALMLENS_BASE_URL || undefined,
    })
  : undefined;

const requireClient = () => {
  if (!client) throw new Error("Set EXPO_PUBLIC_CALMLENS_UPLOAD_PRESET_ID (see the README).");
  return client;
};

export interface PickedPhoto {
  uri: string;
  name: string;
  type: string;
}

/** Uploads a photo straight from the phone and returns the upload with its status. */
export const uploadPhoto = async (photo: PickedPhoto): Promise<UploadedAsset> => {
  // Read the picked file's bytes. The SDK sends them as they are.
  const buffer = await new File(photo.uri).arrayBuffer();
  return requireClient().assets.moderate({
    name: photo.name,
    content: { buffer, type: photo.type },
  });
};

/** Checks an upload again. The client reuses the token the upload started with. */
export const checkUpload = (assetId: string): Promise<UploadedAsset> =>
  requireClient().assets.retrieve({ assetId });

const MESSAGES: Record<string, string> = {
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

/** A message for the person using the app, plus the error code for developers. */
export const describeError = (error: unknown): { message: string; code?: string } => {
  if (error instanceof TokenServerError) return { message: error.message };
  if (CalmLensError.isCalmLensError(error)) {
    return { message: MESSAGES[error.code] ?? error.message, code: error.code };
  }
  return { message: error instanceof Error ? error.message : String(error) };
};
