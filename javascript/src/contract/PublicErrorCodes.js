// node_modules/sendable-error/esm/Consts.js
const SENDABLE_ERROR_INSTANCE_SYMBOL = "__isSendableError";
// node_modules/sendable-error/esm/Utils.js
const isSendableError = (error) => {
	if (!error || typeof error !== "object") return false;
	return Boolean(error[SENDABLE_ERROR_INSTANCE_SYMBOL]);
};
// node_modules/sendable-error/esm/ErrorCode.js
var ErrorCode = class ErrorCode {
	properties;
	static DEFAULT_CODE = new ErrorCode({
		id: "misc/internal-error",
		defaultMessage: "An internal error occurred"
	});
	prefix;
	constructor(properties) {
		this.properties = properties;
		if (properties.id.split("/").length !== 2) console.error(`[sendable-error] Invalid error code '${properties.id}' provided, must be of form 'prefix/descriptive-name'`);
		this.prefix = properties.id.split("/")[0];
	}
	getDefaultMessage() {
		return this.properties.defaultMessage;
	}
	getId() {
		return this.properties.id;
	}
	/**
	* Does this error have this code?
	*/
	is(error) {
		if (isSendableError(error)) return error.getCode().getId() === this.getId();
		return false;
	}
	/**
	* Extends an existing error code
	*/
	extend(properties) {
		const code = new ErrorCode(properties);
		if (code.prefix !== this.prefix) console.error("[sendable-error] Extension doesn't share same prefix, this doesn't seem right", {
			originalPrefix: this.prefix,
			newPrefix: code.prefix
		});
		return code;
	}
	static get(error) {
		return isSendableError(error) ? error.getCode() : ErrorCode.DEFAULT_CODE;
	}
	getStatus() {
		return this.properties.status;
	}
	toString() {
		return this.getId();
	}
};
// node_modules/sendable-error/esm/Logging.js
const defaultErrorLogger = (options) => {
	const { message, error, info } = options;
	const stackLines = error.stack?.split("\n").slice(1).join("\n");
	console.error(`SendableError - ${message} ${JSON.stringify(info || {})}${stackLines ? `\n${stackLines}` : ""}`);
	const cause = error.cause;
	if (cause && cause instanceof Error) defaultErrorLogger({
		...options,
		message: `Caused by: ${cause.message}`,
		error: cause,
		errorInfo: {}
	});
};
let currentLogger = defaultErrorLogger;
const getErrorLogger = () => {
	return currentLogger;
};
// node_modules/sendable-error/esm/SendableError.js
const DEFAULT_STATUS = 500;
function hashString(str) {
	let h = 2166136261;
	for (let i = 0; i < str.length; i++) {
		h ^= str.charCodeAt(i);
		h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
	}
	return h >>> 0;
}
/**
* Transforms an error into a deterministic error identifier to enable easy log searching
*/
const getTraceId = (error) => {
	const bytes = new Array(16).fill(0).map((_, i) => {
		return hashString(`${error.stack}${i}`) & 255;
	});
	bytes[6] = bytes[6] & 15 | 64;
	bytes[8] = bytes[8] & 63 | 128;
	return [...bytes].map((b, i) => {
		const s = b.toString(16).padStart(2, "0");
		return [
			4,
			6,
			8,
			10
		].includes(i) ? `-${s}` : s;
	}).join("");
};
const DEFAULT_PROPERTIES = { code: ErrorCode.DEFAULT_CODE };
const resolveCode = (code) => {
	if (code instanceof ErrorCode) return code;
	if (typeof code === "string") return new ErrorCode({
		id: code,
		defaultMessage: code
	});
	return ErrorCode.DEFAULT_CODE;
};
const resolvePublic = (publicOptions) => {
	if (publicOptions === void 0) return;
	if (typeof publicOptions === "boolean") return { enabled: publicOptions };
	return {
		...publicOptions,
		code: publicOptions?.code ? resolveCode(publicOptions.code) : void 0
	};
};
const CONSTRUCTOR_MESSAGE = "__$$sendable-error-message__";
Object.defineProperty(class SendableError extends Error {
	[SENDABLE_ERROR_INSTANCE_SYMBOL] = true;
	properties;
	state;
	static is(error) {
		return isSendableError(error);
	}
	static of(error, options) {
		let result;
		let resolvedOptions = options ?? {};
		if (isSendableError(error)) {
			result = error;
			if (resolvedOptions?.code && !resolvedOptions?.message) resolvedOptions = {
				message: resolveCode(resolvedOptions.code).getDefaultMessage(),
				...resolvedOptions
			};
		} else if (error instanceof Error) {
			const copiedError = new Error(error.message);
			copiedError.stack = error.stack;
			Object.setPrototypeOf(copiedError, SendableError.prototype);
			result = copiedError;
			resolvedOptions = {
				code: ErrorCode.DEFAULT_CODE,
				message: error.message,
				cause: error.cause,
				...resolvedOptions
			};
		} else {
			const sendableError = new SendableError({
				...resolvedOptions,
				message: typeof error === "string" ? error : typeof error?.message === "string" ? error.message : JSON.stringify(error)
			});
			Object.defineProperty(sendableError, "stack", { get: () => void 0 });
			return sendableError;
		}
		result.init(resolvedOptions);
		return result;
	}
	constructor(options) {
		super(CONSTRUCTOR_MESSAGE);
		this.init(options);
	}
	overrideProperty(name, value) {
		if (Object.getOwnPropertyDescriptor(this, name)?.configurable === false) try {
			this[name] = value;
		} catch {}
		else Object.defineProperty(this, name, {
			value,
			configurable: true
		});
	}
	init(options) {
		let resolvedPublic;
		if (typeof options?.public !== "undefined") resolvedPublic = resolvePublic(options.public);
		if (!this.properties) {
			const code = resolveCode(options?.code);
			let message = options?.message;
			if (!message) message = code.getDefaultMessage();
			this.properties = {
				...DEFAULT_PROPERTIES,
				...options,
				public: resolvedPublic,
				message,
				code
			};
		} else {
			Object.assign(this.properties, options);
			if (resolvedPublic !== void 0) this.properties.public = resolvedPublic;
		}
		this.state = {
			logged: false,
			traceId: getTraceId(this)
		};
		this.overrideProperty("code", this.getCode());
		this.overrideProperty("message", this.getMessage());
		this.overrideProperty("cause", this.getCause());
		this.overrideProperty("stack", this.getStack());
		this[SENDABLE_ERROR_INSTANCE_SYMBOL] = true;
	}
	getStack() {
		return this.stack?.replace(CONSTRUCTOR_MESSAGE, this.getMessage());
	}
	getCause() {
		return this.properties.cause;
	}
	getCode() {
		return this.properties.code || ErrorCode.DEFAULT_CODE;
	}
	getMessage() {
		return this.properties.message || this.getCode().getDefaultMessage() || "An unknown error occurred";
	}
	isPublic() {
		return Boolean(this.properties.public?.enabled);
	}
	toResponse(options) {
		const response = Response.json(this.toResponseBody(options), { status: this.getStatus() });
		response.cause = this;
		return response;
	}
	toResponseBody(options) {
		const responsePublic = resolvePublic(options?.public) ?? this.properties.public ?? resolvePublic(options?.defaultPublic);
		const isPublic = responsePublic?.enabled;
		return {
			code: isPublic ? (responsePublic?.code ?? this.getCode()).getId() : ErrorCode.DEFAULT_CODE.getId(),
			message: isPublic ? responsePublic?.message ?? this.message : ErrorCode.DEFAULT_CODE.getDefaultMessage(),
			traceId: this.state.traceId,
			details: {
				...isPublic && this.properties.details,
				...options?.details
			}
		};
	}
	getStatus() {
		return this.properties.status ?? this.getCode().getStatus() ?? DEFAULT_STATUS;
	}
	getDetails() {
		return this.properties.details;
	}
	get details() {
		return this.properties.details;
	}
	getTraceId() {
		return this.state.traceId;
	}
	/**
	* Sends the error (if a response wasn't already sent) & logs if it wasn't already logged
	*/
	send(res, options) {
		this.logIfUnlogged();
		res.cause = this;
		if (!res.headersSent) {
			if (typeof res.status === "function") res.status(this.getStatus());
			res.send(this.toResponseBody(options));
		}
		return this;
	}
	logIfUnlogged(options) {
		if (!this.state.logged) this.log(options);
	}
	/**
	* Log out info on error
	*/
	log(options) {
		this.state.logged = true;
		/**const computedOptions = {
		...this.computedOptions,
		...(options || {}),
		};**/
		const traceId = this.getTraceId();
		const loggedMessage = options?.message || this.getMessage();
		const providedInfo = Object.assign({}, this.properties.details, options?.info);
		const errorInfo = {
			traceId,
			code: this.getCode().getId()
		};
		const computedInfo = Object.assign({}, errorInfo, providedInfo);
		getErrorLogger()({
			message: loggedMessage,
			error: this,
			info: computedInfo,
			errorInfo,
			providedInfo
		});
		return this;
	}
}, "name", { value: "SendableError" });
ErrorCode.DEFAULT_CODE;
// packages/shared/src/PublicErrorCodes.ts
const PUBLIC_ERROR_CODES = {
	INVALID_CURSOR: new ErrorCode({
		id: "validation/invalid-cursor",
		defaultMessage: "The cursor is invalid or belongs to a different query.",
		status: 400
	}),
	MISSING_TOKEN: new ErrorCode({
		id: "auth/missing-token",
		defaultMessage: "Authentication required. Send your project API key in the X-Api-Key header.",
		status: 401
	}),
	INVALID_API_KEY: new ErrorCode({
		id: "auth/invalid-api-key",
		defaultMessage: "The API key is invalid, revoked or expired. Create a key under Developer → API Keys.",
		status: 401
	}),
	API_KEY_PROJECT_MISMATCH: new ErrorCode({
		id: "auth/project-mismatch",
		defaultMessage: "This API key belongs to a different project. Use a key created for the project that owns this resource.",
		status: 403
	}),
	API_KEY_NOT_ACCEPTED: new ErrorCode({
		id: "auth/api-key-not-accepted",
		defaultMessage: "API keys are only accepted by the public API at /v1.",
		status: 403
	}),
	PERMISSION_DENIED: new ErrorCode({
		id: "auth/permission-denied",
		defaultMessage: "This API key lacks a permission the request needs, such as assets:delete for an asset's folder, or the resource belongs to another project.",
		status: 403
	}),
	FILE_TOO_LARGE: new ErrorCode({
		id: "upload/file-too-large",
		defaultMessage: "File size exceeds limit. Maximum direct image size is 10MB, audio/video size is 50MiB, and other files is 5GB.",
		status: 400
	}),
	IMAGE_REQUIRES_MULTIPART_UPLOAD: new ErrorCode({
		id: "upload/image-requires-multipart-upload",
		defaultMessage: "Images of 10MB or more must use a multipart upload.",
		status: 400
	}),
	MULTIPART_IMAGE_TOO_SMALL: new ErrorCode({
		id: "upload/multipart-image-too-small",
		defaultMessage: "Multipart image uploads must total at least 10MB.",
		status: 400
	}),
	MULTIPART_IMAGE_TOO_LARGE: new ErrorCode({
		id: "upload/multipart-image-too-large",
		defaultMessage: "Multipart image uploads cannot exceed 20MB.",
		status: 400
	}),
	IMAGE_EXCEEDED_MAX_DIMENSIONS: new ErrorCode({
		id: "upload/image-exceeded-max-dimensions",
		defaultMessage: "Image exceeds maximum dimensions. Maximum dimensions are 12,000px.",
		status: 400
	}),
	UPLOAD_LIMIT_EXCEEDED: new ErrorCode({
		id: "upload/limit-exceeded",
		defaultMessage: "Upload limit exceeded. This project's organisation has used its free uploads. Set up billing to continue uploading.",
		status: 403
	}),
	SPEND_LIMIT_REACHED: new ErrorCode({
		id: "upload/spend-limit-reached",
		defaultMessage: "Uploads to this project are paused by its organisation's usage limits. See details.reason; an owner can review them in Billing.",
		status: 402
	}),
	INVALID_UPLOAD_MIME_TYPE: new ErrorCode({
		id: "upload/invalid-mime-type",
		defaultMessage: "Upload file type is not supported. Uploads must use a concrete file MIME type that CalmLens can store and process, such as image/png, image/jpeg, application/pdf, or text/plain.",
		status: 400
	}),
	INVALID_EVENT_CURSOR: new ErrorCode({
		id: "events/invalid-cursor",
		defaultMessage: "The events cursor is invalid. Use the cursor from a previous response, or omit it to start from now.",
		status: 400
	}),
	INVALID_UPLOAD_PAYLOAD: new ErrorCode({
		id: "upload/invalid-payload",
		defaultMessage: "Upload payload is invalid.",
		status: 400
	}),
	USE_UPLOAD_PART: new ErrorCode({
		id: "upload/use-upload-part",
		defaultMessage: "Use uploadPart for multipart upload parts after the first part",
		status: 409
	}),
	UPLOAD_NOT_OPEN: new ErrorCode({
		id: "upload/not-open",
		defaultMessage: "Asset is not accepting additional parts",
		status: 409
	}),
	INVALID_UPLOAD_PART_NUMBER: new ErrorCode({
		id: "upload/invalid-part-number",
		defaultMessage: "Multipart upload part number is invalid.",
		status: 409
	}),
	UPLOAD_MISSING: new ErrorCode({
		id: "upload/missing",
		defaultMessage: "Multipart upload state is missing",
		status: 409
	}),
	UPLOAD_SIZE_MISMATCH: new ErrorCode({
		id: "upload/size-mismatch",
		defaultMessage: "The uploaded parts do not add up to the totalSizeInBytes declared when the multipart upload started.",
		status: 400
	}),
	INVALID_IDEMPOTENCY_KEY: new ErrorCode({
		id: "idempotency/invalid-key",
		defaultMessage: "The Idempotency-Key header must be 1 to 255 printable ASCII characters, such as a UUID.",
		status: 400
	}),
	IDEMPOTENCY_KEY_REUSED: new ErrorCode({
		id: "idempotency/key-reused",
		defaultMessage: "This Idempotency-Key was already used for a different request. Use a new key for each distinct request.",
		status: 409
	}),
	IDEMPOTENT_REQUEST_IN_PROGRESS: new ErrorCode({
		id: "idempotency/request-in-progress",
		defaultMessage: "A request with this Idempotency-Key is still being processed. Retry after the Retry-After delay to receive its result.",
		status: 409
	}),
	ASSET_NOT_FOUND: new ErrorCode({
		id: "asset/not-found",
		defaultMessage: "Asset not found",
		status: 404
	}),
	PROJECT_NOT_FOUND: new ErrorCode({
		id: "project/not-found",
		defaultMessage: "Project not found",
		status: 404
	}),
	ASSET_REVIEW_CHANGED: new ErrorCode({
		id: "asset/review-changed",
		defaultMessage: "The asset changed during review. Refresh and review the current decision.",
		status: 409
	}),
	ASSET_REVIEW_NOTE_REQUIRED: new ErrorCode({
		id: "asset/review-note-required",
		defaultMessage: "A note is required when changing the decision.",
		status: 400
	}),
	ASSET_UPDATE_FAILED: new ErrorCode({
		id: "asset/update-failed",
		defaultMessage: "Failed to update asset",
		status: 500
	}),
	ASSET_SAFETY_HELD: new ErrorCode({
		id: "asset/safety-held",
		defaultMessage: "Asset access is restricted by a safety hold.",
		status: 423
	}),
	ASSET_NOT_RETRYABLE: new ErrorCode({
		id: "asset/not-retryable",
		defaultMessage: "Only assets that failed to process (status error) can be retried.",
		status: 409
	}),
	ASSET_CONTENT_UNAVAILABLE: new ErrorCode({
		id: "asset/content-unavailable",
		defaultMessage: "This asset's content is no longer stored, so it can't be processed again. Upload it again instead.",
		status: 409
	}),
	ASSET_NOT_DECIDED: new ErrorCode({
		id: "asset/not-decided",
		defaultMessage: "This asset has no automatic moderation decision to explain yet.",
		status: 409
	}),
	ASSET_POLICY_CHANGED: new ErrorCode({
		id: "asset/policy-changed",
		defaultMessage: "The project's moderation policy has changed since this decision, so it can't be explained as made. Re-run moderation with the current policy instead.",
		status: 409
	}),
	ASSET_REVIEWED: new ErrorCode({
		id: "asset/reviewed",
		defaultMessage: "A reviewer has decided this asset, so its moderation can't be re-run.",
		status: 409
	}),
	SUPPORT_TICKET_NOT_FOUND: new ErrorCode({
		id: "support/ticket-not-found",
		defaultMessage: "Support ticket not found.",
		status: 404
	}),
	DUPLICATE_EXTERNAL_ID: new ErrorCode({
		id: "asset/duplicate-external-id",
		defaultMessage: "An asset with this externalId already exists in the project.",
		status: 409
	}),
	FOLDER_NOT_FOUND: new ErrorCode({
		id: "folder/not-found",
		defaultMessage: "Folder not found",
		status: 404
	}),
	DUPLICATE_FOLDER_NAME: new ErrorCode({
		id: "folder/duplicate-name",
		defaultMessage: "A folder with this name already exists in this location.",
		status: 409
	}),
	FOLDER_NOT_EMPTY: new ErrorCode({
		id: "folder/not-empty",
		defaultMessage: "Folder must be empty before it can be deleted.",
		status: 409
	}),
	FOLDER_PARENT_CYCLE: new ErrorCode({
		id: "folder/parent-cycle",
		defaultMessage: "A folder cannot be moved inside itself or one of its descendants.",
		status: 409
	}),
	LENS_VERSION_CONFLICT: new ErrorCode({
		id: "lens/version-conflict",
		defaultMessage: "Lens updates require a version greater than the current version.",
		status: 409
	}),
	HASH_LIST_NOT_FOUND: new ErrorCode({
		id: "hash-list/not-found",
		defaultMessage: "Hash list not found. Check the list ID in the portal.",
		status: 404
	}),
	HASH_LIST_ENTRY_NOT_FOUND: new ErrorCode({
		id: "hash-list/entry-not-found",
		defaultMessage: "Hash list entry not found.",
		status: 404
	}),
	HASH_LIST_LIMIT_REACHED: new ErrorCode({
		id: "hash-list/limit-reached",
		defaultMessage: "This project has the most hash lists it can hold. Delete a list to add another.",
		status: 409
	}),
	HASH_LIST_ENTRY_LIMIT_REACHED: new ErrorCode({
		id: "hash-list/entry-limit-reached",
		defaultMessage: "This project's hash lists hold the most entries they can. Remove entries to add more.",
		status: 409
	}),
	HASH_LIST_ASSET_NOT_HASHED: new ErrorCode({
		id: "hash-list/asset-not-hashed",
		defaultMessage: "This asset has no perceptual hash. Only image assets that finished processing can be added.",
		status: 409
	}),
	UPLOAD_PRESET_NOT_FOUND: new ErrorCode({
		id: "upload-preset/not-found",
		defaultMessage: "Upload preset not found. Check the preset ID in the portal.",
		status: 404
	}),
	UPLOAD_PRESET_DISABLED: new ErrorCode({
		id: "upload-preset/disabled",
		defaultMessage: "This upload preset is paused. Turn it on in the portal to accept uploads.",
		status: 403
	}),
	UPLOAD_PRESET_TOKEN_REQUIRED: new ErrorCode({
		id: "upload-preset/token-required",
		defaultMessage: "This upload preset only accepts uploads with an upload token. Sign one on your server with uploadTokens.sign and pass it to the client.",
		status: 401
	}),
	REMOTE_URL_NOT_ALLOWED: new ErrorCode({
		id: "upload/remote-url-not-allowed",
		defaultMessage: "This project doesn't accept URLs from this domain. Change the allowed or blocked domains under Project settings.",
		status: 403
	}),
	WEBSITE_RATE_LIMIT_EXCEEDED: new ErrorCode({
		id: "upload/website-rate-limit-exceeded",
		defaultMessage: "This project has submitted too many websites in the last minute. Wait for the Retry-After period, or lower the pace of submissions.",
		status: 429
	}),
	UPLOAD_PRESET_CONTENT_TYPE_NOT_ALLOWED: new ErrorCode({
		id: "upload-preset/content-type-not-allowed",
		defaultMessage: "This upload preset doesn't accept this file type.",
		status: 415
	}),
	UPLOAD_PRESET_TOO_LARGE: new ErrorCode({
		id: "upload-preset/too-large",
		defaultMessage: "This file is larger than the upload preset allows.",
		status: 413
	}),
	UPLOAD_PRESET_DAILY_LIMIT_REACHED: new ErrorCode({
		id: "upload-preset/daily-limit-reached",
		defaultMessage: "You have reached this upload preset's daily upload limit. Try again after midnight UTC.",
		status: 429
	}),
	UPLOAD_PRESET_ORIGIN_NOT_ALLOWED: new ErrorCode({
		id: "upload-preset/origin-not-allowed",
		defaultMessage: "This site isn't allowed to upload through this upload preset.",
		status: 403
	}),
	UPLOAD_PRESET_FIELD_NOT_ALLOWED: new ErrorCode({
		id: "upload-preset/field-not-allowed",
		defaultMessage: "This field is set by the upload preset or the upload token and can't be changed by the upload.",
		status: 400
	}),
	UPLOAD_TOKEN_INVALID: new ErrorCode({
		id: "upload-token/invalid",
		defaultMessage: "The upload token is invalid. Sign a new one on your server with an active API key for this project.",
		status: 401
	}),
	UPLOAD_TOKEN_EXPIRED: new ErrorCode({
		id: "upload-token/expired",
		defaultMessage: "The upload token has expired. Sign a new one on your server.",
		status: 401
	}),
	UPLOAD_TOKEN_USED: new ErrorCode({
		id: "upload-token/used",
		defaultMessage: "The upload token has already been used. Each token uploads one asset.",
		status: 409
	}),
	INVALID_REMOTE_URL: new ErrorCode({
		id: "asset/invalid-remote-url",
		defaultMessage: "Remote URLs must use HTTP or HTTPS and cannot target private networks, localhost names or URL credentials.",
		status: 400
	}),
	REMOTE_URL_UNAVAILABLE: new ErrorCode({
		id: "asset/remote-url-unavailable",
		defaultMessage: "The URL responded with an error status. Check that it is publicly reachable.",
		status: 422
	}),
	APPEAL_NOT_FOUND: new ErrorCode({
		id: "appeal/not-found",
		defaultMessage: "The appeal does not exist in this project.",
		status: 404
	}),
	APPEAL_JUDGMENT_NOT_FOUND: new ErrorCode({
		id: "appeal/judgment-not-found",
		defaultMessage: "The judgment event is unavailable, belongs to another project or cannot supply an asset decision. Supply explicit context instead.",
		status: 404
	}),
	APPEAL_ASSET_NOT_FOUND: new ErrorCode({
		id: "appeal/asset-not-found",
		defaultMessage: "The linked asset does not exist in this project.",
		status: 404
	}),
	APPEAL_PERMISSION_DENIED: new ErrorCode({
		id: "appeal/permission-denied",
		defaultMessage: "You cannot review this project's appeals.",
		status: 403
	}),
	APPEAL_ALREADY_REVIEWED: new ErrorCode({
		id: "appeal/already-reviewed",
		defaultMessage: "A reviewer already resolved this appeal.",
		status: 409
	}),
	APPEAL_DECISION_CHANGED: new ErrorCode({
		id: "appeal/decision-changed",
		defaultMessage: "The linked asset's decision changed after the appealed decision. Submit a new appeal for the current decision.",
		status: 409
	}),
	APPEAL_INVALID_ACTION: new ErrorCode({
		id: "appeal/invalid-action",
		defaultMessage: "The decision's action is not valid for this appeal.",
		status: 400
	}),
	APPEAL_SAFETY_HELD: new ErrorCode({
		id: "appeal/safety-held",
		defaultMessage: "A safety hold prevents this appeal from being submitted or applied.",
		status: 409
	}),
	APPEAL_CONTENT_UNAVAILABLE: new ErrorCode({
		id: "appeal/content-unavailable",
		defaultMessage: "The appeal's content is unavailable, or approval would require restoring removed content.",
		status: 409
	})
};
PUBLIC_ERROR_CODES.MISSING_TOKEN, PUBLIC_ERROR_CODES.INVALID_API_KEY, PUBLIC_ERROR_CODES.API_KEY_PROJECT_MISMATCH;
export { PUBLIC_ERROR_CODES };
