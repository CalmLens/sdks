import type { AssetBinaryPayloadInput } from "../contract/AssetPayload.js";
import {
  assetToData,
  getAssetPayloadByteLength,
  validateAssetPayload,
} from "../contract/AssetPayload.js";
import { MAX_LONG_MEDIA_UPLOAD_BYTES, MAX_MEDIA_UPLOAD_BYTES } from "../contract/Media.js";
import { selectModerationContextItems } from "../contract/ModerationContextLimits.js";
import {
  DOMAIN,
  getRejectedUploadMimeTypeError,
  MAX_DIRECT_IMAGE_UPLOAD_BYTES,
  MAX_IMAGE_UPLOAD_BYTES,
  MAX_NON_IMAGE_UPLOAD_BYTES,
} from "../contract/SharedConstants.js";
import { CalmLensError, invalidArgument, SDK_ERROR_CODES } from "./CalmLensError";
import { API_ERROR_CODES } from "./CalmLensErrorCodes";
import { CalmLensTransport, sleep, type TransportRequest } from "./CalmLensTransport";
import type {
  Asset,
  ConnectionOptions,
  CreateMultipartUploadPartOptions,
  MultipartUploadPartOptions,
  SubmitAssetOptions,
  UploadAssetPartOptions,
  UploadedAsset,
} from "./CalmLensTypes";
import { isAcceptedUploadMimeType, randomUuid, stringifyQuery } from "./CalmLensUtils";

// Requests, uploads and response checks that `CalmLensServerClient` and `CalmLensAppClient`
// share. Each client keeps one `CalmLensConnection` privately, so credentials stay hidden.

export const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Where `calmlens/testing` puts its hooks in client options. Not part of the public API:
 * the mock clients run the real clients against their in-memory API with these.
 */
export const MOCK_HOOKS = Symbol.for("@calmlens/sdk.mockHooks");

/** How a mock client changes the real client it runs. */
export interface MockHooks {
  /** Waits (retry backoff, `waitForDecision` polls) without real time passing. */
  sleep: (ms: number, signal: AbortSignal | undefined) => Promise<void>;
  /** The clock `waitForDecision` reads, which only `sleep` moves on. */
  now: () => number;
  /** When an upload token is signed, in epoch milliseconds, and its nonce. */
  uploadTokenTime: () => { now: number; nonce: string };
  /** Leaves multipart size checks to the API, so the in-memory API answers them in its order. */
  deferUploadChecks: boolean;
  /** The CDN base URL when the options set none. */
  defaultCdnBaseUrl: string;
}

/** The mock hooks in client options, if a mock client set them. */
export const getMockHooks = (options: object): MockHooks | undefined =>
  (options as { [MOCK_HOOKS]?: MockHooks })[MOCK_HOOKS];
export const DEFAULT_MAX_RETRIES = 2;
/** Content larger than this is uploaded in parts of this size (`partSizeBytes`). */
export const DEFAULT_PART_SIZE_BYTES = 8 * 1024 * 1024;
/** `partSizeBytes` bounds: every part but the last is at least 5 MiB. */
export const MIN_PART_SIZE_BYTES = 5 * 1024 * 1024;
export const MAX_PART_SIZE_BYTES = 64 * 1024 * 1024;
/** The longest `idempotencyKey` of an upload sent in parts: each part's key adds `:part-<n>`. */
export const MAX_SPLIT_IDEMPOTENCY_KEY_LENGTH = 240;

/** Content the client can cut into parts and read again for a retry, with its size. */
interface SplittableContent {
  size: number;
  /** The bytes from `start` to `end` as a part payload. */
  slice(start: number, end: number): AssetBinaryPayloadInput;
}

/**
 * The size of content the client can split, read again and resend: bytes, base64 and Blobs.
 * Streams and Responses can be read only once, and text stays one request.
 */
