const MAX_IMAGE_UPLOAD_BYTES = /* @__PURE__ */ (() => 20971520)();
const MIN_MULTIPART_IMAGE_UPLOAD_BYTES = /* @__PURE__ */ (() => 10485760)();
const MIN_MULTIPART_UPLOAD_PART_BYTES = /* @__PURE__ */ (() => 5242880)();
const REJECTED_UPLOAD_MIME_TYPE_SET = /* @__PURE__ */ new Set([
	"application/octet-stream",
	"multipart/form-data",
	"multipart/mixed",
	"multipart/alternative",
	"multipart/related",
	"multipart/signed",
	"multipart/encrypted"
]);
const normalizeUploadMimeType = (mimeType) => mimeType.toLowerCase().split(";")[0]?.trim() || mimeType.toLowerCase().trim();
const isRejectedUploadMimeType = (mimeType) => REJECTED_UPLOAD_MIME_TYPE_SET.has(normalizeUploadMimeType(mimeType));
const getRejectedUploadMimeTypeError = (mimeType) => `${normalizeUploadMimeType(mimeType)} is not a valid upload file type. Uploads must use a concrete file MIME type that CalmLens can store and process, such as image/png, image/jpeg, application/pdf, or text/plain.`;
const DOMAIN = "calmlens.com";
//#endregion
export { getRejectedUploadMimeTypeError as a, MIN_MULTIPART_UPLOAD_PART_BYTES as i, MAX_IMAGE_UPLOAD_BYTES as n, isRejectedUploadMimeType as o, MIN_MULTIPART_IMAGE_UPLOAD_BYTES as r, DOMAIN as t };
