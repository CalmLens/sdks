import {
  signUploadToken,
  UPLOAD_TOKEN_DEFAULT_TTL_SECONDS,
  UPLOAD_TOKEN_MAX_TTL_SECONDS,
  uploadTokenKeyPrefix,
} from "../contract/UploadToken.js";
import { invalidArgument } from "./CalmLensError";
import type { SignedUploadToken, SignUploadTokenOptions } from "./CalmLensTypes";
import { encodePathSegment } from "./CalmLensUtils";

/**
 * Signs a single-use upload token with `apiKey`, locally. `CalmLensServerClient` and
 * `MockCalmLensServerClient` share it so both check options the same way. `@calmlens/sdk/testing`
 * exports it as `signUploadToken`, whose fixed `now` (milliseconds since the epoch) and `nonce`
 * give the same token every time, for comparing with known tokens in tests.
 */
export const signUploadTokenWithApiKey = async (
  apiKey: string,
  options: SignUploadTokenOptions,
  { now = Date.now(), nonce = crypto.randomUUID() }: { now?: number; nonce?: string } = {},
): Promise<SignedUploadToken> => {
  if (!options || typeof options !== "object") throw invalidArgument("Options are required");
  const {
    uploadPresetId,
    externalId,
    expiresInSeconds = UPLOAD_TOKEN_DEFAULT_TTL_SECONDS,
  } = options;
  encodePathSegment(uploadPresetId, "Upload preset ID");
  if (
    !Number.isInteger(expiresInSeconds) ||
    expiresInSeconds < 1 ||
    expiresInSeconds > UPLOAD_TOKEN_MAX_TTL_SECONDS
  ) {
    throw invalidArgument(
      `expiresInSeconds must be a whole number from 1 to ${UPLOAD_TOKEN_MAX_TTL_SECONDS}`,
    );
  }
  if (externalId !== undefined && (typeof externalId !== "string" || !externalId)) {
    throw invalidArgument("externalId must be a non-empty string");
  }
  const expiresAt = now + expiresInSeconds * 1000;
  const token = await signUploadToken(
    {
      v: 1,
      u: uploadPresetId,
      k: uploadTokenKeyPrefix(apiKey),
      e: expiresAt,
      n: nonce,
      ...(externalId === undefined ? {} : { x: externalId }),
    },
    apiKey,
  );
  return { token, expiresAt };
};
