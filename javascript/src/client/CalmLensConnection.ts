import type { AssetBinaryPayloadInput } from "../contract/AssetPayload.js";
import {
  assetToData,
  getAssetPayloadByteLength,
  validateAssetPayload,
} from "../contract/AssetPayload.js";
import {
  DOMAIN,
  getRejectedUploadMimeTypeError,
  isRejectedUploadMimeType,
  MAX_IMAGE_UPLOAD_BYTES,
  MIN_MULTIPART_IMAGE_UPLOAD_BYTES,
} from "../contract/SharedConstants.js";
import { CalmLensError, invalidArgument, SDK_ERROR_CODES } from "./CalmLensError";
import { API_ERROR_CODES } from "./CalmLensErrorCodes";
import { CalmLensTransport, type TransportRequest } from "./CalmLensTransport";
import type {
  Asset,
  ConnectionOptions,
  CreateMultipartUploadPartOptions,
  MultipartUploadPartOptions,
  SubmitAssetOptions,
  UploadAssetPartOptions,
  UploadedAsset,
} from "./CalmLensTypes";
import { randomUuid, stringifyQuery } from "./CalmLensUtils";

// Requests, uploads and response checks that `CalmLensServerClient` and `CalmLensAppClient`
// share. Each client keeps one `CalmLensConnection` privately, so credentials stay hidden.

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_MAX_RESPONSE_BYTES = 32 * 1024 * 1024;

/**
 * Bytes as a fetch body. They're sent as they are rather than in a Blob: React Native can't
 * build a Blob from bytes, and every fetch accepts a Uint8Array.
 */
const toBodyBytes = (value: Uint8Array): Uint8Array<ArrayBuffer> =>
  value.buffer instanceof ArrayBuffer ? (value as Uint8Array<ArrayBuffer>) : Uint8Array.from(value);

const toRawUploadBody = (payload: AssetBinaryPayloadInput): BodyInit => {
  const data = assetToData(payload);
  if (data instanceof Response) {
    if (!data.body) {
      throw new CalmLensError(API_ERROR_CODES.INVALID_UPLOAD_PAYLOAD, {
        message: "Response upload data must have a body",
      });
    }
    return data.body;
  }
  if (data instanceof ArrayBuffer || data instanceof Blob) {
    return data;
  }
  if ("getReader" in data) {
    return data as ReadableStream<Uint8Array>;
  }
  return toBodyBytes(data);
};

const setOptionalQueryValue = (params: URLSearchParams, key: string, value: unknown) => {
  if (value !== undefined && value !== null) {
    params.set(key, typeof value === "string" ? value : JSON.stringify(value));
  }
};

const assertValidUploadMimeType = (mimeType: string) => {
  if (isRejectedUploadMimeType(mimeType)) {
    throw new CalmLensError(API_ERROR_CODES.INVALID_UPLOAD_MIME_TYPE, {
      message: getRejectedUploadMimeTypeError(mimeType),
      details: { mimeType },
    });
  }
};

const isImageMimeType = (mimeType: string) => mimeType.toLowerCase().startsWith("image/");

export const invalidPayload = (message: string) =>
  new CalmLensError(API_ERROR_CODES.INVALID_UPLOAD_PAYLOAD, { message });

export const assertDeclaredPayloadSize = (
  payload: AssetBinaryPayloadInput & { sizeInBytes?: number },
  declared = payload.sizeInBytes,
) => {
  if (declared === undefined) return;
  const data = "data" in payload ? payload.data : undefined;
  const measured =
    data instanceof ArrayBuffer || ArrayBuffer.isView(data)
      ? data.byteLength
      : getAssetPayloadByteLength(payload);
  if (
    !Number.isSafeInteger(declared) ||
    declared < 0 ||
    (measured !== undefined && measured !== declared)
  ) {
    throw invalidPayload("sizeInBytes must match the payload byte length");
  }
};

