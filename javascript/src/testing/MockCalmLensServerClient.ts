import { assertDeclaredPayloadSize } from "../client/CalmLensConnection";
import {
  CalmLensError,
  type CalmLensErrorDetails,
  invalidArgument,
  SDK_ERROR_CODES,
} from "../client/CalmLensError";
import {
  API_ERROR_CODES,
  API_ERROR_DEFINITIONS,
  type ApiErrorCode,
} from "../client/CalmLensErrorCodes";
import { sleep } from "../client/CalmLensTransport";
import type {
  Asset,
  AssetChildrenPage,
  AssetPage,
  AssetSearchResponse,
  CalmLensServerClientOptions,
  CdnAssetUrlOptions,
  CdnServeOptions,
  ClassifyTextOptions,
  CreateAssetSignedUrlOptions,
  CreateFolderOptions,
  DeleteAssetContentOptions,
  DeleteAssetOptions,
  EnsureLensesOptions,
  EnsureLensOptions,
  ExplainAssetOptions,
  FolderIdOptions,
  FolderPage,
  IterateAssetChildrenOptions,
  IterateAssetsOptions,
  Lens,
  ListAssetChildrenOptions,
  ListAssetsOptions,
  ListEventsOptions,
  ListFoldersOptions,
  MoveAssetOptions,
  MoveFolderOptions,
  RetrieveAssetOptions,
  RetryAssetOptions,
  SearchAssetsOptions,
  SignedUploadToken,
  SignUploadTokenOptions,
  SubmitAssetOptions,
  UpdateAssetOptions,
  UpdateFolderOptions,
  UploadAssetPartOptions,
  WaitForAssetDecisionOptions,
} from "../client/CalmLensTypes";
import { signUploadTokenWithApiKey } from "../client/CalmLensUploadTokens";
import {
  encodePathSegment,
  getAssetUrl,
  pollForDecision,
  toTextAssetOptions,
  transformSelector,
  validateServerClientOptions,
} from "../client/CalmLensUtils";
import { getAssetPayloadByteLength, validateAssetPayload } from "../contract/AssetPayload.js";
import type { TypedEvent } from "../contract/Event.js";
import type { Folder } from "../contract/Folder.js";
import { stringifyJsonCanonical } from "../contract/JsonUtils.js";
import { type PermissionGrant, permits } from "../contract/Permissions.js";
import { placeholderHashToDataURL } from "../contract/PlaceholderHashDecode.js";
import type {
  GetEventsResponse,
  PostAssetSignedUrlResponse,
} from "../contract/PublicApiSchemas.js";
import {
  getRejectedUploadMimeTypeError,
  isRejectedUploadMimeType,
  MAX_IMAGE_UPLOAD_BYTES,
  MIN_MULTIPART_IMAGE_UPLOAD_BYTES,
} from "../contract/SharedConstants.js";
import { createMockApiKey, getMockApiKeyGrants } from "./MockApiKey";
import {
  InMemoryMockDatabaseStorage,
  InMemoryMockImageStorage,
  type MockDatabaseStorage,
  type MockImageStorage,
} from "./MockStorage";
import { createPage, filterAssets, inferAssetType, searchAssets } from "./MockUtils";

const DEFAULT_EVENTS_LIMIT = 50;

/** Stands in for binary payloads when comparing idempotent requests, like the API's size check. */
const describeBinary = (value: unknown) => {
  if (value instanceof Blob) return `[blob:${value.size}]`;
  if (value instanceof ArrayBuffer) return `[bytes:${value.byteLength}]`;
  if (ArrayBuffer.isView(value)) return `[bytes:${value.byteLength}]`;
  return value;
};
const MAX_EVENTS_LIMIT = 100;
const MAX_SEARCH_LIMIT = 20;
const MAX_SEARCH_QUERY_LENGTH = 200;
const MAX_FOLDER_PAGE_SIZE = 100;

/**
 * The ThumbHash the mock gives every classified image, standing in for one computed from its
 * pixels. The `placeholder` resource serves it as a PNG, like the CDN.
 */
const MOCK_THUMBHASH = "1QcSHQRnh493V4dIh4eXh1h4kJUI";

/** Like the API: 1 to 255 printable ASCII characters, once HTTP has trimmed the header value. */
const isValidIdempotencyKey = (key: string) =>
  key.length > 0 && key.length <= 255 && /^[\x21-\x7e](?:[\x20-\x7e]*[\x21-\x7e])?$/.test(key);

/** Like the CDN, content a browser could run as a document is served as a download. */
const isActiveContentType = (type: string | undefined) => {
  const normalized = type?.toLowerCase().split(";", 1)[0]?.trim();
  return Boolean(
    normalized &&
      ([
        "image/svg+xml",
        "application/xhtml+xml",
        "text/html",
        "application/xml",
        "text/xml",
      ].includes(normalized) ||
        normalized.endsWith("+xml")),
  );
};

const createMonotonicClock = () => {
  let last = 0;
  return () => {
    last = Math.max(Date.now(), last + 1);
    return last;
  };
};

export interface MockCalmLensServerClientOptions extends CalmLensServerClientOptions {
  mockOptions?: {
    databaseStorage?: MockDatabaseStorage;
    imageStorage?: MockImageStorage;
    createId?: () => string;
    /**
     * The clock, in epoch milliseconds. The default is the system clock, moved on by at least a
     * millisecond per reading, so assets created in a row have increasing `createdAt` values and
     * orderings by `createdAt` don't depend on IDs.
     */
    now?: () => number;
    /**
     * Outcome of `assets.create` (and queued multipart uploads). Defaults to `pending`. Pass a
     * function to choose per upload, for example from `asset.name`.
     */
    queuedOutcome?: MockAssetOutcome | ((asset: Asset) => MockAssetOutcome);
    /** Outcome of `assets.classify` and `text.classify`. Defaults to `allowed`. */
    analyzedOutcome?: MockAssetOutcome | ((asset: Asset) => MockAssetOutcome);
    signedUrlBaseUrl?: string;
  };
}

/**
 * Where a mock upload ends up: `pending` (still processing), `allowed`, `limited`, `age-restricted`,
 * `blocked` or `purged` (processing done with that moderation status; `purged` also removes the content),
 * or `failed` (processing failed, retryable).
 */
export type MockAssetOutcome =
  | "pending"
  | "allowed"
  | "limited"
  | "age-restricted"
  | "blocked"
  | "purged"
  | "failed";

/** A reviewer's decision for `decide`: the moderation status it gives the asset. */
export type MockReviewDecision = "allowed" | "limited" | "age-restricted" | "blocked" | "purged";

const REVIEW_DECISIONS: readonly MockReviewDecision[] = [
  "allowed",
  "limited",
  "age-restricted",
  "blocked",
  "purged",
];

/** The options each `MockCalmLensServerClient` method was given, by operation name. */
export interface MockCalmLensOperationOptions {
  "assets.list": ListAssetsOptions;
  "assets.search": SearchAssetsOptions;
  "assets.retrieve": RetrieveAssetOptions;
  "assets.update": UpdateAssetOptions;
  "assets.listChildren": ListAssetChildrenOptions;
  "assets.create": SubmitAssetOptions;
  "assets.classify": SubmitAssetOptions;
  "assets.uploadPart": UploadAssetPartOptions;
  "assets.createSignedUrl": CreateAssetSignedUrlOptions;
  "assets.move": MoveAssetOptions;
  "assets.retry": RetryAssetOptions;
  "assets.explain": ExplainAssetOptions;
  "assets.waitForDecision": WaitForAssetDecisionOptions;
  "assets.deleteContent": DeleteAssetContentOptions;
  "assets.delete": DeleteAssetOptions;
  "text.classify": ClassifyTextOptions;
  "cdn.serve": CdnServeOptions;
  "events.list": ListEventsOptions;
  "folders.list": ListFoldersOptions;
  "folders.retrieve": FolderIdOptions;
  "folders.create": CreateFolderOptions;
  "folders.update": UpdateFolderOptions;
  "folders.delete": FolderIdOptions;
  "folders.move": MoveFolderOptions;
  ensureLens: EnsureLensOptions;
  ensureLenses: EnsureLensesOptions;
  "uploadTokens.sign": SignUploadTokenOptions;
}

