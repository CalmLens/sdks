//#region packages/shared/src/UploadToken.d.ts
export declare const UPLOAD_TOKEN_DEFAULT_TTL_SECONDS = 600;
export declare const UPLOAD_TOKEN_MAX_TTL_SECONDS = 3600;
/** What a token grants: one upload through one preset, until it expires. */
interface UploadTokenClaims {
  /** Format version. */
  v: 1;
  /** Upload preset ID. */
  u: string;
  /** Prefix of the API key that signed the token, to find its hash. */
  k: string;
  /** Expiry, in milliseconds since the Unix epoch. */
  e: number;
  /** Random ID that makes the token single-use. */
  n: string;
  /** External ID the uploaded asset gets, when the server chose one. */
  x?: string;
}
/**
 * The part of an API key a token names so the backend can find the key's hash. The same rule as
 * the stored `keyPrefix`: the fixed `clsk_<region>_` part plus four random characters.
 */
export declare const uploadTokenKeyPrefix: (apiKey: string) => string;
/** Signs `claims` with `apiKey` and returns the token. */
export declare const signUploadToken: (claims: UploadTokenClaims, apiKey: string) => Promise<string>;
/**
 * Reads a token's claims without checking its signature, or returns undefined when it isn't
 * well formed. Verify it with `verifyUploadTokenSignature` before trusting the claims.
 */
export declare const decodeUploadToken: (token: string) => {
  claims: UploadTokenClaims;
  body: string;
  signature: string;
} | undefined;
/** Whether `signature` signs `body` with the API key whose SHA-256 is `keyHash`. */
export declare const verifyUploadTokenSignature: (body: string, signature: string, keyHash: string) => Promise<boolean>;
//#endregion
export {};