/** Checks upload options before anything is sent. */
export const prepareSubmitAssetOptions = (options: SubmitAssetOptions): SubmitAssetOptions => {
  if (!options || typeof options !== "object") {
    throw invalidArgument("Asset options are required");
  }
  if (!("content" in options) && !("url" in options) && !("part" in options)) {
    throw invalidPayload("Either file content, URL, or multipart part is required");
  }
  if (!options.name) {
    throw invalidPayload("Asset name is required");
  }
  if (!("part" in options) && "isFinal" in options) {
    throw invalidPayload("isFinal is only valid for multipart uploads");
  }
  if ("part" in options && options.part.partNumber && options.part.partNumber > 1) {
    throw new CalmLensError(API_ERROR_CODES.USE_UPLOAD_PART, {
      message: "Use uploadPart for multipart upload parts after the first part",
    });
  }
  if ("content" in options) {
    assertDeclaredPayloadSize(options.content);
    assertValidUploadMimeType(options.content.type);
    if (!("plainText" in options.content)) {
      const validation = validateAssetPayload(options.content);
      if (!validation.ok) throw invalidPayload(validation.error);
    }
  }
  if ("part" in options) {
    assertDeclaredPayloadSize(options.part, options.part.sizeInBytes ?? options.sizeInBytes);
    assertValidUploadMimeType(options.part.type);
    const partSizeInBytes = options.part.sizeInBytes ?? getAssetPayloadByteLength(options.part);
    if (isImageMimeType(options.part.type) && partSizeInBytes !== undefined) {
      if (partSizeInBytes > MAX_IMAGE_UPLOAD_BYTES) {
        throw new CalmLensError(API_ERROR_CODES.MULTIPART_IMAGE_TOO_LARGE, {
          message: "Multipart image uploads cannot exceed 20MB.",
        });
      }
      if (options.part.isFinal && partSizeInBytes < MIN_MULTIPART_IMAGE_UPLOAD_BYTES) {
        throw new CalmLensError(API_ERROR_CODES.MULTIPART_IMAGE_TOO_SMALL, {
          message: "Multipart image uploads must total at least 10MB.",
        });
      }
    }
    const validation = validateAssetPayload(options.part, {
      multipart: true,
      isFinal: options.part.isFinal,
    });
    if (!validation.ok) throw invalidPayload(validation.error);
  }

  return options;
};

export const newIdempotencyKey = (): string => randomUuid();

/** Text content is small, so it keeps the API deadline; binary files may be arbitrarily large. */
const isTextPayload = (payload: AssetBinaryPayloadInput) => "plainText" in payload;

const hasStringStatus = (value: unknown): boolean =>
  !!value &&
  typeof value === "object" &&
  typeof (value as { status?: unknown }).status === "string";

const isAsset = (data: unknown): data is Asset =>
  !!data &&
  typeof data === "object" &&
  typeof (data as { id?: unknown }).id === "string" &&
  !!(data as { id: string }).id &&
  hasStringStatus((data as { classification?: unknown }).classification) &&
  hasStringStatus((data as { upload?: unknown }).upload) &&
  typeof (data as Partial<Asset>).classification?.moderation?.status === "string";

const isUploadedAsset = (data: unknown): data is UploadedAsset =>
  !!data &&
  typeof data === "object" &&
  typeof (data as { id?: unknown }).id === "string" &&
  !!(data as { id: string }).id;

export const expectUploadedAsset = (data: unknown): UploadedAsset => {
  if (!isUploadedAsset(data)) {
    throw new CalmLensError(SDK_ERROR_CODES.INVALID_RESPONSE, {
      message: "Expected an uploaded asset response",
      status: 200,
    });
  }
  return data;
};

export const expectAsset = (data: unknown): Asset => {
  if (!isAsset(data)) {
    throw new CalmLensError(SDK_ERROR_CODES.INVALID_RESPONSE, {
      message: "Expected an asset response",
      status: 200,
    });
  }
  return data;
};

export type ResolvedConnectionOptions = Omit<ConnectionOptions, "baseUrl"> & { baseUrl: string };

/** Fills in the default API base URL and drops trailing slashes. */
export const resolveConnectionOptions = <T extends ConnectionOptions>(
  options: T,
): T & { baseUrl: string } => ({
  ...options,
  baseUrl: (options.baseUrl ?? `https://api.${DOMAIN}/v1`).replace(/\/+$/, ""),
});

/** One client's transport, base URL and deadlines, and the requests both clients make. */
export class CalmLensConnection {
  readonly transport: CalmLensTransport;

  constructor(
    readonly options: ResolvedConnectionOptions,
    apiKey?: string,
  ) {
    const resolveFetch = () => {
      const fetchImpl = this.options.fetch ?? globalThis.fetch;
      if (typeof fetchImpl !== "function") {
        throw new CalmLensError(SDK_ERROR_CODES.NO_FETCH, {
          message: "No fetch implementation is available; pass one as the fetch option",
        });
      }
      return fetchImpl;
    };
    this.transport = new CalmLensTransport({
      apiKey,
      fetch: ((input, init) => resolveFetch()(input, init)) as typeof fetch,
      signal: options.signal,
      maxRetries: options.maxRetries ?? DEFAULT_MAX_RETRIES,
      maxResponseBytes: options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
    });
  }

