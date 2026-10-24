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
import { permits } from "../contract/Permissions.js";
import type {
  GetEventsResponse,
  PostAssetSignedUrlResponse,
} from "../contract/PublicApiSchemas.js";
import {
  getRejectedUploadMimeTypeError,
  isRejectedUploadMimeType,
} from "../contract/SharedConstants.js";
import { getMockApiKeyGrants } from "./MockApiKey";
import {
  InMemoryMockDatabaseStorage,
  InMemoryMockImageStorage,
  type MockDatabaseStorage,
  type MockImageStorage,
} from "./MockStorage";
import { createPage, filterAssets, inferAssetType } from "./MockUtils";

const DEFAULT_EVENTS_LIMIT = 50;

/** Stands in for binary payloads when comparing idempotent requests, like the API's size check. */
const describeBinary = (value: unknown) => {
  if (value instanceof Blob) return `[blob:${value.size}]`;
  if (value instanceof ArrayBuffer) return `[bytes:${value.byteLength}]`;
  if (ArrayBuffer.isView(value)) return `[bytes:${value.byteLength}]`;
  return value;
};
const MAX_EVENTS_LIMIT = 100;

export interface MockCalmLensServerClientOptions extends CalmLensServerClientOptions {
  mockOptions?: {
    databaseStorage?: MockDatabaseStorage;
    imageStorage?: MockImageStorage;
    createId?: () => string;
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
 * Where a mock upload ends up: `pending` (still processing), `allowed`, `age-restricted`, `blocked`
 * or `purged` (processing done with that moderation status; `purged` also removes the content),
 * or `failed` (processing failed, retryable).
 */
export type MockAssetOutcome =
  | "pending"
  | "allowed"
  | "age-restricted"
  | "blocked"
  | "purged"
  | "failed";

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
 * deadline (`sdk/timeout`); any `Error` is thrown as given.
 */
export type MockRequestFailure = "transport-error" | "timeout" | Error;

/** An event to add to the mock feed; omitted fields get defaults. */
export type MockEventInput = Partial<Omit<TypedEvent, "type">> & { type: TypedEvent["type"] };

const toFailureError = (failure: MockRequestFailure): Error => {
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
  private readonly apiKeyGrants: ReturnType<typeof getMockApiKeyGrants>;
  private readonly signedUrlBaseUrl: string;
  private readonly cdnBaseUrl: string;
  private readonly projectId: string;
  private readonly apiKey: string;
  private readonly lenses = new Map<string, Lens>();
  private readonly eventFeed: TypedEvent[] = [];
  /** The queue mode each open multipart upload was started with, as the API saves it. */
  private readonly uploadQueues = new Map<string, boolean>();
  private readonly idempotentResults = new Map<string, { fingerprint: string; asset: Asset }>();
  private requestCount = 0;
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
    this.now = options.mockOptions?.now ?? Date.now;
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
      throw toFailureError(pending!.failure);
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
       * `ETag` and `X-Request-Id`, or a JSON error body with `404`/`403`. Never throws for
       * HTTP errors, like the real client.
       */
      serve: async (serveOptions: CdnServeOptions): Promise<Response> => {
        this.begin("cdn.serve", serveOptions);
        const { assetIdentifier, init, ...options } = serveOptions;
        const url = this.cdn.getAssetUrl({ assetIdentifier, ...options });

        const assets = await this.databaseStorage.listAssets(this.projectId);
        const asset = assets.find(
          (asset) => asset.id === assetIdentifier || asset.externalId === assetIdentifier,
        );
        const notFound = () =>
          this.jsonResponse(404, { code: "asset/not-found", message: "Asset not found" }, url);
        if (!asset) return notFound();

        // A placeholder is served whatever the moderation status; everything else follows it.
        const status = asset.classification.moderation.status;
        const isPlaceholder = options.resource === "placeholder";
        const isPrivate =
          asset.visibility !== "public" ||
          (!isPlaceholder && status === "age-restricted" && !options.allowAgeRestricted);
        if (
          isPrivate &&
          !permits(
            this.apiKeyGrants,
            "assets:download",
            asset.folderId ?? null,
            (await this.databaseStorage.listFolders?.(this.projectId)) ?? [],
          )
        ) {
          return this.jsonResponse(
            403,
            {
              code: "asset/api-key-missing-permission",
              message: "This API key needs assets:download permission for this asset’s folder.",
            },
            url,
          );
        }

        const storedContent = await this.imageStorage.getContent(asset.id);
        if (!storedContent) return notFound();
        if (!isPlaceholder && status === "blocked") {
          return this.jsonResponse(
            403,
            { code: "asset/not-available", message: "This asset is not available" },
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
        const requestId = `mock-request-${++this.requestCount}`;
        const isHead = init?.method?.toUpperCase() === "HEAD";
        const response = new Response(isHead ? null : bytes, {
          status: 200,
          headers: {
            "Content-Type": storedContent.type ?? "application/octet-stream",
            "Content-Length": String(byteLength),
            "Cache-Control": isPrivate ? "private, no-store" : "public, max-age=31536000",
            ETag: `"${asset.id}-${asset.updatedAt}"`,
            "X-Request-Id": requestId,
            "X-Mock-CalmLens-CDN-URL": url,
          },
        });
        Object.defineProperty(response, "url", { value: url });
        return response;
      },
    };
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
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_EVENTS_LIMIT) {
      throw this.apiError(API_ERROR_CODES.INVALID_UPLOAD_PAYLOAD, {
        message: `limit must be an integer from 1 to ${MAX_EVENTS_LIMIT}`,
      });
    }
    if (!options.after) {
      return { events: [], cursor: `mock_${this.eventFeed.length}`, hasMore: false };
    }
    const match = /^mock_(\d+)$/.exec(options.after);
    const position = match ? Number(match[1]) : Number.NaN;
    if (!Number.isSafeInteger(position) || position > this.eventFeed.length) {
      throw this.apiError(API_ERROR_CODES.INVALID_EVENT_CURSOR);
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
       * Matches `query` (case-insensitively) against each asset's name, ID, external ID,
       * description and tags, best match first. Mock scores are 1 for an exact match and 0.5
       * otherwise; `mode` is accepted but there is no semantic search.
       */
      search: async (options: SearchAssetsOptions): Promise<AssetSearchResponse> => {
        this.begin("assets.search", options);
        const query = typeof options?.query === "string" ? options.query.trim() : "";
        if (!query || query.length > 200) {
          throw this.invalidPayload("query must be 1 to 200 characters");
        }
        const limit = options.limit ?? 10;
        const needle = query.toLowerCase();
        const fields = ["name", "id", "externalId", "description"] as const;
        const items = (await this.databaseStorage.listAssets(this.projectId))
          .map((asset) => {
            const matchedFields: AssetSearchResponse["items"][number]["matchedFields"] = [];
            for (const field of fields) {
              if (
                String(asset[field] ?? "")
                  .toLowerCase()
                  .includes(needle)
              ) {
                matchedFields.push(field);
              }
            }
            if (asset.tags?.some((tag) => tag.toLowerCase().includes(needle))) {
              matchedFields.push("tags");
            }
            const exact = fields.some(
              (field) => String(asset[field] ?? "").toLowerCase() === needle,
            );
            return { asset, score: exact ? 1 : 0.5, matchedFields };
          })
          .filter((result) => result.matchedFields.length > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, limit);
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
        return createPage(assets, options);
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
        encodePathSegment(assetId, "Asset ID");
        const assets = await this.databaseStorage.listAssets(this.projectId);
        return createPage(
          assets.filter((asset) => asset.parentId === assetId),
          options,
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
          const asset = await this.findOwnAsset(assetId);
          const validation = validateAssetPayload(part, {
            multipart: true,
            isFinal: part.isFinal,
          });
          if (!validation.ok) throw this.invalidPayload(validation.error);
          if (asset.upload.status !== "uploading") {
            throw this.apiError(API_ERROR_CODES.UPLOAD_NOT_OPEN);
          }
          const expectedPartNumber = (asset.upload.partsReceived ?? 1) + 1;
          if (part.partNumber !== expectedPartNumber) {
            throw this.apiError(API_ERROR_CODES.INVALID_UPLOAD_PART_NUMBER, {
              details: { expectedPartNumber },
            });
          }

          await this.imageStorage.putPart(assetId, part);
          const queue = options.queue ?? this.uploadQueues.get(assetId) ?? false;
          if (part.isFinal) this.uploadQueues.delete(assetId);
          const now = this.now();
          const received: Asset = {
            ...asset,
            updatedAt: now,
            upload: { ...asset.upload, updatedAt: now, partsReceived: part.partNumber },
          };
          return this.databaseStorage.updateAsset(
            part.isFinal
              ? await this.applyOutcome(received, this.outcomeFor(received, queue))
              : received,
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
        if (asset.classification.status !== "failed") {
          throw this.apiError(API_ERROR_CODES.ASSET_NOT_RETRYABLE);
        }
        if (asset.content.status === "removed") {
          throw this.apiError(API_ERROR_CODES.ASSET_CONTENT_UNAVAILABLE);
        }
        // Like the API: back to processing, to be moderated again.
        return this.databaseStorage.updateAsset(await this.applyOutcome(asset, "pending"));
      },

      /** Waits like the real client, checking the mock's storage for a decision. */
      waitForDecision: async (options: WaitForAssetDecisionOptions): Promise<Asset> => {
        this.begin("assets.waitForDecision", options);
        const { assetId, ...waitOptions } = options;
        return pollForDecision(() => this.findOwnAsset(assetId), waitOptions, sleep);
      },

      deleteContent: async (options: DeleteAssetContentOptions): Promise<Asset> => {
        this.begin("assets.deleteContent", options);
        const asset = await this.findOwnAsset(options?.assetId);
        await this.imageStorage.deleteContent(asset.id);
        // Like the API: the record and report stay; stored content and extracted text go.
        const now = this.now();
        return this.databaseStorage.updateAsset({
          ...asset,
          content:
            asset.content.status === "removed"
              ? asset.content
              : {
                  ...asset.content,
                  status: "removed",
                  removalReason: "requested",
                  updatedAt: now,
                  extractedText: null,
                },
          updatedAt: now,
        });
      },

      delete: async (options: DeleteAssetOptions): Promise<void> => {
        this.begin("assets.delete", options);
        const asset = await this.findOwnAsset(options?.assetId);
        await this.imageStorage.deleteContent(asset.id);
        await this.databaseStorage.deleteAsset(asset.id);
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
        const size = options.pageSize ?? 100;
        if (size < 1 || size > 100) throw this.invalidPayload("Invalid folder page size");
        const matching = all
          .filter(
            (folder) =>
              ((options.searchAll && options.search) ||
                (folder.parentId ?? null) === (options.parentId ?? null)) &&
              (!options.search || folder.name.toLowerCase().includes(options.search.toLowerCase())),
          )
          .sort((a, b) => {
            const order =
              (options.sort === "createdAt"
                ? a.createdAt - b.createdAt
                : a.name.localeCompare(b.name)) || a.id.localeCompare(b.id);
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
    const key = options?.idempotencyKey;
    if (key === undefined) return run();
    if (!key || key.length > 255 || !/^[\x21-\x7e]+$/.test(key)) {
      throw this.apiError(API_ERROR_CODES.INVALID_IDEMPOTENCY_KEY);
    }
    const fingerprint = `${operation}:${stringifyJsonCanonical(
      JSON.parse(JSON.stringify(options, (_key, value) => describeBinary(value))),
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
    if ("part" in options) {
      assertDeclaredPayloadSize(options.part, options.part.sizeInBytes ?? options.sizeInBytes);
      this.assertValidUploadMimeType(options.part.type);
      const validation = validateAssetPayload(options.part, {
        multipart: true,
        isFinal: options.part.isFinal,
      });
      if (!validation.ok) throw this.invalidPayload(validation.error);
    }
    if (options.externalId) {
      const assets = await this.databaseStorage.listAssets(this.projectId);
      if (assets.some((asset) => asset.externalId === options.externalId)) {
        throw this.apiError(API_ERROR_CODES.DUPLICATE_EXTERNAL_ID);
      }
    }

    const id = this.createId();
    const now = this.now();
    const isOpenUpload = "part" in options && !options.part.isFinal;
    const keepContent = options.processingOptions?.keepContentAfterProcessing === true;
    const asset: Asset = {
      id,
      projectId: this.projectId,
      folderId: options.folderId ?? null,
      createdAt: now,
      updatedAt: now,
      name: options.name,
      description: options.description,
      externalId: options.externalId,
      externalUrl:
        "url" in options ? options.url : "content" in options ? options.externalUrl : undefined,
      type: inferAssetType(options),
      metadata: options.metadata,
      processingOptions: options.processingOptions,
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
        previewImage: null,
        extractedText: null,
      },
      upload: {
        status: isOpenUpload ? "uploading" : "completed",
        updatedAt: now,
        partsReceived: "part" in options ? (options.part.partNumber ?? 1) : null,
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
      if (!("plainText" in options.content)) {
        await this.imageStorage.putContent(id, options.content);
      }
    } else if ("part" in options) {
      await this.imageStorage.putPart(id, options.part);
      if (isOpenUpload) this.uploadQueues.set(id, queue);
    }

    return this.databaseStorage.createAsset(
      isOpenUpload ? asset : await this.applyOutcome(asset, this.outcomeFor(asset, queue)),
    );
  }

  private outcomeFor(asset: Asset, queue: boolean): MockAssetOutcome {
    const outcome = queue ? this.queuedOutcome : this.analyzedOutcome;
    return typeof outcome === "function" ? outcome(asset) : outcome;
  }

  /**
   * Moves an asset to `outcome` like the pipeline would: a decision finishes processing, `purged`
   * deletes the content, and finished processing removes content kept only temporarily
   * (`keepContentAfterProcessing` off).
   */
  private async applyOutcome(asset: Asset, outcome: MockAssetOutcome): Promise<Asset> {
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
    return {
      ...asset,
      updatedAt: now,
      content: removeContent
        ? {
            ...asset.content,
            status: "removed",
            removalReason: purge ? "policy" : "retention",
            updatedAt: now,
            extractedText: null,
          }
        : asset.content,
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
