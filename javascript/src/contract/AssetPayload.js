// packages/shared/src/AssetPayload.ts
const uint8ArrayInputToNumbers = (value) => {
	if (Array.isArray(value)) return value;
	return Array.from(value);
};
const bufferInputToBytes = (value) => {
	if (value instanceof ArrayBuffer) return new Uint8Array(value);
	return Uint8Array.from(value);
};
const BASE64_PART_BOUNDARY_ERROR = "Invalid base64 part. For multipart uploads, split the original bytes first, then base64-encode each part. Do not split one full base64 string into substrings.";
const MULTIPART_PART_TOO_SMALL_ERROR = `Multipart upload parts must be at least 5MiB except the final part.`;
const getRawBase64 = (value) => {
	const markerIndex = value.indexOf(";base64,");
	if (markerIndex === -1) return value;
	return value.slice(markerIndex + 8);
};
const validateBase64PayloadString = (payload, options) => {
	const raw = getRawBase64(payload.base64).replace(/\s/g, "");
	if (options?.multipart && raw.length % 4 !== 0) return {
		ok: false,
		error: BASE64_PART_BOUNDARY_ERROR
	};
	return { ok: true };
};
const isReadableStream = (value) => typeof value === "object" && value !== null && "getReader" in value && typeof value.getReader === "function";
const assetToData = (payload) => {
	if ("plainText" in payload && payload.plainText !== void 0) return new TextEncoder().encode(payload.plainText);
	if ("data" in payload && payload.data) return payload.data;
	if ("buffer" in payload) {
		if (payload.buffer instanceof ArrayBuffer) return payload.buffer;
		return bufferInputToBytes(payload.buffer);
	}
	if (payload.uint8Array !== void 0) return Uint8Array.from(uint8ArrayInputToNumbers(payload.uint8Array));
	if (payload.base64 === void 0) throw new Error("Invalid asset payload");
	const raw = getRawBase64(payload.base64);
	if (typeof Buffer !== "undefined") return Uint8Array.from(Buffer.from(raw, "base64"));
	const binary = atob(raw);
	return Uint8Array.from(binary, (char) => char.charCodeAt(0));
};
const assetDataToUint8Array = async (data) => {
	if (data instanceof Response) return new Uint8Array(await data.arrayBuffer());
	if (isReadableStream(data)) return new Uint8Array(await new Response(data).arrayBuffer());
	if (data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
	if (data instanceof ArrayBuffer) return new Uint8Array(data);
	return data;
};
const getAssetPayloadByteLength = (payload) => {
	if ("plainText" in payload && payload.plainText !== void 0) return new TextEncoder().encode(payload.plainText).byteLength;
	if ("data" in payload && payload.data) {
		if (payload.data instanceof Blob) return payload.data.size;
		if (payload.data instanceof Response) {
			const contentLength = payload.data.headers.get("content-length");
			return contentLength ? Number(contentLength) : void 0;
		}
		return;
	}
	if ("buffer" in payload && payload.buffer) return payload.buffer.byteLength;
	if (payload.uint8Array !== void 0) {
		if (Array.isArray(payload.uint8Array)) return payload.uint8Array.length;
		return payload.uint8Array.byteLength;
	}
	if (payload.base64 === void 0) return;
	const raw = getRawBase64(payload.base64).replace(/\s/g, "");
	const padding = raw.endsWith("==") ? 2 : raw.endsWith("=") ? 1 : 0;
	return Math.max(0, Math.floor(raw.length * 3 / 4) - padding);
};
const validateAssetPayload = (payload, options) => {
	if ("base64" in payload && payload.base64 !== void 0) {
		const validation = validateBase64PayloadString(payload, options);
		if (!validation.ok) return {
			ok: false,
			error: validation.error
		};
	}
	const byteLength = getAssetPayloadByteLength(payload);
	if (options?.multipart && !options.isFinal && byteLength !== void 0 && byteLength < 5242880) return {
		ok: false,
		error: MULTIPART_PART_TOO_SMALL_ERROR
	};
	return { ok: true };
};
export { assetDataToUint8Array, assetToData, getAssetPayloadByteLength, validateAssetPayload };