  get timeoutMs() {
    return this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  url(path: string, query?: Record<string, unknown>): string {
    const search = query ? stringifyQuery(query) : "";
    return `${this.options.baseUrl}${path}${search ? `?${search}` : ""}`;
  }

  /** A JSON request whose deadline covers reading the response. */
  json<T>(
    method: TransportRequest["method"],
    path: string,
    {
      query,
      body,
      headers,
      idempotencyKey,
    }: {
      query?: Record<string, unknown>;
      body?: unknown;
      headers?: Record<string, string>;
      idempotencyKey?: string;
    } = {},
  ): Promise<T> {
    return this.transport.json<T>({
      method,
      url: this.url(path, query),
      headers: body === undefined ? headers : { ...headers, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      idempotencyKey,
      timeoutMs: this.timeoutMs,
      deadline: "body",
    });
  }

  private upload(
    url: string,
    payload: AssetBinaryPayloadInput,
    headers: Record<string, string>,
    idempotencyKey: string,
  ): Promise<unknown> {
    return this.transport.json<unknown>({
      method: "POST",
      url,
      headers,
      body: toRawUploadBody(payload),
      idempotencyKey,
      timeoutMs: isTextPayload(payload) ? this.timeoutMs : this.options.uploadTimeoutMs,
      deadline: "body",
      fetch: this.options.uploadFetch,
    });
  }

  /**
   * Uploads file content or a first multipart part to `uploadsPath` (`.../assets`), as raw
   * bytes with the options in the query.
   */
  submitRawUpload(
    uploadsPath: string,
    options: Exclude<SubmitAssetOptions, { url: string }>,
    queue: boolean,
    authHeaders: Record<string, string> = {},
  ): Promise<unknown> {
    const query = new URLSearchParams();
    query.set("name", options.name);
    query.set("queue", String(queue));
    setOptionalQueryValue(query, "description", options.description);
    setOptionalQueryValue(query, "processingOptions", options.processingOptions);
    setOptionalQueryValue(query, "visibility", options.visibility);
    setOptionalQueryValue(query, "metadata", options.metadata);
    setOptionalQueryValue(query, "externalId", options.externalId);
    setOptionalQueryValue(query, "externalUrl", options.externalUrl);
    setOptionalQueryValue(query, "folderId", options.folderId);
    setOptionalQueryValue(query, "uploadPresetId", options.uploadPresetId);

    const isMultipart = "part" in options;
    const payload = isMultipart ? options.part : options.content;
    query.set("contentType", payload.type);
    setOptionalQueryValue(
      query,
      "sizeInBytes",
      payload.sizeInBytes ?? getAssetPayloadByteLength(payload),
    );
    if (isMultipart) {
      const part = payload as CreateMultipartUploadPartOptions;
      const multipartOptions = options as Extract<
        SubmitAssetOptions,
        { part: CreateMultipartUploadPartOptions }
      >;
      query.set("partNumber", String(part.partNumber ?? 1));
      query.set("isFinal", String(part.isFinal ?? false));
      setOptionalQueryValue(query, "sizeInBytes", part.sizeInBytes ?? multipartOptions.sizeInBytes);
      setOptionalQueryValue(query, "totalSizeInBytes", multipartOptions.totalSizeInBytes);
    }

    return this.upload(
      this.url(`${uploadsPath}?${query}`),
      payload,
      {
        ...authHeaders,
        "Content-Type": payload.type,
        "X-CalmLens-Upload": isMultipart ? "part" : "content",
      },
      options.idempotencyKey ?? newIdempotencyKey(),
    );
  }

  /** Uploads the next part of a multipart upload to `partPath` (`.../assets/{id}/part`). */
  uploadPart(
    partPath: string,
    { part, queue, idempotencyKey }: Omit<UploadAssetPartOptions, "assetId">,
    authHeaders: Record<string, string> = {},
  ): Promise<unknown> {
    if (!part) throw invalidArgument("Part options are required");
    assertDeclaredPayloadSize(part);
    const validation = validateAssetPayload(part, {
      multipart: true,
      isFinal: part.isFinal,
    });
    if (!validation.ok) throw invalidPayload(validation.error);
    const query = new URLSearchParams({
      partNumber: String(part.partNumber),
      isFinal: String(part.isFinal ?? false),
    });
    if (queue !== undefined) query.set("queue", String(queue));
    setOptionalQueryValue(
      query,
      "sizeInBytes",
      part.sizeInBytes ?? getAssetPayloadByteLength(part as MultipartUploadPartOptions),
    );
    return this.upload(
      this.url(`${partPath}?${query}`),
      part,
      { ...authHeaders, "X-CalmLens-Upload": "part" },
      idempotencyKey ?? newIdempotencyKey(),
    );
  }
}
