// ../../../../private/tmp/calmlens-decision-contract/packages/shared/src/CryptoUtils.ts
const encoder = new TextEncoder();
/** Lowercase hex of `bytes`, two characters per byte. */
const bytesToHex = (bytes) => Array.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
/** SHA-256 of the UTF-8 encoding of `value`, as lowercase hex. */
const sha256Hex = async (value) => bytesToHex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
/** HMAC-SHA256 of `message` keyed with `secret` (both UTF-8 encoded), as lowercase hex. */
const hmacSha256Hex = async (secret, message) => {
	const key = await crypto.subtle.importKey("raw", encoder.encode(secret), {
		name: "HMAC",
		hash: "SHA-256"
	}, false, ["sign"]);
	return bytesToHex(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
};
/**
* Compares two strings without leaking, through timing, where they first differ. Strings of
* different lengths are unequal immediately (the length itself is not secret here).
*/
const timingSafeEqual = (a, b) => {
	if (a.length !== b.length) return false;
	let difference = 0;
	for (let index = 0; index < a.length; index++) difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
	return difference === 0;
};
export { sha256Hex as n, timingSafeEqual as r, hmacSha256Hex as t };
