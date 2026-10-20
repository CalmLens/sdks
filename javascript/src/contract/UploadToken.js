import { n as sha256Hex, r as timingSafeEqual, t as hmacSha256Hex } from "./CryptoUtils-Cb7_Afa0.js";
//#region packages/shared/src/UploadToken.ts
const UPLOAD_TOKEN_PREFIX = "clut_";
const UPLOAD_TOKEN_DEFAULT_TTL_SECONDS = 600;
const UPLOAD_TOKEN_MAX_TTL_SECONDS = 3600;
const SIGNING_CONTEXT = "calmlens-upload-token:v1:";
const toBase64Url = (value) => btoa(String.fromCharCode(...new TextEncoder().encode(value))).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
const fromBase64Url = (value) => {
	const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/"));
	return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
};
/**
* The part of an API key a token names so the backend can find the key's hash. The same rule as
* the stored `keyPrefix`: the fixed `clsk_<region>_` part plus four random characters.
*/
const uploadTokenKeyPrefix = (apiKey) => apiKey.substring(0, apiKey.startsWith("clsk_") ? 13 : 8);
/** The signing secret: the SHA-256 of the API key, which the backend stores instead of the key. */
const signingSecret = (apiKey) => sha256Hex(apiKey);
/** Signs `claims` with `apiKey` and returns the token. */
const signUploadToken = async (claims, apiKey) => {
	const body = toBase64Url(JSON.stringify(claims));
	const signature = await hmacSha256Hex(await signingSecret(apiKey), SIGNING_CONTEXT + body);
	return `${UPLOAD_TOKEN_PREFIX}${body}.${signature}`;
};
/**
* Reads a token's claims without checking its signature, or returns undefined when it isn't
* well formed. Verify it with `verifyUploadTokenSignature` before trusting the claims.
*/
const decodeUploadToken = (token) => {
	if (!token.startsWith("clut_")) return void 0;
	const [body, signature, extra] = token.slice(5).split(".");
	if (!body || !signature || extra !== void 0 || !/^[0-9a-f]{64}$/.test(signature)) return;
	try {
		const claims = JSON.parse(fromBase64Url(body));
		if (claims.v !== 1 || typeof claims.u !== "string" || typeof claims.k !== "string" || typeof claims.e !== "number" || typeof claims.n !== "string" || claims.x !== void 0 && typeof claims.x !== "string") return;
		return {
			claims,
			body,
			signature
		};
	} catch {
		return;
	}
};
/** Whether `signature` signs `body` with the API key whose SHA-256 is `keyHash`. */
const verifyUploadTokenSignature = async (body, signature, keyHash) => timingSafeEqual(await hmacSha256Hex(keyHash, SIGNING_CONTEXT + body), signature);
//#endregion
export { UPLOAD_TOKEN_DEFAULT_TTL_SECONDS, UPLOAD_TOKEN_MAX_TTL_SECONDS, decodeUploadToken, signUploadToken, uploadTokenKeyPrefix, verifyUploadTokenSignature };