const getSplittableContent = (content: AssetBinaryPayloadInput): SplittableContent | undefined => {
  if ("plainText" in content && content.plainText !== undefined) return undefined;
  if ("data" in content && content.data !== undefined) {
    const { data } = content;
    if (!(data instanceof Blob)) return undefined;
    return { size: data.size, slice: (start, end) => ({ data: data.slice(start, end) }) };
  }
  const size = getAssetPayloadByteLength(content);
  if (size === undefined) return undefined;
  let bytes: Uint8Array | undefined;
  return {
    size,
    slice: (start, end) => {
      if (!bytes) {
        const data = assetToData(content);
        bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : (data as Uint8Array);
      }
      return { uint8Array: bytes.subarray(start, end) };
    },
  };
};

/** Whether `content` goes in parts: its size is known, it can be resent, and it's over a part. */
export const splitsIntoParts = (content: AssetBinaryPayloadInput, partSizeBytes: number) => {
  const splittable = getSplittableContent(content);
  return splittable !== undefined && splittable.size > partSizeBytes;
};
export const DEFAULT_MAX_RESPONSE_BYTES = 32 * 1024 * 1024;

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
  if (!isAcceptedUploadMimeType(mimeType)) {
    throw new CalmLensError(API_ERROR_CODES.UNSUPPORTED_UPLOAD_TYPE, {
      message: getRejectedUploadMimeTypeError(mimeType),
      details: { mimeType, source: "calmlens" },
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

/**
 * Refuses content whose known size is over the API's limit for its type, so nothing is sent and
 * an oversized file fails at once instead of after its upload. In one request, images can be up
 * to 10 MiB (larger ones are uploaded in parts), audio and video up to 50 MiB and other files up
 * to 5,000 MiB. Sent in parts (`inParts`), audio and video can be up to 2 GiB; the API holds free
 * uploads, made before billing is set up, to 50 MiB itself. Images in parts are checked apart.
 */
const assertUploadSize = (type: string, size: number | undefined, inParts: boolean) => {
  if (size === undefined) return;
  const mime = type.toLowerCase();
  const [limit, message] = mime.startsWith("image/")
    ? [
        MAX_DIRECT_IMAGE_UPLOAD_BYTES,
        "Images uploaded in one request can be at most 10 MiB; upload larger images in parts",
      ]
    : mime.startsWith("audio/") || mime.startsWith("video/")
      ? [
          inParts ? MAX_LONG_MEDIA_UPLOAD_BYTES : MAX_MEDIA_UPLOAD_BYTES,
          "Audio and video files can be at most 50 MiB in one request, or 2 GiB in parts",
        ]
      : [MAX_NON_IMAGE_UPLOAD_BYTES, "Files can be at most 5,000 MiB"];
  if (size > limit) {
    throw new CalmLensError(API_ERROR_CODES.UPLOAD_TOO_LARGE, {
      message,
      details: { limitBytes: limit, source: "plan" },
    });
  }
};

/** Checks upload options before anything is sent. */
export const prepareSubmitAssetOptions = (
  options: SubmitAssetOptions,
  {
    deferUploadChecks = false,
    partSizeBytes = DEFAULT_PART_SIZE_BYTES,
  }: { deferUploadChecks?: boolean; partSizeBytes?: number } = {},
): SubmitAssetOptions => {
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
    const inParts = splitsIntoParts(options.content, partSizeBytes);
    if (inParts && (options.idempotencyKey?.length ?? 0) > MAX_SPLIT_IDEMPOTENCY_KEY_LENGTH) {
      throw invalidArgument(
        `idempotencyKey can be at most ${MAX_SPLIT_IDEMPOTENCY_KEY_LENGTH} characters for an upload sent in parts`,
      );
    }
    if (!deferUploadChecks && inParts && isImageMimeType(options.content.type)) {
      if ((getAssetPayloadByteLength(options.content) ?? 0) > MAX_IMAGE_UPLOAD_BYTES) {
        throw new CalmLensError(API_ERROR_CODES.UPLOAD_TOO_LARGE, {
          message: "Multipart image uploads cannot exceed 20 MiB.",
          details: { limitBytes: MAX_IMAGE_UPLOAD_BYTES, source: "plan" },
        });
      }
    } else if (!deferUploadChecks) {
      assertUploadSize(
        options.content.type,
        options.content.sizeInBytes ?? getAssetPayloadByteLength(options.content),
        inParts,
      );
    }
    if (!("plainText" in options.content)) {
      const validation = validateAssetPayload(options.content);
      if (!validation.ok) throw invalidPayload(validation.error);
    }
  }
  if ("part" in options) {
    assertDeclaredPayloadSize(options.part, options.part.sizeInBytes ?? options.sizeInBytes);
    assertValidUploadMimeType(options.part.type);
    const partSizeInBytes = options.part.sizeInBytes ?? getAssetPayloadByteLength(options.part);
    if (!deferUploadChecks && isImageMimeType(options.part.type) && partSizeInBytes !== undefined) {
      if (partSizeInBytes > MAX_IMAGE_UPLOAD_BYTES) {
        throw new CalmLensError(API_ERROR_CODES.UPLOAD_TOO_LARGE, {
          message: "Multipart image uploads cannot exceed 20 MiB.",
          details: { limitBytes: MAX_IMAGE_UPLOAD_BYTES, source: "plan" },
        });
      }
    }
    // A declared whole-file size over the limit for parts can never finish.
    if (!deferUploadChecks && !isImageMimeType(options.part.type)) {
      assertUploadSize(options.part.type, options.totalSizeInBytes, true);
    }
    // Deferred, only the base64 part boundary is checked here; the API checks part sizes.
    const validation = validateAssetPayload(options.part, {
      multipart: true,
      isFinal: deferUploadChecks || options.part.isFinal,
    });
    if (!validation.ok) throw invalidPayload(validation.error);
  }
  if (options.context !== undefined) {
    if (!options.context || !Array.isArray(options.context.items)) {
      throw invalidArgument("context.items must be an array of earlier posts");
    }
    // Only the posts CalmLens uses are sent, which keeps a raw upload's query short.
    return { ...options, context: { items: selectModerationContextItems(options.context.items) } };
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
  !!(data as { id: string }).id &&
  hasStringStatus((data as { classification?: unknown }).classification) &&
  hasStringStatus((data as { upload?: unknown }).upload);

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
  /** Set by a mock client; see `MOCK_HOOKS`. */
  readonly hooks: MockHooks | undefined;

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
    this.hooks = getMockHooks(options);
    this.transport = new CalmLensTransport({
      apiKey,
      sleep: this.hooks?.sleep,
      fetch: ((input, init) => resolveFetch()(input, init)) as typeof fetch,
      signal: options.signal,
      maxRetries: options.maxRetries ?? DEFAULT_MAX_RETRIES,
      maxResponseBytes: options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES,
    });
  }

  /** How the client waits between polls and retries. */
  get sleep(): (ms: number, signal: AbortSignal | undefined) => Promise<void> {
    return this.hooks?.sleep ?? sleep;
  }

  /** Whether multipart size checks are left to the API (mock clients only). */
  get deferUploadChecks(): boolean {
    return this.hooks?.deferUploadChecks ?? false;
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
    wait: boolean,
    authHeaders: Record<string, string> = {},
  ): Promise<unknown> {
    const query = new URLSearchParams();
    query.set("name", options.name);
    query.set("wait", String(wait));
    setOptionalQueryValue(query, "description", options.description);
    setOptionalQueryValue(query, "processingOptions", options.processingOptions);
    setOptionalQueryValue(query, "visibility", options.visibility);
    setOptionalQueryValue(query, "metadata", options.metadata);
    setOptionalQueryValue(query, "tags", options.tags);
    setOptionalQueryValue(query, "authorId", options.authorId);
    setOptionalQueryValue(query, "context", options.context);
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

  /** Content larger than this is uploaded in parts. */
  get partSizeBytes(): number {
    return this.options.partSizeBytes ?? DEFAULT_PART_SIZE_BYTES;
  }

  /**
   * Uploads content larger than `partSizeBytes` in parts: the first to `uploadsPath` with the
   * upload's fields, the rest to `partPath(assetId)`. Each part carries its own Idempotency-Key
   * (`<key>:part-<n>`), so it is retried safely and a repeated call with the same key resumes the
   * upload. A part the API already has is skipped, and a final part that finds the upload already
   * completed reads it back with `retrieve`.
   */
  async submitInParts(
    uploadsPath: string,
    options: Extract<SubmitAssetOptions, { content: unknown }>,
    wait: boolean,
    {
      authHeaders = {},
      partPath,
      onStarted,
      retrieve,
    }: {
      authHeaders?: Record<string, string>;
      partPath: (assetId: string) => string;
      onStarted?: (assetId: string) => void;
      retrieve: (assetId: string) => Promise<unknown>;
    },
  ): Promise<unknown> {
    const { content, idempotencyKey, ...fields } = options;
    const source = getSplittableContent(content)!;
    const partSize = this.partSizeBytes;
    const count = Math.ceil(source.size / partSize);
    const key = idempotencyKey ?? newIdempotencyKey();
    const part = (partNumber: number) =>
      source.slice((partNumber - 1) * partSize, Math.min(partNumber * partSize, source.size));
    const first = (await this.submitRawUpload(
      uploadsPath,
      {
        ...fields,
        part: { ...part(1), type: content.type, partNumber: 1, isFinal: false },
        totalSizeInBytes: source.size,
        idempotencyKey: key,
      } as SubmitAssetOptions as Exclude<SubmitAssetOptions, { url: string }>,
      wait,
      authHeaders,
    )) as { id?: unknown };
    const assetId = expectUploadedAsset(first).id;
    onStarted?.(assetId);
    let result: unknown = first;
    for (let partNumber = 2; partNumber <= count; ) {
      const isFinal = partNumber === count;
      try {
        result = await this.uploadPart(
          partPath(assetId),
          {
            part: { ...part(partNumber), partNumber, isFinal } as MultipartUploadPartOptions,
            idempotencyKey: `${key}:part-${partNumber}`,
          },
          authHeaders,
        );
        partNumber++;
      } catch (error) {
        if (!(error instanceof CalmLensError)) throw error;
        const expected = error.details?.expectedPartNumber;
        // The API already has the parts before `expected`: their responses were lost.
        if (
          error.code === API_ERROR_CODES.INVALID_UPLOAD_PART_NUMBER &&
          typeof expected === "number" &&
          expected > partNumber &&
          expected <= count
        ) {
          partNumber = expected;
          continue;
        }
        // The final part already arrived and completed the upload.
        if (isFinal && error.code === API_ERROR_CODES.UPLOAD_NOT_OPEN) return retrieve(assetId);
        throw error;
      }
    }
    return result;
  }

  /** Uploads the next part of a multipart upload to `partPath` (`.../assets/{id}/part`). */
  uploadPart(
    partPath: string,
    { part, wait, idempotencyKey }: Omit<UploadAssetPartOptions, "assetId">,
    authHeaders: Record<string, string> = {},
  ): Promise<unknown> {
    if (!part) throw invalidArgument("Part options are required");
    assertDeclaredPayloadSize(part);
    const validation = validateAssetPayload(part, {
      multipart: true,
      isFinal: this.deferUploadChecks || part.isFinal,
    });
    if (!validation.ok) throw invalidPayload(validation.error);
    const query = new URLSearchParams({
      partNumber: String(part.partNumber),
      isFinal: String(part.isFinal ?? false),
    });
    if (wait !== undefined) query.set("wait", String(wait));
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