/** A `MockCalmLensServerClient` method, named like its path on the client. */
export type MockCalmLensOperation = keyof MockCalmLensOperationOptions;

/**
 * One recorded call: the method and the options object it was given, exactly as passed. Narrow
 * on `operation` (or use `callsTo`) to get its options type.
 */
export type MockCalmLensCall<TOperation extends MockCalmLensOperation = MockCalmLensOperation> = {
  [Operation in TOperation]: {
    operation: Operation;
    options: MockCalmLensOperationOptions[Operation];
  };
}[TOperation];

/**
 * What a simulated request failure throws: `"transport-error"` and `"timeout"` throw the same
 * `CalmLensError` the real client throws for a network failure (`sdk/transport-error`) or a
 * deadline (`sdk/timeout`); an API error code, such as `"upload/limit-exceeded"`, throws that API
 * error with its HTTP status, message and request ID; any `Error` is thrown as given.
 */
export type MockRequestFailure = "transport-error" | "timeout" | ApiErrorCode | Error;

/** An event to add to the mock feed; omitted fields get defaults. */
export type MockEventInput = Partial<Omit<TypedEvent, "type">> & { type: TypedEvent["type"] };

const toFailureError = (failure: Exclude<MockRequestFailure, ApiErrorCode>): Error => {
  if (failure === "transport-error") {
    return new CalmLensError(SDK_ERROR_CODES.TRANSPORT_ERROR, {
      message: "Request failed",
      cause: new TypeError("Simulated network failure"),
    });
  }
  if (failure === "timeout") {
    const cause = new Error("The operation timed out.");
    cause.name = "TimeoutError";
    return new CalmLensError(SDK_ERROR_CODES.TIMEOUT, { message: "Request timed out", cause });
  }
  return failure;
};

/** The asset snapshot events carry (getEventAsset in the API). */
const toEventAsset = (asset: Asset) => ({
  id: asset.id,
  externalId: asset.externalId ?? null,
  uploadPresetId: asset.uploadPresetId ?? null,
  upload: { status: asset.upload.status },
  classification: {
    status: asset.classification.status,
    moderation: { status: asset.classification.moderation.status },
  },
  content: { status: asset.content.status },
});

/** Removing content removes the placeholder and average colour with it. */
const withoutPlaceholder = (image: Asset["content"]["image"]) =>
  image ? { ...image, thumbhash: null, averageColor: null } : image;

/**
 * An in-memory stand-in for `CalmLensServerClient` with the same methods, validation and error
 * codes. API errors carry the HTTP status, a `requestId` and response headers like the real
 * client's, so error handling can be tested without a network.
 */
export class MockCalmLensServerClient {
  readonly databaseStorage: MockDatabaseStorage;
  readonly imageStorage: MockImageStorage;
  private readonly createId: () => string;
  private readonly now: () => number;
  private readonly queuedOutcome: MockAssetOutcome | ((asset: Asset) => MockAssetOutcome);
  private readonly analyzedOutcome: MockAssetOutcome | ((asset: Asset) => MockAssetOutcome);
  private apiKeyGrants: PermissionGrant[];
  private readonly signedUrlBaseUrl: string;
  private readonly cdnBaseUrl: string;
  private readonly projectId: string;
  private readonly apiKey: string;
  private readonly lenses = new Map<string, Lens>();
  private readonly eventFeed: TypedEvent[] = [];
  /** What each open multipart upload was started with, as the API saves it. */
  private readonly openUploads = new Map<string, { queue: boolean; totalSizeInBytes?: number }>();
  private readonly idempotentResults = new Map<string, { fingerprint: string; asset: Asset }>();
  private requestCount = 0;
  /** Time `waitForDecision` has spent waiting: mock waits advance it instead of sleeping. */
  private waitedMs = 0;
  private readonly pendingFailures: Array<{
    failure: MockRequestFailure;
    operation?: MockCalmLensOperation;
  }> = [];
  /** Every call made through this client, oldest first. */
  readonly calls: MockCalmLensCall[] = [];

  /** Accepts the same options as `CalmLensServerClient` (validated the same way), plus `mockOptions`. */
  constructor(options: MockCalmLensServerClientOptions) {
    validateServerClientOptions(options);
    this.projectId = options.projectId;
    this.apiKey = options.apiKey;
    this.databaseStorage =
      options.mockOptions?.databaseStorage ?? new InMemoryMockDatabaseStorage();
    this.imageStorage = options.mockOptions?.imageStorage ?? new InMemoryMockImageStorage();
    this.createId = options.mockOptions?.createId ?? crypto.randomUUID.bind(crypto);
    this.now = options.mockOptions?.now ?? createMonotonicClock();
    this.queuedOutcome = options.mockOptions?.queuedOutcome ?? "pending";
    this.analyzedOutcome = options.mockOptions?.analyzedOutcome ?? "allowed";
    this.apiKeyGrants = getMockApiKeyGrants(options.apiKey);
    this.signedUrlBaseUrl = options.mockOptions?.signedUrlBaseUrl ?? "mock://calmlens";
    this.cdnBaseUrl = (options.cdnBaseUrl ?? "mock://calmlens/v1").replace(/\/+$/, "");
  }

  /** Keeps the API key out of `console.log` and `util.inspect`. */
  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return `MockCalmLensServerClient { projectId: ${JSON.stringify(this.projectId)} }`;
  }

  /**
   * Makes the next call (or the next call to `operation`) throw `failure` instead of running,
   * as if the request never completed. Queue several to fail several calls in a row.
   */
  failNextRequest(
    failure: MockRequestFailure = "transport-error",
    { operation }: { operation?: MockCalmLensOperation } = {},
  ): void {
    this.pendingFailures.push({ failure, operation });
  }

  /**
   * Changes the grants of the mock's API key, as editing the key in the portal would: later
   * requests, such as `cdn.serve`, use them. The key itself stays the same, so idempotency keys
   * it used still replay.
   */
  setApiKeyGrants(grants: PermissionGrant[]): void {
    this.apiKeyGrants = getMockApiKeyGrants(createMockApiKey(grants));
  }

  /** Calls recorded for one operation, oldest first. */
  callsTo<TOperation extends MockCalmLensOperation>(
    operation: TOperation,
  ): MockCalmLensCall<TOperation>[] {
    return this.calls.filter(
      (call) => call.operation === operation,
    ) as MockCalmLensCall<TOperation>[];
  }

  /**
   * Adds an event to the feed `events.list` reads, as if CalmLens had recorded it. Returns the
   * stored event; pass it to `toWebhookEventPayload` to build a matching webhook body.
   */
  enqueueEvent(input: MockEventInput): TypedEvent {
    const now = this.now();
    const event = {
      id: this.createId(),
      projectId: this.projectId,
      severity: "low",
      title: input.type,
      facts: [],
      createdAt: now,
      updatedAt: now,
      ...input,
    } as TypedEvent;
    this.eventFeed.push(event);
    return event;
  }

  /**
   * Applies a reviewer's decision to a stored asset, as the portal or API would: the moderation
   * status changes (`purged` also removes the content, with reason `requested` and an
   * `asset.content-removed` event), the review joins `manualReviews`, and an `asset.<decision>`
   * event with a `decided-by: reviewer` fact joins the events feed. Rejects with
   * `asset/not-found` for an unknown asset.
   */
  async decide(assetId: string, decision: MockReviewDecision): Promise<Asset> {
    if (!REVIEW_DECISIONS.includes(decision)) {
      throw invalidArgument(`decision must be one of ${REVIEW_DECISIONS.join(", ")}`);
    }
    const asset = await this.findOwnAsset(assetId);
    const decided = await this.applyOutcome(asset, decision, "requested");
    const now = this.now();
    decided.classification.moderation.manualReviews = [
      ...(decided.classification.moderation.manualReviews ?? []),
      {
        id: this.createId(),
        decision,
        note: null,
        reviewerUserId: null,
        reviewedAt: now,
        appliedToAsset: true,
      },
    ];
    const stored = await this.databaseStorage.updateAsset(decided);
    if (decision === "purged") this.recordLifecycleEvent("asset.content-removed", stored);
    this.enqueueEvent({
      type: `asset.${decision}`,
      // Like the event catalog: only allowing and limiting are low severity.
      severity: decision === "allowed" || decision === "limited" ? "low" : "high",
      title: `asset.${decision}`,
      assetId: stored.id,
      asset: toEventAsset(stored),
      facts: [
        { key: "decided-by", value: "reviewer" },
        { key: "asset-type", value: stored.type },
        { key: "asset-name", value: stored.name, url: `/portal/assets/${stored.id}` },
        { key: "note", value: null },
      ],
    } as MockEventInput);
    return stored;
  }

  /** An API error as the real client throws it: status, default message and request ID. */
  private apiError(
    code: ApiErrorCode,
    options: { message?: string; details?: CalmLensErrorDetails } = {},
  ): CalmLensError {
    const definition = API_ERROR_DEFINITIONS[code];
    const requestId = `mock-request-${++this.requestCount}`;
    return new CalmLensError(code, {
      message: options.message ?? definition.message,
      status: definition.status,
      details: options.details,
      requestId,
      headers: new Headers({ "content-type": "application/json", "x-request-id": requestId }),
    });
  }

  /** A request the API's schema refuses: `validation/<zod issue>` with HTTP 400 and the field. */
  private validationError(code: string, path?: string, message?: string): CalmLensError {
    const requestId = `mock-request-${++this.requestCount}`;
    return new CalmLensError(code, {
      message: message ?? (path ? `Invalid ${path}` : "Invalid request"),
      status: 400,
      details: path === undefined ? undefined : { path },
      requestId,
      headers: new Headers({ "content-type": "application/json", "x-request-id": requestId }),
    });
  }

  /** Fails a page request like the API (see `createPage`). */
  private readonly pageFailure = (
    code: "validation/too-small" | "validation/too-big" | "validation/invalid-cursor",
    path?: string,
  ): Error =>
    code === "validation/invalid-cursor"
      ? this.apiError(API_ERROR_CODES.INVALID_CURSOR)
      : this.validationError(code, path);

  private assertValidUploadMimeType(mimeType: string) {
    if (isRejectedUploadMimeType(mimeType)) {
      throw this.apiError(API_ERROR_CODES.INVALID_UPLOAD_MIME_TYPE, {
        message: getRejectedUploadMimeTypeError(mimeType),
        details: { mimeType },
      });
    }
  }

  private invalidPayload(message: string) {
    return this.apiError(API_ERROR_CODES.INVALID_UPLOAD_PAYLOAD, { message });
  }

  private async findOwnAsset(assetId: string): Promise<Asset> {
    encodePathSegment(assetId, "Asset ID");
    const asset = await this.databaseStorage.getAsset(assetId);
    if (!asset || asset.projectId !== this.projectId) {
      throw this.apiError(API_ERROR_CODES.ASSET_NOT_FOUND);
    }
    return asset;
  }

  private begin<TOperation extends MockCalmLensOperation>(
    operation: TOperation,
    options: MockCalmLensOperationOptions[TOperation],
  ): void {
    this.calls.push({ operation, options } as MockCalmLensCall);
    const index = this.pendingFailures.findIndex(
      (pending) => pending.operation === undefined || pending.operation === operation,
    );
    if (index !== -1) {
      const [pending] = this.pendingFailures.splice(index, 1);
      const { failure } = pending!;
      throw typeof failure === "string" && failure in API_ERROR_DEFINITIONS
        ? this.apiError(failure as ApiErrorCode)
        : toFailureError(failure as Exclude<MockRequestFailure, ApiErrorCode>);
    }
  }

  private jsonResponse(status: number, body: unknown, url: string): Response {
    const requestId = `mock-request-${++this.requestCount}`;
    const response = new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", "x-request-id": requestId },
    });
    Object.defineProperty(response, "url", { value: url });
    return response;
  }

  get cdn() {
    return {
      getAssetUrl: ({ assetIdentifier, ...options }: CdnAssetUrlOptions): string => {
        return getAssetUrl({
          projectId: this.projectId,
          cdnBaseUrl: this.cdnBaseUrl,
          assetIdentifier,
          ...options,
        });
      },

      /**
       * Serves stored content like the CDN: `200` with `Content-Type`, `Content-Length`,
       * `Cache-Control`, `Cache-Tag`, the CDN's protection headers and, for images, `ETag` and
       * `Expires`; or a JSON error body with `404`/`403`. A `placeholder` is the asset's
       * ThumbHash as a PNG. Never throws for HTTP errors, like the real client.
       */
      serve: async (serveOptions: CdnServeOptions): Promise<Response> => {
        this.begin("cdn.serve", serveOptions);
        const { assetIdentifier, init, ...options } = serveOptions;
        const url = this.cdn.getAssetUrl({ assetIdentifier, ...options });

        const assets = await this.databaseStorage.listAssets(this.projectId);
        const asset = assets.find(
          (asset) => asset.id === assetIdentifier || asset.externalId === assetIdentifier,
        );
        if (!asset) {
          return this.jsonResponse(
            404,
            { code: "asset/not-found", message: "Asset not found" },
            url,
          );
        }
        const notAvailable = () =>
          this.jsonResponse(
            403,
            { code: "asset/not-available", message: "Asset is not available" },
            url,
          );
        const folders = (await this.databaseStorage.listFolders?.(this.projectId)) ?? [];
        const canDownload = () =>
          permits(this.apiKeyGrants, "assets:download", asset.folderId ?? null, folders);
        const status = asset.classification.moderation.status;

        if (options.resource === "placeholder") {
          // Like the CDN's placeholder handler: an image's ThumbHash, public for public assets
          // whatever their moderation status; refused for purged assets, assets without one
          // (not yet classified, or content removed) and, for private assets, keys without
          // `assets:download`.
          const thumbhash = asset.content.image?.thumbhash;
          if (!thumbhash || status === "purged") return notAvailable();
          const isPublic = asset.visibility === "public";
          if (!isPublic && !canDownload()) return notAvailable();
          const png = Uint8Array.from(
            atob(placeholderHashToDataURL(thumbhash).split(",", 2)[1]!),
            (char) => char.charCodeAt(0),
          );
          return this.cdnResponse(init, png, url, {
            "Content-Type": "image/png",
            "Cache-Control": `${isPublic ? "public" : "private"}, max-age=3600`,
            "Cache-Tag": `asset-${asset.id}`,
            ETag: `"${thumbhash}"`,
          });
        }

        // Like the CDN, delivery checks come first and refuse everyone: content still uploading,
        // blocked or purged, failed processing or removed content.
        const storedContent = await this.imageStorage.getContent(asset.id);
        if (
          asset.upload.status === "uploading" ||
          status === "purged" ||
          status === "blocked" ||
          asset.classification.status === "failed" ||
          asset.content.status === "removed" ||
          !storedContent
        ) {
          return notAvailable();
        }
        // Then access: private assets, and public age-restricted ones requested without
        // `allowAgeRestricted`, need an API key with `assets:download` for the asset's folder.
        const isPrivate =
          asset.visibility !== "public" ||
          (status === "age-restricted" && !options.allowAgeRestricted);
        if (isPrivate && !canDownload()) {
          return this.jsonResponse(
            403,
            {
              code: "asset/api-key-missing-permission",
              message: "This API key needs assets:download permission for this asset’s folder.",
            },
            url,
          );
        }

        const parts = [...storedContent.parts.entries()]
          .sort(([left], [right]) => left - right)
          .map(([, value]) => value);
        const byteLength = parts.reduce((sum, value) => sum + value.byteLength, 0);
        const bytes = new Uint8Array(byteLength);
        let offset = 0;
        for (const part of parts) {
          bytes.set(part, offset);
          offset += part.byteLength;
        }
        const contentType = storedContent.type ?? "application/octet-stream";
        const isImage = asset.type === "image";
        return this.cdnResponse(init, bytes, url, {
          "Content-Type": contentType,
          // Like the CDN: an image's bytes are immutable for a year, other content is kept for
          // an hour, publicly only when delivery is public.
          "Cache-Control": `${isPrivate ? "private" : "public"}, ${
            isImage ? "max-age=31536000, immutable" : "max-age=3600"
          }`,
          "Cache-Tag": `asset-${asset.id}`,
          ...(isImage
            ? {
                ETag: `"${asset.id}"`,
                Expires: new Date(this.now() + 31536000 * 1000).toUTCString(),
              }
            : {}),
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": "sandbox; default-src 'none'",
          ...(isActiveContentType(contentType) ? { "Content-Disposition": "attachment" } : {}),
        });
      },
    };
  }

  private cdnResponse(
    init: RequestInit | undefined,
    bytes: Uint8Array<ArrayBuffer>,
    url: string,
    headers: Record<string, string>,
  ): Response {
    const requestId = `mock-request-${++this.requestCount}`;
    const isHead = init?.method?.toUpperCase() === "HEAD";
    const response = new Response(isHead ? null : bytes, {
      status: 200,
      headers: {
        ...headers,
        "Content-Length": String(bytes.byteLength),
        "X-Request-Id": requestId,
        "X-Mock-CalmLens-CDN-URL": url,
      },
    });
    Object.defineProperty(response, "url", { value: url });
    return response;
  }

  get events() {
    return {
      /**
       * Reads the mock feed like the API: without `after`, no events and a cursor for "now";
       * with `after`, up to `limit` events added since, oldest first. Add events with
       * `enqueueEvent`.
       */
      list: async (options: ListEventsOptions = {}): Promise<GetEventsResponse> => {
        this.begin("events.list", options);
        return this.listEvents(options);
      },

      pages: (options: ListEventsOptions = {}) => this.iterateEventPages(options),
    };
  }

  private listEvents(options: ListEventsOptions): GetEventsResponse {
    const limit = options.limit ?? DEFAULT_EVENTS_LIMIT;
    // Like the API's query schema: an integer from 1 to 100.
    if (typeof limit !== "number" || !Number.isFinite(limit) || limit < 1) {
      throw this.validationError("validation/too-small", "limit");
    }
    if (limit > MAX_EVENTS_LIMIT) throw this.validationError("validation/too-big", "limit");
    if (!Number.isInteger(limit)) throw this.validationError("validation/invalid-type", "limit");
    if (!options.after) {
      return { events: [], cursor: `mock_${this.eventFeed.length}`, hasMore: false };
    }
    const match = /^mock_(\d+)$/.exec(options.after);
    const position = match ? Number(match[1]) : Number.NaN;
    if (!Number.isSafeInteger(position) || position > this.eventFeed.length) {
      throw this.apiError(API_ERROR_CODES.INVALID_EVENT_CURSOR, {
        details: { after: options.after },
      });
    }
    const events = this.eventFeed.slice(position, position + limit);
    const next = position + events.length;
    return { events, cursor: `mock_${next}`, hasMore: next < this.eventFeed.length };
  }

  private async *iterateEventPages(
    options: ListEventsOptions,
  ): AsyncGenerator<GetEventsResponse, void, undefined> {
    let after = options.after;
    for (;;) {
      const page = await this.events.list({ ...options, after });
      yield page;
      if (!page.hasMore || page.cursor === after) return;
      after = page.cursor;
    }
  }

  private async *iteratePages(
    listPage: (
      cursor?: string,
    ) => Promise<{ items: Asset[]; nextCursor: string | null; hasMore: boolean }>,
  ): AsyncGenerator<Asset, void, undefined> {
    let cursor: string | undefined;
    for (;;) {
      const page = await listPage(cursor);
      yield* page.items;
      if (!page.nextCursor || !page.hasMore || page.items.length === 0) return;
      cursor = page.nextCursor;
    }
  }

  get text() {
    return {
      classify: async (options: ClassifyTextOptions): Promise<Asset> => {
        this.begin("text.classify", options);
        return this.moderateAsset(toTextAssetOptions(options), "text.classify");
      },
    };
  }

  get assets() {
    return {
      /**
       * Keyword search like the API's: every whitespace-separated token must appear,
       * case-insensitively, in the asset's name, ID, external ID, description, tags, type,
       * content format or extension, or moderation status. Results carry the API's keyword
       * scores and are ranked by score, then newest first. `mode` is accepted but there is no
       * semantic search, so `semanticStatus` is `disabled`.
       */
      search: async (options: SearchAssetsOptions): Promise<AssetSearchResponse> => {
        this.begin("assets.search", options);
        // Like the API's query schema: a trimmed query of 1 to 200 characters, a limit of 1 to 20.
        const query = typeof options?.query === "string" ? options.query.trim() : "";
        if (!query) throw this.validationError("validation/too-small", "query");
        if (query.length > MAX_SEARCH_QUERY_LENGTH) {
          throw this.validationError("validation/too-big", "query");
        }
        const limit = options.limit ?? 10;
        if (typeof limit !== "number" || !Number.isFinite(limit) || limit < 1) {
          throw this.validationError("validation/too-small", "limit");
        }
        if (limit > MAX_SEARCH_LIMIT) throw this.validationError("validation/too-big", "limit");
        const items = searchAssets(
          await this.databaseStorage.listAssets(this.projectId),
          query,
          limit,
        );
        return { query, items, semanticStatus: "disabled" };
      },

      /** Lists assets with the real client's paging, `ordering`, `folderId` and `filter`. */
      list: async (options: ListAssetsOptions = {}): Promise<AssetPage> => {
        this.begin("assets.list", options);
        let assets = await this.databaseStorage.listAssets(this.projectId);
        if (options.folderId !== undefined) {
          assets = assets.filter((asset) => (asset.folderId ?? null) === options.folderId);
        }
        assets = filterAssets(assets, options.filter);
        return createPage(assets, options, {
          scope: JSON.stringify([this.projectId, options.filter ?? null, options.folderId ?? null]),
          fail: this.pageFailure,
        });
      },

      iterate: (options: IterateAssetsOptions = {}) =>
        this.iteratePages((cursor) => this.assets.list({ ...options, cursor })),

      retrieve: async (options: RetrieveAssetOptions): Promise<Asset> => {
        this.begin("assets.retrieve", options);
        return this.findOwnAsset(options?.assetId);
      },

      listChildren: async (
        childrenOptions: ListAssetChildrenOptions = {} as ListAssetChildrenOptions,
      ): Promise<AssetChildrenPage> => {
        this.begin("assets.listChildren", childrenOptions);
        const { assetId, ...options } = childrenOptions;
        const parent = await this.findOwnAsset(assetId);
        const assets = await this.databaseStorage.listAssets(this.projectId);
        return createPage(
          assets.filter((asset) => asset.parentId === parent.id),
          options,
          { scope: parent.id, fail: this.pageFailure },
        );
      },

      iterateChildren: (options: IterateAssetChildrenOptions) => {
        encodePathSegment(options?.assetId, "Asset ID");
        return this.iteratePages((cursor) => this.assets.listChildren({ ...options, cursor }));
      },

      update: async (options: UpdateAssetOptions): Promise<Asset> => {
        this.begin("assets.update", options);
        const { assetId, ...body } = options;
        const asset = await this.findOwnAsset(assetId);
        const changes = Object.fromEntries(
          Object.entries(body).filter(([, value]) => value !== undefined),
        );
        // Like the API: an externalId stays unique in the project; `null` clears a field.
        if (body.externalId) {
          const assets = await this.databaseStorage.listAssets(this.projectId);
          if (
            assets.some((other) => other.id !== asset.id && other.externalId === body.externalId)
          ) {
            throw this.apiError(API_ERROR_CODES.DUPLICATE_EXTERNAL_ID);
          }
        }
        return this.databaseStorage.updateAsset({ ...asset, ...changes, updatedAt: this.now() });
      },

      create: async (options: SubmitAssetOptions): Promise<Asset> => {
        this.begin("assets.create", options);
        return this.withIdempotency("assets.create", options, () =>
          this.createAsset(options, true),
        );
      },

      classify: async (options: SubmitAssetOptions): Promise<Asset> => {
        this.begin("assets.classify", options);
        return this.moderateAsset(options, "assets.classify");
      },

      /** Continues a multipart upload: parts must arrive in order while it is `uploading`. */
      uploadPart: async (options: UploadAssetPartOptions): Promise<Asset> => {
        this.begin("assets.uploadPart", options);
        const { assetId, part } = options;
        encodePathSegment(assetId, "Asset ID");
        if (!part) throw invalidArgument("Part options are required");
        assertDeclaredPayloadSize(part);
        return this.withIdempotency("assets.uploadPart", options, async () => {
          // In the API's order: the upload must be open, parts arrive in order, image totals and
          // the declared total are checked, then the part itself (5 MiB unless it is the last).
          const asset = await this.findOwnAsset(assetId);
          if (asset.upload.status !== "uploading") {
            throw this.apiError(API_ERROR_CODES.UPLOAD_NOT_OPEN);
          }
          const expectedPartNumber = (asset.upload.partsReceived ?? 0) + 1;
          if (part.partNumber !== expectedPartNumber) {
            throw this.apiError(API_ERROR_CODES.INVALID_UPLOAD_PART_NUMBER, {
              message: `Expected part ${expectedPartNumber}`,
              details: { expectedPartNumber, receivedPartNumber: part.partNumber },
            });
          }
          const isFinal = part.isFinal === true;
          const partSize = part.sizeInBytes ?? getAssetPayloadByteLength(part);
          const received = (asset.content.sizeInBytes ?? 0) + (partSize ?? 0);
          const upload = this.openUploads.get(assetId);
          if (partSize !== undefined) {
            const sizeError =
              this.multipartImageSizeError(asset.type, received, isFinal) ??
              this.multipartTotalSizeError(upload?.totalSizeInBytes, received, isFinal);
            if (sizeError) throw this.apiError(sizeError);
          }
          const validation = validateAssetPayload(part, { multipart: true, isFinal });
          if (!validation.ok) throw this.invalidPayload(validation.error);

          await this.imageStorage.putPart(assetId, part);
          const queue = options.queue ?? upload?.queue ?? false;
          if (isFinal) this.openUploads.delete(assetId);
          const now = this.now();
          const next: Asset = {
            ...asset,
            updatedAt: now,
            content: { ...asset.content, sizeInBytes: received },
            // Like the API, a completed upload no longer counts parts.
            upload: {
              ...asset.upload,
              updatedAt: now,
              partsReceived: isFinal ? null : part.partNumber,
            },
          };
          return this.databaseStorage.updateAsset(
            isFinal ? await this.applyOutcome(next, this.outcomeFor(next, queue)) : next,
          );
        });
      },

      createSignedUrl: async (
        signedUrlOptions: CreateAssetSignedUrlOptions,
      ): Promise<PostAssetSignedUrlResponse> => {
        this.begin("assets.createSignedUrl", signedUrlOptions);
        const { assetId, ...options } = signedUrlOptions;
        const asset = await this.findOwnAsset(assetId);
        const expiresInSeconds = options.expiresInSeconds ?? 60 * 15;
        const resource = options.resource ?? "rendered";
        const transform = transformSelector(options.transform);
        const selector =
          (options.lens ? `&lens=${encodeURIComponent(options.lens)}` : "") +
          (transform ? `&transform=${encodeURIComponent(transform)}` : "");
        return {
          url: `${this.signedUrlBaseUrl}/assets/${asset.id}/${resource}?expiresInSeconds=${expiresInSeconds}${selector}`,
          expiresAt: this.now() + expiresInSeconds * 1000,
        };
      },

      move: async (options: MoveAssetOptions): Promise<Asset> => {
        this.begin("assets.move", options);
        const { assetId, folderId } = options;
        const asset = await this.findOwnAsset(assetId);
        if (folderId !== null && folderId !== undefined) {
          const folder = await this.resolveFolder(folderId);
          if (!folder) throw this.apiError(API_ERROR_CODES.FOLDER_NOT_FOUND);
        }
        return this.databaseStorage.updateAsset({
          ...asset,
          folderId: folderId ?? null,
          updatedAt: this.now(),
        });
      },

      retry: async (options: RetryAssetOptions): Promise<Asset> => {
        this.begin("assets.retry", options);
        const asset = await this.findOwnAsset(options?.assetId);
        if (
          asset.classification.status !== "failed" ||
          asset.classification.moderation.status !== "pending"
        ) {
          throw this.apiError(API_ERROR_CODES.ASSET_NOT_RETRYABLE);
        }
        if (asset.content.status === "removed") {
          throw this.apiError(API_ERROR_CODES.ASSET_CONTENT_UNAVAILABLE);
        }
        // Like the API: back to processing, to be moderated again, with an `asset.retried` event.
        const retried = await this.databaseStorage.updateAsset(
          await this.applyOutcome(asset, "pending"),
        );
        this.recordLifecycleEvent("asset.retried", retried);
        return retried;
      },

      explain: async (options: ExplainAssetOptions): Promise<Asset> => {
        this.begin("assets.explain", options);
        const asset = await this.findOwnAsset(options?.assetId);
        if (asset.classification.status !== "completed") {
          throw this.apiError(API_ERROR_CODES.ASSET_NOT_DECIDED);
        }
        if (!options.rerun) {
          // Like the API: the evidence is completed and every action stays as decided.
          const policy = asset.classification.moderation.policy;
          if (policy?.evidence !== "decision") return asset;
          return this.databaseStorage.updateAsset({
            ...asset,
            updatedAt: this.now(),
            classification: {
              ...asset.classification,
              moderation: {
                ...asset.classification.moderation,
                policy: { ...policy, evidence: "full" },
              },
            },
          });
        }
        if (asset.classification.moderation.manualReviews.length) {
          throw this.apiError(API_ERROR_CODES.ASSET_REVIEWED);
        }
        if (asset.content.status === "removed") {
          throw this.apiError(API_ERROR_CODES.ASSET_CONTENT_UNAVAILABLE);
        }
        // Like the API: back to processing, to be moderated again under the current policy.
        return this.databaseStorage.updateAsset(await this.applyOutcome(asset, "pending"));
      },

      /**
       * Polls the mock's storage like the real client, without real waiting: each pause only
       * advances the mock's clock (yielding to other tasks, which can `decide` meanwhile), so a
       * pending asset fails with `sdk/timeout` at once.
       */
      waitForDecision: async (options: WaitForAssetDecisionOptions): Promise<Asset> => {
        this.begin("assets.waitForDecision", options);
        const { assetId, ...waitOptions } = options;
        return pollForDecision(
          () => this.findOwnAsset(assetId),
          waitOptions,
          async (ms, signal) => {
            await sleep(0, signal);
            this.waitedMs += ms;
          },
          () => this.waitedMs,
        );
      },

      deleteContent: async (options: DeleteAssetContentOptions): Promise<Asset> => {
        this.begin("assets.deleteContent", options);
        const asset = await this.findOwnAsset(options?.assetId);
        await this.imageStorage.deleteContent(asset.id);
        // Like the API: the record and report stay; stored content, extracted text and the
        // placeholder go. Content already removed keeps its reason, and an `asset.content-removed`
        // event is recorded either way.
        const removed =
          asset.content.status === "removed"
            ? asset.content.image?.thumbhash
              ? await this.databaseStorage.updateAsset({
                  ...asset,
                  content: { ...asset.content, image: withoutPlaceholder(asset.content.image) },
                })
              : asset
            : await (async () => {
                const now = this.now();
                return this.databaseStorage.updateAsset({
                  ...asset,
                  content: {
                    ...asset.content,
                    status: "removed",
                    removalReason: "requested",
                    updatedAt: now,
                    extractedText: null,
                    image: withoutPlaceholder(asset.content.image),
                  },
                  updatedAt: now,
                });
              })();
        this.recordLifecycleEvent("asset.content-removed", removed);
        return removed;
      },

      delete: async (options: DeleteAssetOptions): Promise<void> => {
        this.begin("assets.delete", options);
        const asset = await this.findOwnAsset(options?.assetId);
        await this.imageStorage.deleteContent(asset.id);
        await this.databaseStorage.deleteAsset(asset.id);
        this.recordLifecycleEvent("asset.deleted", asset);
      },
    };
  }

  /** Signs real upload tokens with the mock's API key, like the real client, without a request. */
  get uploadTokens() {
    return {
      sign: async (options: SignUploadTokenOptions): Promise<SignedUploadToken> => {
        this.begin("uploadTokens.sign", options);
        return signUploadTokenWithApiKey(this.apiKey, options, {
          now: this.now(),
          nonce: this.createId(),
        });
      },
    };
  }

  get folders() {
    return {
      list: async (options: ListFoldersOptions = {}): Promise<FolderPage> => {
        this.begin("folders.list", options);
        const all = (await this.databaseStorage.listFolders?.(this.projectId)) ?? [];
        const size = options.pageSize ?? MAX_FOLDER_PAGE_SIZE;
        if (typeof size !== "number" || !Number.isFinite(size) || size < 1) {
          throw this.validationError("validation/too-small", "pageSize");
        }
        if (size > MAX_FOLDER_PAGE_SIZE)
          throw this.validationError("validation/too-big", "pageSize");
        const matching = all
          .filter(
            (folder) =>
              ((options.searchAll && options.search) ||
                (folder.parentId ?? null) === (options.parentId ?? null)) &&
              (!options.search || folder.name.toLowerCase().includes(options.search.toLowerCase())),
          )
          .sort((a, b) => {
            // Like the database: names compare by code point, so case matters.
            const byCodePoint = (left: string, right: string) =>
              left < right ? -1 : left > right ? 1 : 0;
            const order =
              (options.sort === "createdAt"
                ? a.createdAt - b.createdAt
                : byCodePoint(a.name, b.name)) || byCodePoint(a.id, b.id);
            return options.direction === "DESC" ? -order : order;
          });
        const start = (options.pageIndex ?? 0) * size;
        const folders = options.resolveOnly ? [] : matching.slice(start, start + size);
        const ids = new Set([
          ...(options.ids ?? []),
          ...(options.parentId ? [options.parentId] : []),
          ...folders.map((folder) => folder.id),
        ]);
        const byId = new Map(all.map((folder) => [folder.id, folder]));
        for (const id of ids) {
          const parent = byId.get(id)?.parentId;
          if (parent) ids.add(parent);
        }
        return {
          folders,
          ancestors: all.filter(
            (folder) => ids.has(folder.id) && !folders.some((item) => item.id === folder.id),
          ),
          hasMore: !options.resolveOnly && matching.length > start + size,
        };
      },

      retrieve: async (options: FolderIdOptions): Promise<Folder> => {
        this.begin("folders.retrieve", options);
        return this.findOwnFolder(options?.folderId);
      },

      create: async (options: CreateFolderOptions): Promise<Folder> => {
        this.begin("folders.create", options);
        if (!options?.name) throw this.invalidPayload("Folder name is required");
        if (options.parentId) await this.findOwnFolder(options.parentId);
        await this.assertUniqueFolderName(options.name, options.parentId ?? null);
        const folder: Folder = {
          id: this.createId(),
          projectId: this.projectId,
          parentId: options.parentId ?? null,
          name: options.name,
          createdAt: this.now(),
          updatedAt: this.now(),
        };
        return this.databaseStorage.createFolder
          ? await this.databaseStorage.createFolder(folder)
          : folder;
      },

      update: async (options: UpdateFolderOptions): Promise<Folder> => {
        this.begin("folders.update", options);
        const { folderId, ...body } = options;
        const folder = await this.findOwnFolder(folderId);
        if (body.name !== undefined && body.name !== folder.name) {
          await this.assertUniqueFolderName(body.name, folder.parentId ?? null, folderId);
        }
        const updated: Folder = {
          ...folder,
          ...(body.name !== undefined ? { name: body.name } : {}),
          updatedAt: this.now(),
        };
        return this.databaseStorage.updateFolder
          ? await this.databaseStorage.updateFolder(updated)
          : updated;
      },

      delete: async (options: FolderIdOptions): Promise<void> => {
        this.begin("folders.delete", options);
        const { folderId } = options;
        await this.findOwnFolder(folderId);
        const assets = await this.databaseStorage.listAssets(this.projectId);
        const hasAssets = assets.some((asset) => asset.folderId === folderId);
        const allFolders = this.databaseStorage.listFolders
          ? await this.databaseStorage.listFolders(this.projectId)
          : [];
        const hasChildren = allFolders.some((f) => f.parentId === folderId);
        if (hasAssets || hasChildren) {
          throw this.apiError(API_ERROR_CODES.FOLDER_NOT_EMPTY, {
            details: { hasAssets, hasChildren },
          });
        }
        await this.databaseStorage.deleteFolder?.(folderId);
      },

      move: async (options: MoveFolderOptions): Promise<Folder> => {
        this.begin("folders.move", options);
        const { folderId, parentId } = options;
        const folder = await this.findOwnFolder(folderId);
        const targetParentId = parentId ?? null;
        if (targetParentId) {
          let candidate: Folder | undefined = await this.findOwnFolder(targetParentId);
          const visited = new Set<string>();
          while (candidate) {
            if (candidate.id === folderId || visited.has(candidate.id)) {
              throw this.apiError(API_ERROR_CODES.FOLDER_PARENT_CYCLE);
            }
            visited.add(candidate.id);
            candidate = candidate.parentId
              ? await this.resolveFolder(candidate.parentId)
              : undefined;
          }
        }
        if (targetParentId !== folder.parentId) {
          await this.assertUniqueFolderName(folder.name, targetParentId, folderId);
        }
        const updated: Folder = { ...folder, parentId: targetParentId, updatedAt: this.now() };
        return this.databaseStorage.updateFolder
          ? await this.databaseStorage.updateFolder(updated)
          : updated;
      },
    };
  }

  async ensureLens(options: EnsureLensOptions): Promise<Lens> {
    this.begin("ensureLens", options);
    if (!options?.identifier) throw invalidArgument("Lens identifier is required");
    return this.ensureLensDefinition(options);
  }

  private ensureLensDefinition(options: EnsureLensOptions): Lens {
    const existing = this.lenses.get(options.identifier);
    if (!existing) {
      const lens: Lens = {
        id: this.createId(),
        projectId: this.projectId,
        userId: null,
        ...options,
        createdAt: this.now(),
        updatedAt: this.now(),
      };
      this.lenses.set(lens.identifier, lens);
      return lens;
    }

    const hasMatchingDefinition =
      existing.name === options.name &&
      (existing.description ?? null) === (options.description ?? null) &&
      existing.type === options.type &&
      existing.active === options.active &&
      stringifyJsonCanonical(existing.transforms ?? null) ===
        stringifyJsonCanonical(options.transforms ?? null);
    if (hasMatchingDefinition && existing.version === options.version) {
      return existing;
    }
    if (options.version > existing.version) {
      const lens = { ...existing, ...options, updatedAt: this.now() };
      this.lenses.set(lens.identifier, lens);
      return lens;
    }
    throw this.apiError(API_ERROR_CODES.LENS_VERSION_CONFLICT, {
      details: {
        currentVersion: existing.version,
        minimumVersion: existing.version + 1,
        requestedVersion: options.version,
      },
    });
  }

  async ensureLenses(options: EnsureLensesOptions): Promise<Lens[]> {
    this.begin("ensureLenses", options);
    if (!Array.isArray(options?.lenses) || options.lenses.length === 0) {
      throw invalidArgument("At least one lens is required");
    }
    if (options.lenses.some((lens) => !lens?.identifier)) {
      throw invalidArgument("Lens identifier is required");
    }
    return options.lenses.map((option) => this.ensureLensDefinition(option));
  }

  /** Replays the first result for a reused idempotency key, like the API. */
  private async withIdempotency(
    operation: MockCalmLensOperation,
    options: SubmitAssetOptions | UploadAssetPartOptions,
    run: () => Promise<Asset>,
  ): Promise<Asset> {
    if (options?.idempotencyKey === undefined) return run();
    // HTTP stacks trim header values, so the API sees the key without surrounding whitespace.
    const key =
      typeof options.idempotencyKey === "string"
        ? options.idempotencyKey.replace(/^[\t\n\r ]+|[\t\n\r ]+$/g, "")
        : undefined;
    if (key === undefined || !isValidIdempotencyKey(key)) {
      throw this.apiError(API_ERROR_CODES.INVALID_IDEMPOTENCY_KEY);
    }
    const fingerprint = `${operation}:${stringifyJsonCanonical(
      JSON.parse(
        JSON.stringify({ ...options, idempotencyKey: key }, (_key, value) => describeBinary(value)),
      ),
    )}`;
    const saved = this.idempotentResults.get(key);
    if (saved) {
      if (saved.fingerprint !== fingerprint) {
        throw this.apiError(API_ERROR_CODES.IDEMPOTENCY_KEY_REUSED);
      }
      return saved.asset;
    }
    const asset = await run();
    this.idempotentResults.set(key, { fingerprint, asset });
    return asset;
  }

  private async moderateAsset(
    options: SubmitAssetOptions,
    operation: MockCalmLensOperation,
  ): Promise<Asset> {
    if (
      options &&
      "content" in options &&
      "plainText" in options.content &&
      (typeof options.content.plainText !== "string" || !options.content.plainText.trim())
    ) {
      throw this.invalidPayload("Text to classify must be a non-empty string");
    }
    return this.withIdempotency(operation, options, () => this.createAsset(options, false));
  }

  private async createAsset(options: SubmitAssetOptions, queue: boolean): Promise<Asset> {
    if (!options || typeof options !== "object") {
      throw invalidArgument("Asset options are required");
    }
    if (!("content" in options) && !("url" in options) && !("part" in options)) {
      throw this.invalidPayload("Either file content, URL, or multipart part is required");
    }
    if (!options.name) throw this.invalidPayload("Asset name is required");
    if (!("part" in options) && "isFinal" in options) {
      throw this.invalidPayload("isFinal is only valid for multipart uploads");
    }
    if ("part" in options && options.part.partNumber && options.part.partNumber > 1) {
      throw this.apiError(API_ERROR_CODES.USE_UPLOAD_PART);
    }
    if ("content" in options) {
      assertDeclaredPayloadSize(options.content);
      this.assertValidUploadMimeType(options.content.type);
      if (!("plainText" in options.content)) {
        const validation = validateAssetPayload(options.content);
        if (!validation.ok) throw this.invalidPayload(validation.error);
      }
    }
    const type = inferAssetType(options);
    if ("part" in options) {
      assertDeclaredPayloadSize(options.part, options.part.sizeInBytes ?? options.sizeInBytes);
      this.assertValidUploadMimeType(options.part.type);
      // Like the API, a declared total is checked before anything is stored, then a single final
      // part is checked as the whole upload, then the part itself.
      const isFinal = options.part.isFinal === true;
      const partSize = this.getSizeInBytes(options) ?? 0;
      const sizeError =
        (options.totalSizeInBytes === undefined
          ? undefined
          : this.multipartImageSizeError(type, options.totalSizeInBytes, true)) ??
        (isFinal
          ? (this.multipartTotalSizeError(options.totalSizeInBytes, partSize, true) ??
            this.multipartImageSizeError(type, partSize, true))
          : undefined);
      if (sizeError) throw this.apiError(sizeError);
      const validation = validateAssetPayload(options.part, { multipart: true, isFinal });
      if (!validation.ok) throw this.invalidPayload(validation.error);
      if (!isFinal) {
        const totalError = this.multipartTotalSizeError(options.totalSizeInBytes, partSize, false);
        if (totalError) throw this.apiError(totalError);
      }
    }
    if (options.folderId) await this.findOwnFolder(options.folderId);
    if (options.externalId) {
      const assets = await this.databaseStorage.listAssets(this.projectId);
      if (assets.some((asset) => asset.externalId === options.externalId)) {
        throw this.apiError(API_ERROR_CODES.DUPLICATE_EXTERNAL_ID);
      }
    }

    const id = this.createId();
    const now = this.now();
    const isOpenUpload = "part" in options && !options.part.isFinal;
    const processingOptions = options.processingOptions ?? { keepContentAfterProcessing: false };
    const keepContent = processingOptions.keepContentAfterProcessing === true;
    // Fields the API returns as `null` when they are not set.
    const asset: Asset = {
      id,
      projectId: this.projectId,
      userId: null,
      parentId: null,
      folderId: options.folderId ?? null,
      uploadPresetId: options.uploadPresetId ?? null,
      createdAt: now,
      updatedAt: now,
      name: options.name,
      description: options.description ?? null,
      externalId: options.externalId ?? null,
      externalUrl:
        ("url" in options ? options.url : "content" in options ? options.externalUrl : undefined) ??
        null,
      type,
      metadata: options.metadata ?? null,
      tags: null,
      processingOptions,
      visibility: options.visibility ?? "private",
      content: {
        status: keepContent ? "stored" : "temporary",
        removalReason: null,
        updatedAt: now,
        safetyHold: null,
        format: this.getContentFormat(options),
        extension: null,
        sizeInBytes: this.getSizeInBytes(options) ?? null,
        checksums: null,
        image: null,
        extractedText: null,
      },
      upload: {
        status: isOpenUpload ? "uploading" : "completed",
        updatedAt: now,
        // Like the API, only an open upload counts the parts received.
        partsReceived: isOpenUpload ? (options.part.partNumber ?? 1) : null,
      },
      classification: {
        status: isOpenUpload ? "pending" : "processing",
        updatedAt: now,
        completedAt: null,
        moderation: {
          status: "pending",
          manualReviews: [],
        },
      },
    };

    if ("content" in options) {
      await this.imageStorage.putContent(
        id,
        "plainText" in options.content
          ? {
              uint8Array: new TextEncoder().encode(options.content.plainText),
              type: options.content.type,
            }
          : options.content,
      );
    } else if ("part" in options) {
      await this.imageStorage.putPart(id, options.part);
      if (isOpenUpload) {
        this.openUploads.set(id, { queue, totalSizeInBytes: options.totalSizeInBytes });
      }
    }

    return this.databaseStorage.createAsset(
      isOpenUpload ? asset : await this.applyOutcome(asset, this.outcomeFor(asset, queue)),
    );
  }

  /** Like the API: image uploads in parts total 10 MiB (checked at the last part) to 20 MiB. */
  private multipartImageSizeError(
    type: string,
    sizeInBytes: number,
    isFinal: boolean,
  ): ApiErrorCode | undefined {
    if (type !== "image") return undefined;
    if (sizeInBytes > MAX_IMAGE_UPLOAD_BYTES) return API_ERROR_CODES.MULTIPART_IMAGE_TOO_LARGE;
    if (isFinal && sizeInBytes < MIN_MULTIPART_IMAGE_UPLOAD_BYTES) {
      return API_ERROR_CODES.MULTIPART_IMAGE_TOO_SMALL;
    }
    return undefined;
  }

  /** Like the API: the parts may not overshoot a declared total, and must reach it at the end. */
  private multipartTotalSizeError(
    totalSizeInBytes: number | undefined,
    receivedSizeInBytes: number,
    isFinal: boolean,
  ): ApiErrorCode | undefined {
    if (totalSizeInBytes === undefined) return undefined;
    return receivedSizeInBytes > totalSizeInBytes ||
      (isFinal && receivedSizeInBytes !== totalSizeInBytes)
      ? API_ERROR_CODES.UPLOAD_SIZE_MISMATCH
      : undefined;
  }

  private outcomeFor(asset: Asset, queue: boolean): MockAssetOutcome {
    const outcome = queue ? this.queuedOutcome : this.analyzedOutcome;
    return typeof outcome === "function" ? outcome(asset) : outcome;
  }

  /**
   * Moves an asset to `outcome` like the pipeline would: a decision finishes processing, `purged`
   * deletes the content (with `purgeReason`, `policy` for the pipeline), and finished processing
   * removes content kept only temporarily (`keepContentAfterProcessing` off). A classified image
   * gets a ThumbHash for its placeholder, which goes with purged content.
   */
  private async applyOutcome(
    asset: Asset,
    outcome: MockAssetOutcome,
    purgeReason: "policy" | "requested" = "policy",
  ): Promise<Asset> {
    const now = this.now();
    const decided = outcome !== "pending" && outcome !== "failed";
    const classificationStatus = decided
      ? "completed"
      : outcome === "failed"
        ? "failed"
        : "processing";
    const purge = outcome === "purged" && asset.content.status !== "removed";
    const removeContent =
      purge || (classificationStatus === "completed" && asset.content.status === "temporary");
    if (removeContent) await this.imageStorage.deleteContent(asset.id);
    const classifiedImage =
      decided && asset.type === "image" && asset.content.status !== "removed" && !purge;
    // Like the API, removing content (when processing finishes or by purging) removes the
    // ThumbHash and average colour with it, so no placeholder outlives the content.
    const image = classifiedImage
      ? {
          width: null,
          height: null,
          perceptualHash: null,
          ...asset.content.image,
          thumbhash: MOCK_THUMBHASH,
          averageColor: asset.content.image?.averageColor ?? "#7f7f7f",
        }
      : outcome === "purged"
        ? withoutPlaceholder(asset.content.image)
        : asset.content.image;
    return {
      ...asset,
      updatedAt: now,
      content: removeContent
        ? {
            ...asset.content,
            status: "removed",
            removalReason: purge ? purgeReason : "retention",
            updatedAt: now,
            extractedText: null,
            image: withoutPlaceholder(image),
          }
        : { ...asset.content, image },
      upload: { ...asset.upload, status: "completed", updatedAt: now },
      classification: {
        ...asset.classification,
        status: classificationStatus,
        updatedAt: now,
        completedAt: decided ? now : null,
        moderation: { ...asset.classification.moderation, status: decided ? outcome : "pending" },
      },
    };
  }

  /** Adds an `asset.deleted`, `asset.content-removed` or `asset.retried` event, like the API. */
  private recordLifecycleEvent(
    type: "asset.deleted" | "asset.content-removed" | "asset.retried",
    asset: Asset,
  ): void {
    this.enqueueEvent({
      type,
      severity: "low",
      assetId: asset.id,
      asset: toEventAsset(asset),
      facts: [
        {
          key: "asset-name",
          value: asset.name,
          // A deleted asset has no portal page to link to.
          ...(type === "asset.deleted" ? {} : { url: `/portal/assets/${asset.id}` }),
        },
        { key: "asset-type", value: asset.type },
      ],
    } as MockEventInput);
  }

  private async resolveFolder(folderId: string): Promise<Folder | undefined> {
    if (!this.databaseStorage.getFolder) return undefined;
    const folder = await this.databaseStorage.getFolder(folderId);
    if (!folder || folder.projectId !== this.projectId) {
      return undefined;
    }
    return folder;
  }

  private async findOwnFolder(folderId: string): Promise<Folder> {
    encodePathSegment(folderId, "Folder ID");
    const folder = await this.resolveFolder(folderId);
    if (!folder) throw this.apiError(API_ERROR_CODES.FOLDER_NOT_FOUND);
    return folder;
  }

  private async assertUniqueFolderName(
    name: string,
    parentId: string | null,
    excludeFolderId?: string,
  ): Promise<void> {
    const folders = this.databaseStorage.listFolders
      ? await this.databaseStorage.listFolders(this.projectId)
      : [];
    const duplicate = folders.find(
      (f) => f.id !== excludeFolderId && f.parentId === (parentId ?? null) && f.name === name,
    );
    if (duplicate) {
      throw this.apiError(API_ERROR_CODES.DUPLICATE_FOLDER_NAME, {
        message: `A folder named "${name}" already exists in this location.`,
      });
    }
  }

  private getContentFormat(options: SubmitAssetOptions): string | null {
    if ("content" in options) return options.content.type;
    if ("part" in options) return options.part.type;
    return null;
  }

  private getSizeInBytes(options: SubmitAssetOptions): number | undefined {
    if ("content" in options) {
      if ("plainText" in options.content) {
        return new TextEncoder().encode(options.content.plainText).byteLength;
      }
      return getAssetPayloadByteLength(options.content);
    }
    if ("part" in options) {
      return (
        options.part.sizeInBytes ?? options.sizeInBytes ?? getAssetPayloadByteLength(options.part)
      );
    }
    return undefined;
  }
}
