import { CalmLensError, invalidArgument, SDK_ERROR_CODES } from "../client/CalmLensError";
import {
  API_ERROR_CODES,
  API_ERROR_DEFINITIONS,
  type ApiErrorCode,
} from "../client/CalmLensErrorCodes";
import type {
  Asset,
  AssetType,
  HashList,
  HashListEntry,
  HashListEntryPage,
  Lens,
} from "../client/CalmLensTypes";
import { validateAssetPayload } from "../contract/AssetPayload.js";
import type { TypedEvent } from "../contract/Event.js";
import type { Folder } from "../contract/Folder.js";
import { type IdPrefix, isId } from "../contract/Ids.js";
import { stringifyJsonCanonical } from "../contract/JsonUtils.js";
import {
  type ModerationContextItem,
  selectModerationContextItems,
} from "../contract/ModerationContextLimits.js";
import { type PermissionGrant, permits } from "../contract/Permissions.js";
import { placeholderHashToDataURL } from "../contract/PlaceholderHashDecode.js";
import {
  getRejectedUploadMimeTypeError,
  isRejectedUploadMimeType,
  MAX_IMAGE_UPLOAD_BYTES,
  MIN_MULTIPART_IMAGE_UPLOAD_BYTES,
} from "../contract/SharedConstants.js";
import { isFileAccepted } from "../ui/UploadController";
import type { MockDatabaseStorage, MockImageStorage } from "./MockStorage";
import { createPage, filterAssets, searchAssets } from "./MockUtils";

// The in-memory CalmLens API and CDN behind the mock clients. The mocks run the real clients,
// whose `fetch` is `MockCalmLensApi.handle`: every request is answered here with the API's
// statuses, JSON bodies, error bodies and headers.

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

/**
 * A client method, named like its path on the client. A request is recorded under the first
 * method that sends it; `callsTo` and `failNextRequest` also match the others (see
 * `MockCalmLensCall`).
 */
export type MockCalmLensOperation =
  | "assets.list"
  | "assets.iterate"
  | "assets.search"
  | "assets.retrieve"
  | "assets.waitForDecision"
  | "assets.update"
  | "assets.listChildren"
  | "assets.iterateChildren"
  | "assets.create"
  | "assets.classify"
  | "assets.uploadPart"
  | "assets.createSignedUrl"
  | "assets.move"
  | "assets.retry"
  | "assets.explain"
  | "assets.deleteContent"
  | "assets.delete"
  | "assets.batch"
  | "text.classify"
  | "cdn.serve"
  | "events.list"
  | "events.pages"
  | "folders.list"
  | "folders.retrieve"
  | "folders.create"
  | "folders.update"
  | "folders.delete"
  | "folders.move"
  | "hashLists.list"
  | "hashLists.retrieve"
  | "hashLists.create"
  | "hashLists.update"
  | "hashLists.delete"
  | "hashLists.listEntries"
  | "hashLists.addEntry"
  | "hashLists.removeEntry"
  | "ensureLens"
  | "ensureLenses";

/**
 * One request a mock client sent, as the in-memory API received it. `operation` is the client
 * method that sends it; requests several methods send are recorded under the first: `text.classify`
 * as `assets.classify`, `ensureLens` as `ensureLenses`, `assets.waitForDecision` polls as
 * `assets.retrieve`, `assets.iterate` pages as `assets.list`, and so on. `callsTo` matches all of
 * them. Methods that send nothing, such as `uploadTokens.sign` or a cached `ensureLens`, are not
 * recorded.
 */
export interface MockCalmLensCall {
  operation: MockCalmLensOperation;
  method: string;
  /** The request URL. */
  url: string;
  /** The path after the API (or CDN) base URL, with each segment decoded, such as `/assets/a1`. */
  path: string;
  /** Query parameters as sent, such as `{ "ordering[0][field]": "createdAt" }`. */
  query: Record<string, string>;
  /** Request headers, with lowercase names. */
  headers: Record<string, string>;
  /** The JSON body, the text of a `text/*` upload, the bytes of another upload, or `undefined`. */
  body: unknown;
  /** The HTTP status the mock answered with, or `undefined` when the request failed without one. */
  status: number | undefined;
}

/**
 * What a simulated request failure does: `"transport-error"` and `"timeout"` fail the request
 * like a network failure (`sdk/transport-error`) or a deadline (`sdk/timeout`); an API error
 * code, such as `"upload/limit-exceeded"`, answers with that API error and its HTTP status; a
 * `CalmLensError` is thrown as is and any other `Error` as the cause of `sdk/transport-error`,
 * like an exception from `fetch`.
 */
export type MockRequestFailure = "transport-error" | "timeout" | ApiErrorCode | Error;

/** An event to add to the mock feed; omitted fields get defaults. */
export type MockEventInput = Partial<Omit<TypedEvent, "type">> & { type: TypedEvent["type"] };

/** The upload preset settings a `MockCalmLensAppClient` applies, as the API would. */
export interface MockUploadPreset {
  /** Refuse uploads without a token, like **Users your server approves**. Defaults to `false`. */
  requireToken?: boolean;
  /** Accepted content types, such as `["image/*"]`. Defaults to any type. */
  allowedContentTypes?: string[];
  maxFileSizeInBytes?: number;
  /** Return `status` to the uploader. Defaults to `true`. */
  showDecisions?: boolean;
  /** Defaults to `public`. */
  visibility?: "public" | "private";
  /** Defaults to `true`, so the CDN can serve the upload. */
  keepContentAfterProcessing?: boolean;
  folderId?: string | null;
}

export interface MockCalmLensApiOptions {
  projectId: string;
  apiKey: string;
  grants: PermissionGrant[];
  databaseStorage: MockDatabaseStorage;
  imageStorage: MockImageStorage;
  /** A new ID for an object of the kind `prefix` names, such as `asset`. */
  createId: (prefix: IdPrefix) => string;
  now: () => number;
  queuedOutcome: MockAssetOutcome | ((asset: Asset) => MockAssetOutcome);
  analyzedOutcome: MockAssetOutcome | ((asset: Asset) => MockAssetOutcome);
  signedUrlBaseUrl: string;
}

/**
 * The upload preset an app client uploads through, and the uploads it made: like a browser
 * session, an app client can check and continue only its own uploads.
 */
export interface MockAppSession {
  preset: MockUploadPreset;
  uploads: Set<string>;
}

/** A lens as `ensureLenses` sends it. */
type LensDefinition = Omit<Lens, "id" | "projectId" | "userId" | "createdAt" | "updatedAt">;

/** Where a client sends its requests: the API and CDN base URLs, without trailing slashes. */
export interface MockEndpoints {
  baseUrl: string;
  cdnBaseUrl: string;
}

const DEFAULT_EVENTS_LIMIT = 50;
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

/** An asset's type from its content type, or `website` for a URL. */
const inferAssetType = (contentType: string | undefined): AssetType => {
  if (contentType === undefined) return "website";
  const type = contentType.toLowerCase();
  if (type.startsWith("image/")) return "image";
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  if (type.startsWith("text/")) return "plaintext-document";
  if (type.includes("pdf") || type.includes("document")) return "multimedia-document";
  return "file";
};

/** The API's answer to a request it refuses: thrown by handlers, sent as a JSON error body. */
class ApiFailure {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly message: string,
    readonly details?: Record<string, unknown>,
  ) {}
}

const fail = (
  code: ApiErrorCode,
  { message, details }: { message?: string; details?: Record<string, unknown> } = {},
) =>
  new ApiFailure(
    API_ERROR_DEFINITIONS[code].status,
    code,
    message ?? API_ERROR_DEFINITIONS[code].message,
    details,
  );

/** A request the API's schema refuses: `validation/<zod issue>` with HTTP 400 and the field. */
const invalidField = (code: string, path: string) =>
  new ApiFailure(400, code, `Invalid ${path}`, { path });

/** A request as the in-memory API reads it. */
interface MockRequest {
  method: string;
  url: string;
  /** Decoded path segments after the base URL. */
  segments: string[];
  query: URLSearchParams;
  headers: Headers;
  bytes: Uint8Array<ArrayBuffer>;
  cdn: boolean;
}

/** What a handler answers: the success status and the JSON body. */
type Answer = [status: number, body: unknown];

/** The client methods that send a request, the one it is recorded under first. */
const operationsOf = (request: MockRequest): MockCalmLensOperation[] => {
  const { method, segments, query, cdn } = request;
  if (cdn) return ["cdn.serve"];
  const [root] = segments;
  if (root === "projects") {
    const route = segments.slice(2).join("/");
    switch (route) {
      case "events":
        return ["events.list", "events.pages"];
      case "lenses":
        return ["ensureLenses", "ensureLens"];
      case "folders":
        return method === "GET" ? ["folders.list"] : ["folders.create"];
      case "hash-lists":
        return method === "GET" ? ["hashLists.list"] : ["hashLists.create"];
      case "assets/page":
        return ["assets.list", "assets.iterate"];
      case "assets/search":
        return ["assets.search"];
      case "assets/batch":
        return ["assets.batch"];
      case "assets":
        if (query.get("queue") === "true") return ["assets.create"];
        return isTextUpload(request) ? ["assets.classify", "text.classify"] : ["assets.classify"];
    }
    return [];
  }
  if (root === "upload-presets") {
    // App clients: `/upload-presets/:id/assets[/:assetId[/part]]`.
    if (segments[3] === undefined) {
      return [query.get("queue") === "true" ? "assets.create" : "assets.classify"];
    }
    return segments[4] === "part" ? ["assets.uploadPart"] : ["assets.retrieve"];
  }
  const id = segments[1];
  const action = segments[2];
  if (root === "folders" && id !== undefined) {
    if (action === "move") return ["folders.move"];
    return method === "GET"
      ? ["folders.retrieve"]
      : method === "PATCH"
        ? ["folders.update"]
        : ["folders.delete"];
  }
  if (root === "hash-lists" && id !== undefined) {
    if (action === "entries") {
      return method === "GET" ? ["hashLists.listEntries"] : ["hashLists.addEntry"];
    }
    return method === "GET"
      ? ["hashLists.retrieve"]
      : method === "PATCH"
        ? ["hashLists.update"]
        : ["hashLists.delete"];
  }
  if (root === "hash-list-entries" && id !== undefined) return ["hashLists.removeEntry"];
  if (root !== "assets" || id === undefined) return [];
  switch (action) {
    case undefined:
      return method === "GET"
        ? ["assets.retrieve", "assets.waitForDecision"]
        : method === "PATCH"
          ? ["assets.update"]
          : ["assets.delete"];
    case "content":
      return ["assets.deleteContent"];
    case "children":
      return ["assets.listChildren", "assets.iterateChildren"];
    case "signed-url":
      return ["assets.createSignedUrl"];
    case "part":
      return ["assets.uploadPart"];
    case "move":
      return ["assets.move"];
    case "retry":
      return ["assets.retry"];
    case "explain":
      return ["assets.explain"];
  }
  return [];
};

const isTextUpload = (request: MockRequest) =>
  request.headers.get("x-calmlens-upload") === "content" &&
  request.headers.get("content-type") === "text/plain";

/** Like the API: a new folder is 201 Created, a queued batch 202 Accepted, everything else 200. */
const SUCCESS_STATUS: Partial<Record<MockCalmLensOperation, number>> = {
  "folders.create": 201,
  "hashLists.create": 201,
  "assets.batch": 202,
};

const decodeSegment = (segment: string) => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
};

/** The upload fields of a create request, from its query (raw uploads) or JSON body (URLs). */
interface UploadFields {
  name: string;
  description?: string;
  processingOptions?: Asset["processingOptions"];
  visibility?: Asset["visibility"];
  metadata?: Asset["metadata"];
  authorId?: string;
  context?: { items: ModerationContextItem[] };
  externalId?: string;
  externalUrl?: string;
  folderId?: string;
  uploadPresetId?: string;
  /** The website to fetch, for URL submissions. */
  url?: string;
  contentType?: string;
  bytes?: Uint8Array<ArrayBuffer>;
  part?: { partNumber: number; isFinal: boolean; totalSizeInBytes?: number };
}

const createMonotonicClock = () => {
  let last = 0;
  return () => {
    last = Math.max(Date.now(), last + 1);
    return last;
  };
};

export { createMonotonicClock };

/**
 * The in-memory CalmLens API and CDN one or more mock clients share: storage, events, lenses,
 * idempotency keys, upload presets, the API key's grants, queued failures and recorded requests.
 */
export class MockCalmLensApi {
  readonly projectId: string;
  readonly apiKey: string;
  readonly databaseStorage: MockDatabaseStorage;
  readonly imageStorage: MockImageStorage;
  readonly createId: (prefix: IdPrefix) => string;
  readonly now: () => number;
  grants: PermissionGrant[];
  readonly calls: Array<{ call: MockCalmLensCall; operations: MockCalmLensOperation[] }> = [];
  private readonly options: MockCalmLensApiOptions;
  private readonly lenses = new Map<string, Lens>();
  private readonly eventFeed: TypedEvent[] = [];
  /** What each open multipart upload was started with, as the API saves it. */
  private readonly openUploads = new Map<string, { queue: boolean; totalSizeInBytes?: number }>();
  private readonly idempotentResults = new Map<
    string,
    { fingerprint: string; status: number; body: string }
  >();
  private readonly pendingFailures: Array<{
    failure: MockRequestFailure;
    operation?: MockCalmLensOperation;
  }> = [];
  private requestCount = 0;
  /** Time the clients have spent waiting: mock waits advance it instead of sleeping. */
  waitedMs = 0;

  constructor(options: MockCalmLensApiOptions) {
    this.options = options;
    this.projectId = options.projectId;
    this.apiKey = options.apiKey;
    this.grants = options.grants;
    this.databaseStorage = options.databaseStorage;
    this.imageStorage = options.imageStorage;
    this.createId = options.createId;
    this.now = options.now;
  }

  /** Queues a failure for the next request, or the next one `operation` sends. */
  failNextRequest(failure: MockRequestFailure, operation?: MockCalmLensOperation): void {
    this.pendingFailures.push({ failure, operation });
  }

  /** A `fetch` that answers a client's requests from memory; app clients pass their session. */
  createFetch(endpoints: () => MockEndpoints, session?: MockAppSession): typeof fetch {
    return ((input: RequestInfo | URL, init?: RequestInit) =>
      this.handle(input, init, endpoints(), session)) as typeof fetch;
  }

  // ---- Mock helpers ------------------------------------------------------------------------

  /**
   * Adds an event to the feed `events.list` reads, as if CalmLens had recorded it, and returns
   * the stored event.
   */
  enqueueEvent(input: MockEventInput): TypedEvent {
    const now = this.now();
    const event = {
      id: this.createId("evt"),
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

  /** Applies a reviewer's decision to a stored asset (see `MockCalmLensServerClient.decide`). */
  async decide(assetId: string, decision: MockReviewDecision): Promise<Asset> {
    if (!REVIEW_DECISIONS.includes(decision)) {
      throw invalidArgument(`decision must be one of ${REVIEW_DECISIONS.join(", ")}`);
    }
    let asset: Asset;
    try {
      asset = await this.findOwnAsset(assetId);
    } catch (failure) {
      throw this.toError(failure);
    }
    const decided = await this.applyOutcome(asset, decision, "requested");
    const now = this.now();
    decided.classification.moderation.manualReviews = [
      ...(decided.classification.moderation.manualReviews ?? []),
      {
        id: this.createId("rev"),
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
        {
          key: "asset-name",
          value: stored.name,
          url: `https://calmlens.com/go/asset/${stored.id}`,
        },
        { key: "note", value: null },
      ],
    } as MockEventInput);
    return structuredClone(stored);
  }

  /** The `CalmLensError` the real client throws for an API failure, for helpers that send none. */
  private toError(failure: unknown): unknown {
    if (!(failure instanceof ApiFailure)) return failure;
    const requestId = `mock-request-${++this.requestCount}`;
    return new CalmLensError(failure.code, {
      message: failure.message,
      status: failure.status,
      details: failure.details,
      requestId,
      headers: new Headers({ "content-type": "application/json", "x-request-id": requestId }),
    });
  }

  // ---- Transport ---------------------------------------------------------------------------

  private async handle(
    input: RequestInfo | URL,
    init: RequestInit | undefined,
    endpoints: MockEndpoints,
    session: MockAppSession | undefined,
  ): Promise<Response> {
    if (init?.signal?.aborted) throw init.signal.reason;
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const cdn = url.startsWith(`${endpoints.cdnBaseUrl}/`);
    const base = cdn ? endpoints.cdnBaseUrl : endpoints.baseUrl;
    if (!url.startsWith(`${base}/`)) {
      throw new TypeError(`MockCalmLensServerClient does not serve ${url}`);
    }
    const relative = url.slice(base.length);
    const queryIndex = relative.indexOf("?");
    const path = queryIndex === -1 ? relative : relative.slice(0, queryIndex);
    const headers = new Headers(init?.headers);
    const bytes =
      init?.body === undefined || init.body === null
        ? new Uint8Array(0)
        : new Uint8Array(await new Response(init.body).arrayBuffer());
    const request: MockRequest = {
      method: (init?.method ?? "GET").toUpperCase(),
      url,
      segments: path.split("/").filter(Boolean).map(decodeSegment),
      query: new URLSearchParams(queryIndex === -1 ? "" : relative.slice(queryIndex + 1)),
      headers,
      bytes,
      cdn,
    };
    const operations = operationsOf(request);
    const call: MockCalmLensCall = {
      operation: operations[0] ?? ("unknown" as MockCalmLensOperation),
      method: request.method,
      url,
      path: `/${request.segments.join("/")}`,
      query: Object.fromEntries(request.query),
      headers: Object.fromEntries(headers),
      body: this.describeBody(request),
      status: undefined,
    };
    this.calls.push({ call, operations });

    const index = this.pendingFailures.findIndex(
      (pending) => pending.operation === undefined || operations.includes(pending.operation),
    );
    if (index !== -1) {
      const [{ failure }] = this.pendingFailures.splice(index, 1) as [
        { failure: MockRequestFailure },
      ];
      if (typeof failure === "string" && failure in API_ERROR_DEFINITIONS) {
        return this.answered(call, this.failureResponse(fail(failure as ApiErrorCode), url));
      }
      throw this.toFailureError(failure as Exclude<MockRequestFailure, ApiErrorCode>);
    }
    const response = cdn
      ? await this.serveCdn(request)
      : await this.answer(request, operations[0], session);
    return this.answered(call, response);
  }

  private answered(call: MockCalmLensCall, response: Response): Response {
    call.status = response.status;
    return response;
  }

  /** What `fetch` throws for a simulated network failure, as the real client reports it. */
  private toFailureError(failure: Exclude<MockRequestFailure, ApiErrorCode>): Error {
    if (failure === "transport-error") return new TypeError("Simulated network failure");
    if (failure === "timeout") {
      // A deadline the transport didn't set itself: report it as the real client would.
      const cause = new Error("The operation timed out.");
      cause.name = "TimeoutError";
      return new CalmLensError(SDK_ERROR_CODES.TIMEOUT, { message: "Request timed out", cause });
    }
    return failure;
  }

  private describeBody({ bytes, headers }: MockRequest): unknown {
    if (bytes.byteLength === 0) return undefined;
    const type = headers.get("content-type") ?? "";
    const text = () => new TextDecoder().decode(bytes);
    if (type === "application/json") {
      try {
        return JSON.parse(text());
      } catch {
        return text();
      }
    }
    return type.startsWith("text/") ? text() : bytes.slice();
  }

  private response(
    status: number,
    body: string | Uint8Array<ArrayBuffer> | null,
    url: string,
    headers: Record<string, string>,
  ): Response {
    const requestId = `mock-request-${++this.requestCount}`;
    const response = new Response(body, {
      status,
      headers: { ...headers, "X-Request-Id": requestId },
    });
    Object.defineProperty(response, "url", { value: url });
    return response;
  }

  private jsonResponse(
    status: number,
    body: unknown,
    url: string,
    headers: Record<string, string> = {},
  ): Response {
    return this.response(status, JSON.stringify(body), url, {
      "Content-Type": "application/json",
      ...headers,
    });
  }

  private failureResponse(failure: ApiFailure, url: string): Response {
    return this.jsonResponse(
      failure.status,
      {
        code: failure.code,
        message: failure.message,
        ...(failure.details ? { details: failure.details } : {}),
      },
      url,
    );
  }

  /** Answers an API request: the API key, idempotency, then the route. */
  private async answer(
    request: MockRequest,
    operation: MockCalmLensOperation | undefined,
    session: MockAppSession | undefined,
  ): Promise<Response> {
    const { url, headers } = request;
    const isPresetUpload = request.segments[0] === "upload-presets";
    if (!isPresetUpload && headers.get("x-api-key") !== this.apiKey) {
      return this.failureResponse(fail(API_ERROR_CODES.INVALID_API_KEY), url);
    }
    // HTTP stacks trim header values, so the API sees the key without surrounding whitespace.
    const key = headers.get("idempotency-key")?.replace(/^[\t\n\r ]+|[\t\n\r ]+$/g, "");
    // Like the API, raw uploads are told apart by their query, type and length, not their bytes.
    const upload = headers.get("x-calmlens-upload");
    const fingerprint = JSON.stringify([
      request.method,
      request.segments,
      [...request.query].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
      headers.get("content-type"),
      upload,
      upload ? request.bytes.byteLength : new TextDecoder().decode(request.bytes),
    ]);
    if (key !== undefined) {
      if (!isValidIdempotencyKey(key)) {
        return this.failureResponse(fail(API_ERROR_CODES.INVALID_IDEMPOTENCY_KEY), url);
      }
      const saved = this.idempotentResults.get(key);
      if (saved) {
        if (saved.fingerprint !== fingerprint) {
          return this.failureResponse(fail(API_ERROR_CODES.IDEMPOTENCY_KEY_REUSED), url);
        }
        return this.response(saved.status, saved.body, url, {
          "Content-Type": "application/json",
          "Idempotent-Replayed": "true",
        });
      }
    }
    let answer: Answer;
    try {
      answer = await this.route(request, session);
    } catch (failure) {
      // A failed request frees its idempotency key, like the API.
      if (failure instanceof ApiFailure) return this.failureResponse(failure, url);
      throw failure;
    }
    const [status, body] = answer;
    const json = JSON.stringify(body ?? {});
    const finalStatus = operation ? (SUCCESS_STATUS[operation] ?? status) : status;
    if (key !== undefined) {
      this.idempotentResults.set(key, { fingerprint, status: finalStatus, body: json });
    }
    return this.response(finalStatus, json, url, { "Content-Type": "application/json" });
  }

  private async route(request: MockRequest, session?: MockAppSession): Promise<Answer> {
    const { method, segments } = request;
    const [root, id, action, ...rest] = segments;
    if (root === "projects") {
      if (id !== this.projectId) throw fail(API_ERROR_CODES.API_KEY_PROJECT_MISMATCH);
      const route = segments.slice(2).join("/");
      switch (`${method} ${route}`) {
        case "POST assets":
          return [200, await this.createAsset(request)];
        case "GET assets/page":
          return [200, await this.listAssets(request.query)];
        case "GET assets/search":
          return [200, await this.searchAssets(request.query)];
        case "POST assets/batch":
          return [202, await this.batch(this.json(request))];
        case "GET events":
          return [200, this.listEvents(request.query)];
        case "GET folders":
          return [200, await this.listFolders(request.query)];
        case "POST folders":
          return [201, await this.createFolder(this.json(request))];
        case "GET hash-lists":
          return [200, { items: [...this.hashLists.values()].reverse() }];
        case "POST hash-lists":
          return [201, this.createHashList(this.json(request))];
        case "PUT lenses":
          return [200, this.ensureLenses(this.json(request))];
      }
    }
    if (root === "upload-presets" && id !== undefined && action === "assets") {
      return [200, await this.presetRoute(request, id, rest, session)];
    }
    if (root === "assets" && id !== undefined && rest.length === 0) {
      switch (`${method} ${action ?? ""}`) {
        case "GET ":
          return [200, await this.findOwnAsset(id)];
        case "PATCH ":
          return [200, await this.updateAsset(id, this.json(request))];
        case "DELETE ":
          return [200, await this.deleteAsset(id)];
        case "GET children":
          return [200, await this.listChildren(id, request.query)];
        case "POST part":
          return [200, await this.uploadPart(id, request)];
        case "POST signed-url":
          return [200, await this.createSignedUrl(id, this.json(request))];
        case "POST move":
          return [200, await this.moveAsset(id, this.json(request))];
        case "POST retry":
          return [200, await this.retryAsset(id)];
        case "POST explain":
          return [200, await this.explainAsset(id, this.json(request))];
        case "DELETE content":
          return [200, await this.removeContent(await this.findOwnAsset(id))];
      }
    }
    if (root === "folders" && id !== undefined && rest.length === 0) {
      switch (`${method} ${action ?? ""}`) {
        case "GET ":
          return [200, await this.findOwnFolder(id)];
        case "PATCH ":
          return [200, await this.updateFolder(id, this.json(request))];
        case "DELETE ":
          return [200, await this.deleteFolder(id)];
        case "POST move":
          return [200, await this.moveFolder(id, this.json(request))];
      }
    }
    if (root === "hash-lists" && id !== undefined && rest.length === 0) {
      switch (`${method} ${action ?? ""}`) {
        case "GET ":
          return [200, this.findHashList(id)];
        case "PATCH ":
          return [200, this.updateHashList(id, this.json(request))];
        case "DELETE ":
          return [200, this.deleteHashList(id)];
        case "GET entries":
          return [200, this.listHashListEntries(id, request.query)];
        case "POST entries":
          return this.addHashListEntry(id, this.json(request));
      }
    }
    if (root === "hash-list-entries" && id !== undefined && method === "DELETE" && !action) {
      if (!this.hashListEntries.delete(id)) throw fail(API_ERROR_CODES.HASH_LIST_ENTRY_NOT_FOUND);
      return [200, {}];
    }
    throw new ApiFailure(404, "not-found", `No route for ${method} /${segments.join("/")}`);
  }

  // ---- Hash lists --------------------------------------------------------------------------
  // Lists and entries live in memory for the mock's lifetime. Uploads aren't matched against them.

  private readonly hashLists = new Map<string, HashList>();
  private readonly hashListEntries = new Map<string, HashListEntry>();

  private createHashList(body: Record<string, unknown>): HashList {
    const { name, description, action } = body;
    if (typeof name !== "string" || !name.trim() || (action !== "flag" && action !== "block")) {
      throw fail(API_ERROR_CODES.INVALID_UPLOAD_PAYLOAD, {
        message: "A hash list needs a name and an action of flag or block",
      });
    }
    const now = this.now();
    const list: HashList = {
      id: this.createId("hl"),
      projectId: this.projectId,
      name: name.trim(),
      description: typeof description === "string" ? description : null,
      action,
      createdByUserId: null,
      createdAt: now,
      updatedAt: now,
    };
    this.hashLists.set(list.id, list);
    return list;
  }

  private findHashList(hashListId: string): HashList {
    const list = this.hashLists.get(hashListId);
    if (!list) throw fail(API_ERROR_CODES.HASH_LIST_NOT_FOUND);
    return list;
  }

  private updateHashList(hashListId: string, body: Record<string, unknown>): HashList {
    const list = this.findHashList(hashListId);
    const updated: HashList = {
      ...list,
      ...(typeof body.name === "string" ? { name: body.name.trim() } : {}),
      ...(body.description !== undefined
        ? { description: (body.description as string | null) ?? null }
        : {}),
      ...(body.action === "flag" || body.action === "block" ? { action: body.action } : {}),
      updatedAt: this.now(),
    };
    this.hashLists.set(hashListId, updated);
    return updated;
  }

  private deleteHashList(hashListId: string): Record<string, never> {
    this.findHashList(hashListId);
    this.hashLists.delete(hashListId);
    for (const [id, entry] of this.hashListEntries) {
      if (entry.hashListId === hashListId) this.hashListEntries.delete(id);
    }
    return {};
  }

  private listHashListEntries(hashListId: string, query: URLSearchParams): HashListEntryPage {
    this.findHashList(hashListId);
    const pageSize = this.integer(query, "pageSize", 20);
    const entries = [...this.hashListEntries.values()]
      .filter((entry) => entry.hashListId === hashListId)
      .reverse();
    const cursor = query.get("cursor");
    const start = cursor ? Number(atob(cursor)) : 0;
    if (!Number.isInteger(start) || start < 0) throw fail(API_ERROR_CODES.INVALID_CURSOR);
    const items = entries.slice(start, start + pageSize);
    const hasMore = start + pageSize < entries.length;
    return {
      items,
      hasMore,
      nextCursor: hasMore ? btoa(String(start + pageSize)) : null,
      pageSize,
      ordering: [
        { field: "createdAt", direction: "DESC" },
        { field: "id", direction: "DESC" },
      ],
    };
  }

  private async addHashListEntry(
    hashListId: string,
    body: Record<string, unknown>,
  ): Promise<Answer> {
    const list = this.findHashList(hashListId);
    let hash = typeof body.hash === "string" ? body.hash.trim().toLowerCase() : undefined;
    let quality = typeof body.quality === "number" ? body.quality : null;
    const assetId = typeof body.assetId === "string" ? body.assetId : undefined;
    if ((hash === undefined) === (assetId === undefined)) {
      throw fail(API_ERROR_CODES.INVALID_UPLOAD_PAYLOAD, {
        message: "Send either hash or assetId",
      });
    }
    if (assetId) {
      const image = (await this.findOwnAsset(assetId)).content.image;
      if (!image?.perceptualHash) throw fail(API_ERROR_CODES.HASH_LIST_ASSET_NOT_HASHED);
      hash = image.perceptualHash;
      quality = image.perceptualHashQuality ?? null;
    }
    if (!/^[0-9a-f]{64}$/.test(hash!)) {
      throw fail(API_ERROR_CODES.INVALID_UPLOAD_PAYLOAD, {
        message: "Use a PDQ hash of 64 hexadecimal characters",
      });
    }
    const existing = [...this.hashListEntries.values()].find(
      (entry) => entry.hashListId === list.id && entry.hash === hash,
    );
    if (existing) return [200, existing];
    const entry: HashListEntry = {
      id: this.createId("hle"),
      projectId: this.projectId,
      hashListId: list.id,
      hash: hash!,
      quality,
      label: typeof body.label === "string" ? body.label : null,
      sourceAssetId: assetId ?? null,
      createdByUserId: null,
      createdAt: this.now(),
    };
    this.hashListEntries.set(entry.id, entry);
    return [201, entry];
  }

  /** The request's JSON body, or `{}` without one. */
  private json(request: MockRequest): Record<string, unknown> {
    if (request.bytes.byteLength === 0) return {};
    try {
      const body = JSON.parse(new TextDecoder().decode(request.bytes));
      return body && typeof body === "object" ? body : {};
    } catch {
      throw new ApiFailure(400, "validation/invalid-json", "Invalid JSON body");
    }
  }

  // ---- Query values ------------------------------------------------------------------------

  /** A whole number from the query, or `fallback` when absent; other values fail like zod. */
  private integer(query: URLSearchParams, name: string, fallback: number): number {
    const raw = query.get(name);
    if (raw === null) return fallback;
    const value = Number(raw);
    if (raw.trim() === "" || !Number.isFinite(value))
      throw invalidField("validation/invalid-type", name);
    if (!Number.isInteger(value)) throw invalidField("validation/invalid-type", name);
    return value;
  }

  /** `ordering[i][field]` and `ordering[i][direction]` pairs, as qs parses them. */
  private ordering(query: URLSearchParams) {
    const ordering: Array<{ field: "createdAt" | "id"; direction: "ASC" | "DESC" }> = [];
    for (const [key, value] of query) {
      const match = /^ordering\[(\d+)\]\[(field|direction)\]$/.exec(key);
      if (!match) continue;
      const index = Number(match[1]);
      ordering[index] = { ...ordering[index], [match[2]!]: value } as (typeof ordering)[number];
    }
    return ordering.filter(Boolean);
  }

  private pageFailure = (
    code: "validation/too-small" | "validation/too-big" | "validation/invalid-cursor",
    path?: string,
  ): Error =>
    (code === "validation/invalid-cursor"
      ? fail(API_ERROR_CODES.INVALID_CURSOR)
      : invalidField(code, path ?? "pageSize")) as unknown as Error;

  private pageQuery(query: URLSearchParams) {
    const ordering = this.ordering(query);
    return {
      pageSize: this.integer(query, "pageSize", 10),
      cursor: query.get("cursor") ?? undefined,
      ordering: ordering.length ? ordering : undefined,
    };
  }

  // ---- Assets ------------------------------------------------------------------------------

  private async findOwnAsset(assetId: string): Promise<Asset> {
    const asset = await this.databaseStorage.getAsset(assetId);
    if (!asset || asset.projectId !== this.projectId) {
      throw fail(API_ERROR_CODES.ASSET_NOT_FOUND);
    }
    return asset;
  }

  private async listAssets(query: URLSearchParams) {
    let assets = await this.databaseStorage.listAssets(this.projectId);
    const folderId = query.get("folderId");
    if (folderId !== null) {
      assets = assets.filter((asset) => (asset.folderId ?? null) === folderId);
    }
    const filter = query.get("filter") ?? undefined;
    assets = filterAssets(assets, filter);
    return createPage(assets, this.pageQuery(query), {
      scope: JSON.stringify([this.projectId, filter ?? null, folderId]),
      fail: this.pageFailure,
    });
  }

  /**
   * Keyword search like the API's: every whitespace-separated token must appear,
   * case-insensitively, in the asset's name, ID, external ID, description, tags, type, content
   * format or extension, or moderation status. There is no semantic search.
   */
  private async searchAssets(params: URLSearchParams) {
    // Like the API's query schema: a trimmed query of 1 to 200 characters, a limit of 1 to 20.
    const query = (params.get("query") ?? "").trim();
    if (!query) throw invalidField("validation/too-small", "query");
    if (query.length > MAX_SEARCH_QUERY_LENGTH) throw invalidField("validation/too-big", "query");
    const limit = this.integer(params, "limit", 10);
    if (limit < 1) throw invalidField("validation/too-small", "limit");
    if (limit > MAX_SEARCH_LIMIT) throw invalidField("validation/too-big", "limit");
    const items = searchAssets(await this.databaseStorage.listAssets(this.projectId), query, limit);
    return { query, items, semanticStatus: "disabled" };
  }

  private async listChildren(assetId: string, query: URLSearchParams) {
    const parent = await this.findOwnAsset(assetId);
    const assets = await this.databaseStorage.listAssets(this.projectId);
    return createPage(
      assets.filter((asset) => asset.parentId === parent.id),
      this.pageQuery(query),
      { scope: parent.id, fail: this.pageFailure },
    );
  }

  private async updateAsset(assetId: string, body: Record<string, unknown>): Promise<Asset> {
    const asset = await this.findOwnAsset(assetId);
    // Like the API: an externalId stays unique in the project; `null` clears a field.
    if (body.externalId) {
      const assets = await this.databaseStorage.listAssets(this.projectId);
      if (assets.some((other) => other.id !== asset.id && other.externalId === body.externalId)) {
        throw fail(API_ERROR_CODES.DUPLICATE_EXTERNAL_ID);
      }
    }
    return this.databaseStorage.updateAsset({ ...asset, ...body, updatedAt: this.now() });
  }

  private async deleteAsset(assetId: string): Promise<undefined> {
    const asset = await this.findOwnAsset(assetId);
    await this.imageStorage.deleteContent(asset.id);
    await this.databaseStorage.deleteAsset(asset.id);
    this.recordLifecycleEvent("asset.deleted", asset);
    return undefined;
  }

  private async moveAsset(assetId: string, body: Record<string, unknown>): Promise<Asset> {
    const asset = await this.findOwnAsset(assetId);
    const folderId = (body.folderId as string | null | undefined) ?? null;
    if (folderId !== null && !(await this.resolveFolder(folderId))) {
      throw fail(API_ERROR_CODES.FOLDER_NOT_FOUND);
    }
    return this.databaseStorage.updateAsset({ ...asset, folderId, updatedAt: this.now() });
  }

  private async createSignedUrl(assetId: string, body: Record<string, unknown>) {
    const asset = await this.findOwnAsset(assetId);
    const expiresInSeconds = (body.expiresInSeconds as number | undefined) ?? 60 * 15;
    const resource = (body.resource as string | undefined) ?? "rendered";
    const selector =
      (body.lens ? `&lens=${encodeURIComponent(String(body.lens))}` : "") +
      (body.transform ? `&transform=${encodeURIComponent(String(body.transform))}` : "");
    return {
      url: `${this.options.signedUrlBaseUrl}/assets/${asset.id}/${resource}?expiresInSeconds=${expiresInSeconds}${selector}`,
      expiresAt: this.now() + expiresInSeconds * 1000,
    };
  }

  private async retryAsset(assetId: string): Promise<Asset> {
    const asset = await this.findOwnAsset(assetId);
    if (
      asset.classification.status !== "failed" ||
      asset.classification.moderation.status !== "pending"
    ) {
      throw fail(API_ERROR_CODES.ASSET_NOT_RETRYABLE);
    }
    if (asset.content.status === "removed") {
      throw fail(API_ERROR_CODES.ASSET_CONTENT_UNAVAILABLE);
    }
    // Like the API: back to processing, to be moderated again, with an `asset.retried` event.
    const retried = await this.databaseStorage.updateAsset(
      await this.applyOutcome(asset, "pending"),
    );
    this.recordLifecycleEvent("asset.retried", retried);
    return retried;
  }

  private async explainAsset(assetId: string, body: Record<string, unknown>): Promise<Asset> {
    const asset = await this.findOwnAsset(assetId);
    if (asset.classification.status !== "completed") {
      throw fail(API_ERROR_CODES.ASSET_NOT_DECIDED);
    }
    if (!body.rerun) {
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
      throw fail(API_ERROR_CODES.ASSET_REVIEWED);
    }
    if (asset.content.status === "removed") {
      throw fail(API_ERROR_CODES.ASSET_CONTENT_UNAVAILABLE);
    }
    // Like the API: back to processing, to be moderated again under the current policy.
    return this.databaseStorage.updateAsset(await this.applyOutcome(asset, "pending"));
  }

  /**
   * Checks every asset like the API (an ID that is not an asset ID is
   * `validation/invalid-format`, an unknown
   * one `asset/not-found`, and either refuses the whole batch), then applies the operation at
   * once instead of in the background: `delete` deletes each asset with its stored child
   * assets and records `asset.deleted` with the asset as it was; `remove-content` removes
   * the content like `deleteContent`. Mock assets carry no safety holds, so none is skipped.
   */
  private async batch(body: Record<string, unknown>) {
    const assetIds = Array.isArray(body.assetIds) ? (body.assetIds as unknown[]) : [];
    const operation = body.operation;
    if (assetIds.length === 0) throw invalidField("validation/too-small", "assetIds");
    if (assetIds.length > 500) throw invalidField("validation/too-big", "assetIds");
    if (operation !== "delete" && operation !== "remove-content") {
      throw invalidField("validation/invalid-value", "operation");
    }
    assetIds.forEach((assetId, index) => {
      if (typeof assetId !== "string" || !isId(assetId, "asset")) {
        throw invalidField("validation/invalid-format", `assetIds.${index}`);
      }
    });
    const assets: Asset[] = [];
    for (const assetId of new Set(assetIds as string[])) {
      assets.push(await this.findOwnAsset(assetId));
    }
    for (const asset of assets) {
      if (operation === "delete") {
        await this.deleteAssetTree(asset);
        this.recordLifecycleEvent("asset.deleted", asset);
      } else {
        await this.removeContent(asset);
      }
    }
    return { queued: true };
  }

  /**
   * Removes an asset's content like the API: the record and report stay; stored content,
   * extracted text and the placeholder go. Content already removed keeps its reason, and an
   * `asset.content-removed` event is recorded either way.
   */
  private async removeContent(asset: Asset): Promise<Asset> {
    await this.imageStorage.deleteContent(asset.id);
    let removed = asset;
    if (asset.content.status === "removed") {
      if (asset.content.image?.thumbhash) {
        removed = await this.databaseStorage.updateAsset({
          ...asset,
          content: { ...asset.content, image: withoutPlaceholder(asset.content.image) },
        });
      }
    } else {
      const now = this.now();
      removed = await this.databaseStorage.updateAsset({
        ...asset,
        context: null,
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
    }
    this.recordLifecycleEvent("asset.content-removed", removed);
    return removed;
  }

  /** Deletes an asset, its stored child assets and their content. */
  private async deleteAssetTree(asset: Asset): Promise<void> {
    const assets = await this.databaseStorage.listAssets(this.projectId);
    const deleting = new Set([asset.id]);
    for (let added = true; added; ) {
      added = false;
      for (const other of assets) {
        if (other.parentId && deleting.has(other.parentId) && !deleting.has(other.id)) {
          deleting.add(other.id);
          added = true;
        }
      }
    }
    for (const id of deleting) {
      await this.imageStorage.deleteContent(id);
      await this.databaseStorage.deleteAsset(id);
    }
  }

  // ---- Uploads -----------------------------------------------------------------------------

  /** The upload fields of `POST .../assets`: raw uploads carry them in the query. */
  private uploadFields(request: MockRequest): UploadFields {
    const upload = request.headers.get("x-calmlens-upload");
    if (upload !== "content" && upload !== "part") {
      const body = this.json(request);
      return body as unknown as UploadFields;
    }
    const { query } = request;
    const text = (name: string) => query.get(name) ?? undefined;
    const parsed = (name: string) => {
      const raw = query.get(name);
      if (raw === null) return undefined;
      try {
        return JSON.parse(raw);
      } catch {
        throw invalidField("validation/invalid-json", name);
      }
    };
    const total = query.get("totalSizeInBytes");
    return {
      name: query.get("name") ?? "",
      description: text("description"),
      processingOptions: parsed("processingOptions"),
      visibility: text("visibility") as Asset["visibility"] | undefined,
      metadata: parsed("metadata"),
      authorId: text("authorId"),
      context: parsed("context"),
      externalId: text("externalId"),
      externalUrl: text("externalUrl"),
      folderId: text("folderId"),
      uploadPresetId: text("uploadPresetId"),
      contentType: query.get("contentType") ?? request.headers.get("content-type") ?? "",
      bytes: request.bytes,
      part:
        upload === "part"
          ? {
              partNumber: this.integer(query, "partNumber", 1),
              isFinal: query.get("isFinal") === "true",
              totalSizeInBytes:
                total === null ? undefined : this.integer(query, "totalSizeInBytes", 0),
            }
          : undefined,
    };
  }

  private async createAsset(request: MockRequest): Promise<Asset> {
    return this.storeAsset(this.uploadFields(request), request.query.get("queue") === "true");
  }

  private async storeAsset(fields: UploadFields, queue: boolean): Promise<Asset> {
    if (!fields.name)
      throw fail(API_ERROR_CODES.INVALID_UPLOAD_PAYLOAD, { message: "Asset name is required" });
    const { contentType, part } = fields;
    const bytes = fields.bytes ?? new Uint8Array(0);
    if (contentType !== undefined && isRejectedUploadMimeType(contentType)) {
      throw fail(API_ERROR_CODES.INVALID_UPLOAD_MIME_TYPE, {
        message: getRejectedUploadMimeTypeError(contentType),
        details: { mimeType: contentType },
      });
    }
    const type = inferAssetType(fields.url === undefined ? (contentType ?? "") : undefined);
    if (part) {
      if (part.partNumber > 1) throw fail(API_ERROR_CODES.USE_UPLOAD_PART);
      // Like the API, a declared total is checked before anything is stored, then a single final
      // part is checked as the whole upload, then the part itself.
      const partSize = bytes.byteLength;
      const sizeError =
        (part.totalSizeInBytes === undefined
          ? undefined
          : this.multipartImageSizeError(type, part.totalSizeInBytes, true)) ??
        (part.isFinal
          ? (this.multipartTotalSizeError(part.totalSizeInBytes, partSize, true) ??
            this.multipartImageSizeError(type, partSize, true))
          : undefined);
      if (sizeError) throw fail(sizeError);
      const validation = validateAssetPayload(
        { uint8Array: bytes },
        { multipart: true, isFinal: part.isFinal },
      );
      if (!validation.ok) {
        throw fail(API_ERROR_CODES.INVALID_UPLOAD_PAYLOAD, { message: validation.error });
      }
      if (!part.isFinal) {
        const totalError = this.multipartTotalSizeError(part.totalSizeInBytes, partSize, false);
        if (totalError) throw fail(totalError);
      }
    }
    if (fields.folderId) await this.findOwnFolder(fields.folderId);
    if (fields.externalId) {
      const assets = await this.databaseStorage.listAssets(this.projectId);
      if (assets.some((asset) => asset.externalId === fields.externalId)) {
        throw fail(API_ERROR_CODES.DUPLICATE_EXTERNAL_ID);
      }
    }

    const id = this.createId("asset");
    const now = this.now();
    const isOpenUpload = part !== undefined && !part.isFinal;
    const processingOptions = fields.processingOptions ?? { keepContentAfterProcessing: false };
    const keepContent = processingOptions.keepContentAfterProcessing === true;
    const hasContent = fields.url === undefined;
    const contextItems = selectModerationContextItems(fields.context?.items ?? []);
    // Fields the API returns as `null` when they are not set.
    const asset: Asset = {
      id,
      projectId: this.projectId,
      userId: null,
      parentId: null,
      folderId: fields.folderId ?? null,
      uploadPresetId: fields.uploadPresetId ?? null,
      createdAt: now,
      updatedAt: now,
      name: fields.name,
      description: fields.description ?? null,
      externalId: fields.externalId ?? null,
      externalUrl: fields.url ?? fields.externalUrl ?? null,
      type,
      metadata: fields.metadata ?? null,
      authorId: fields.authorId ?? null,
      // Like the API, only the posts CalmLens uses are kept, and only while the content is held.
      context: contextItems.length ? { items: contextItems } : null,
      tags: null,
      processingOptions,
      visibility: fields.visibility ?? "private",
      content: {
        status: keepContent ? "stored" : "temporary",
        removalReason: null,
        updatedAt: now,
        safetyHold: null,
        format: hasContent ? (contentType ?? null) : null,
        extension: null,
        sizeInBytes: hasContent ? bytes.byteLength : null,
        checksums: null,
        image: null,
        extractedText: null,
      },
      upload: {
        status: isOpenUpload ? "uploading" : "completed",
        updatedAt: now,
        // Like the API, only an open upload counts the parts received.
        partsReceived: isOpenUpload ? part.partNumber : null,
      },
      classification: {
        status: isOpenUpload ? "pending" : "processing",
        updatedAt: now,
        completedAt: null,
        moderation: { status: "pending", manualReviews: [] },
      },
    } as Asset;

    if (part) {
      await this.imageStorage.putPart(id, {
        uint8Array: bytes,
        type: contentType,
        partNumber: part.partNumber,
        isFinal: part.isFinal,
      });
      if (isOpenUpload) {
        this.openUploads.set(id, { queue, totalSizeInBytes: part.totalSizeInBytes });
      }
    } else if (hasContent) {
      await this.imageStorage.putContent(id, { uint8Array: bytes, type: contentType ?? "" });
    }

    return this.databaseStorage.createAsset(
      isOpenUpload ? asset : await this.applyOutcome(asset, this.outcomeFor(asset, queue)),
    );
  }

  /** Continues a multipart upload: parts must arrive in order while it is `uploading`. */
  private async uploadPart(assetId: string, request: MockRequest): Promise<Asset> {
    const { query, bytes } = request;
    const partNumber = this.integer(query, "partNumber", 0);
    const isFinal = query.get("isFinal") === "true";
    // In the API's order: the upload must be open, parts arrive in order, image totals and
    // the declared total are checked, then the part itself (5 MiB unless it is the last).
    const asset = await this.findOwnAsset(assetId);
    if (asset.upload.status !== "uploading") throw fail(API_ERROR_CODES.UPLOAD_NOT_OPEN);
    const expectedPartNumber = (asset.upload.partsReceived ?? 0) + 1;
    if (partNumber !== expectedPartNumber) {
      throw fail(API_ERROR_CODES.INVALID_UPLOAD_PART_NUMBER, {
        message: `Expected part ${expectedPartNumber}`,
        details: { expectedPartNumber, receivedPartNumber: partNumber },
      });
    }
    const received = (asset.content.sizeInBytes ?? 0) + bytes.byteLength;
    const upload = this.openUploads.get(assetId);
    const sizeError =
      this.multipartImageSizeError(asset.type, received, isFinal) ??
      this.multipartTotalSizeError(upload?.totalSizeInBytes, received, isFinal);
    if (sizeError) throw fail(sizeError);
    const validation = validateAssetPayload({ uint8Array: bytes }, { multipart: true, isFinal });
    if (!validation.ok) {
      throw fail(API_ERROR_CODES.INVALID_UPLOAD_PAYLOAD, { message: validation.error });
    }

    await this.imageStorage.putPart(assetId, { uint8Array: bytes, partNumber, isFinal });
    const queueOverride = query.get("queue");
    const queue = queueOverride === null ? (upload?.queue ?? false) : queueOverride === "true";
    if (isFinal) this.openUploads.delete(assetId);
    const now = this.now();
    const next: Asset = {
      ...asset,
      updatedAt: now,
      content: { ...asset.content, sizeInBytes: received },
      // Like the API, a completed upload no longer counts parts.
      upload: { ...asset.upload, updatedAt: now, partsReceived: isFinal ? null : partNumber },
    };
    return this.databaseStorage.updateAsset(
      isFinal ? await this.applyOutcome(next, this.outcomeFor(next, queue)) : next,
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
    const outcome = queue ? this.options.queuedOutcome : this.options.analyzedOutcome;
    return typeof outcome === "function" ? outcome(structuredClone(asset)) : outcome;
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
          perceptualHashQuality: null,
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
      ...(removeContent && { context: null }),
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
          ...(type === "asset.deleted" ? {} : { url: `https://calmlens.com/go/asset/${asset.id}` }),
        },
        { key: "asset-type", value: asset.type },
      ],
    } as MockEventInput);
  }

  // ---- Upload presets (app clients) --------------------------------------------------------

  /**
   * `/upload-presets/:id/assets[/:assetId[/part]]`: uploads through the preset, with its rules
   * applied in the API's order (token, content type, size), and checks of its uploads.
   */
  private async presetRoute(
    request: MockRequest,
    uploadPresetId: string,
    rest: string[],
    session: MockAppSession | undefined,
  ) {
    if (!session) throw fail(API_ERROR_CODES.UPLOAD_PRESET_NOT_FOUND);
    const { preset } = session;
    const toUploaded = (asset: Asset) => ({
      id: asset.id,
      name: asset.name,
      uploadPresetId,
      createdAt: asset.createdAt,
      ...(preset.showDecisions !== false && { status: asset.classification.moderation.status }),
    });
    const [assetId, action] = rest;
    if (assetId !== undefined) {
      // Only this client's uploads can be checked or continued.
      if (!session.uploads.has(assetId)) throw fail(API_ERROR_CODES.ASSET_NOT_FOUND);
      const asset = await this.findOwnAsset(assetId);
      if (request.method === "POST" && action === "part") {
        return toUploaded(await this.uploadPart(assetId, request));
      }
      if (request.method === "GET" && action === undefined) return toUploaded(asset);
      throw new ApiFailure(404, "not-found", "No such route");
    }
    if (request.method !== "POST") throw new ApiFailure(404, "not-found", "No such route");
    const fields = this.uploadFields(request);
    const token = request.headers.get("authorization");
    if (preset.requireToken && !token) throw fail(API_ERROR_CODES.UPLOAD_PRESET_TOKEN_REQUIRED);
    if (
      preset.allowedContentTypes &&
      !isFileAccepted(
        { name: fields.name, type: fields.contentType ?? "" },
        preset.allowedContentTypes.join(","),
      )
    ) {
      throw fail(API_ERROR_CODES.UPLOAD_PRESET_CONTENT_TYPE_NOT_ALLOWED);
    }
    const size = fields.part?.totalSizeInBytes ?? fields.bytes?.byteLength;
    if (
      preset.maxFileSizeInBytes !== undefined &&
      size !== undefined &&
      size > preset.maxFileSizeInBytes
    ) {
      throw fail(API_ERROR_CODES.UPLOAD_PRESET_TOO_LARGE);
    }
    const asset = await this.storeAsset(
      {
        ...fields,
        uploadPresetId,
        visibility: preset.visibility ?? "public",
        folderId: preset.folderId ?? undefined,
        processingOptions: {
          keepContentAfterProcessing: preset.keepContentAfterProcessing ?? true,
        },
      },
      request.query.get("queue") === "true",
    );
    session.uploads.add(asset.id);
    return toUploaded(asset);
  }

  // ---- Events ------------------------------------------------------------------------------

  /**
   * Reads the feed like the API: without `after`, no events and a cursor for "now"; with
   * `after`, up to `limit` events added since, oldest first.
   */
  private listEvents(query: URLSearchParams) {
    const limit = this.integer(query, "limit", DEFAULT_EVENTS_LIMIT);
    // Like the API's query schema: an integer from 1 to 100.
    if (limit < 1) throw invalidField("validation/too-small", "limit");
    if (limit > MAX_EVENTS_LIMIT) throw invalidField("validation/too-big", "limit");
    const after = query.get("after");
    if (!after) return { events: [], cursor: `mock_${this.eventFeed.length}`, hasMore: false };
    const match = /^mock_(\d+)$/.exec(after);
    const position = match ? Number(match[1]) : Number.NaN;
    if (!Number.isSafeInteger(position) || position > this.eventFeed.length) {
      throw fail(API_ERROR_CODES.INVALID_EVENT_CURSOR, { details: { after } });
    }
    const events = this.eventFeed.slice(position, position + limit);
    const next = position + events.length;
    return { events, cursor: `mock_${next}`, hasMore: next < this.eventFeed.length };
  }

  // ---- Folders -----------------------------------------------------------------------------

  private async listFolders(query: URLSearchParams) {
    const all = (await this.databaseStorage.listFolders?.(this.projectId)) ?? [];
    const size = this.integer(query, "pageSize", MAX_FOLDER_PAGE_SIZE);
    if (size < 1) throw invalidField("validation/too-small", "pageSize");
    if (size > MAX_FOLDER_PAGE_SIZE) throw invalidField("validation/too-big", "pageSize");
    const parentId = query.get("parentId");
    const search = query.get("search");
    const searchAll = query.get("searchAll") === "true";
    const resolveOnly = query.get("resolveOnly") === "true";
    const descending = query.get("direction") === "DESC";
    const byCreatedAt = query.get("sort") === "createdAt";
    const requestedIds = [...query]
      .filter(([key]) => /^ids\[\d+\]$/.test(key))
      .map(([, value]) => value);
    // Like the database: names compare by code point, so case matters.
    const byCodePoint = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);
    const matching = all
      .filter(
        (folder) =>
          ((searchAll && search) || (folder.parentId ?? null) === parentId) &&
          (!search || folder.name.toLowerCase().includes(search.toLowerCase())),
      )
      .sort((a, b) => {
        const order =
          (byCreatedAt ? a.createdAt - b.createdAt : byCodePoint(a.name, b.name)) ||
          byCodePoint(a.id, b.id);
        return descending ? -order : order;
      });
    const start = this.integer(query, "pageIndex", 0) * size;
    const folders = resolveOnly ? [] : matching.slice(start, start + size);
    const ids = new Set([
      ...requestedIds,
      ...(parentId ? [parentId] : []),
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
      hasMore: !resolveOnly && matching.length > start + size,
    };
  }

  private async createFolder(body: Record<string, unknown>): Promise<Folder> {
    const name = body.name;
    if (typeof name !== "string" || !name) {
      throw fail(API_ERROR_CODES.INVALID_UPLOAD_PAYLOAD, { message: "Folder name is required" });
    }
    const parentId = (body.parentId as string | null | undefined) ?? null;
    if (parentId) await this.findOwnFolder(parentId);
    await this.assertUniqueFolderName(name, parentId);
    const now = this.now();
    const folder: Folder = {
      id: this.createId("fldr"),
      projectId: this.projectId,
      parentId,
      name,
      createdAt: now,
      updatedAt: now,
    };
    return this.databaseStorage.createFolder
      ? await this.databaseStorage.createFolder(folder)
      : folder;
  }

  private async updateFolder(folderId: string, body: Record<string, unknown>): Promise<Folder> {
    const folder = await this.findOwnFolder(folderId);
    const name = body.name as string | undefined;
    if (name !== undefined && name !== folder.name) {
      await this.assertUniqueFolderName(name, folder.parentId ?? null, folderId);
    }
    const updated: Folder = {
      ...folder,
      ...(name !== undefined ? { name } : {}),
      updatedAt: this.now(),
    };
    return this.databaseStorage.updateFolder
      ? await this.databaseStorage.updateFolder(updated)
      : updated;
  }

  private async deleteFolder(folderId: string): Promise<undefined> {
    await this.findOwnFolder(folderId);
    const assets = await this.databaseStorage.listAssets(this.projectId);
    const hasAssets = assets.some((asset) => asset.folderId === folderId);
    const folders = (await this.databaseStorage.listFolders?.(this.projectId)) ?? [];
    const hasChildren = folders.some((folder) => folder.parentId === folderId);
    if (hasAssets || hasChildren) {
      throw fail(API_ERROR_CODES.FOLDER_NOT_EMPTY, { details: { hasAssets, hasChildren } });
    }
    await this.databaseStorage.deleteFolder?.(folderId);
    return undefined;
  }

  private async moveFolder(folderId: string, body: Record<string, unknown>): Promise<Folder> {
    const folder = await this.findOwnFolder(folderId);
    const targetParentId = (body.parentId as string | null | undefined) ?? null;
    if (targetParentId) {
      let candidate: Folder | undefined = await this.findOwnFolder(targetParentId);
      const visited = new Set<string>();
      while (candidate) {
        if (candidate.id === folderId || visited.has(candidate.id)) {
          throw fail(API_ERROR_CODES.FOLDER_PARENT_CYCLE);
        }
        visited.add(candidate.id);
        candidate = candidate.parentId ? await this.resolveFolder(candidate.parentId) : undefined;
      }
    }
    if (targetParentId !== folder.parentId) {
      await this.assertUniqueFolderName(folder.name, targetParentId, folderId);
    }
    const updated: Folder = { ...folder, parentId: targetParentId, updatedAt: this.now() };
    return this.databaseStorage.updateFolder
      ? await this.databaseStorage.updateFolder(updated)
      : updated;
  }

  private async resolveFolder(folderId: string): Promise<Folder | undefined> {
    const folder = await this.databaseStorage.getFolder?.(folderId);
    return folder && folder.projectId === this.projectId ? folder : undefined;
  }

  private async findOwnFolder(folderId: string): Promise<Folder> {
    const folder = await this.resolveFolder(folderId);
    if (!folder) throw fail(API_ERROR_CODES.FOLDER_NOT_FOUND);
    return folder;
  }

  private async assertUniqueFolderName(
    name: string,
    parentId: string | null,
    excludeFolderId?: string,
  ): Promise<void> {
    const folders = (await this.databaseStorage.listFolders?.(this.projectId)) ?? [];
    const duplicate = folders.find(
      (folder) =>
        folder.id !== excludeFolderId &&
        (folder.parentId ?? null) === parentId &&
        folder.name === name,
    );
    if (duplicate) {
      throw fail(API_ERROR_CODES.DUPLICATE_FOLDER_NAME, {
        message: `A folder named "${name}" already exists in this location.`,
      });
    }
  }

  // ---- Lenses ------------------------------------------------------------------------------

  /** Saves each lens in order, like the API: new ones, or changes with a greater version. */
  private ensureLenses(body: Record<string, unknown>) {
    const lenses = Array.isArray(body.lenses) ? (body.lenses as LensDefinition[]) : [];
    if (lenses.length === 0) throw invalidField("validation/too-small", "lenses");
    return { lenses: lenses.map((lens) => this.ensureLens(lens)) };
  }

  private ensureLens(options: LensDefinition): Lens {
    const existing = this.lenses.get(options.identifier);
    if (!existing) {
      const now = this.now();
      const lens: Lens = {
        id: this.createId("lens"),
        projectId: this.projectId,
        userId: null,
        ...options,
        createdAt: now,
        updatedAt: now,
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
    if (hasMatchingDefinition && existing.version === options.version) return existing;
    if (options.version > existing.version) {
      const lens = { ...existing, ...options, updatedAt: this.now() };
      this.lenses.set(lens.identifier, lens);
      return lens;
    }
    throw fail(API_ERROR_CODES.LENS_VERSION_CONFLICT, {
      details: {
        currentVersion: existing.version,
        minimumVersion: existing.version + 1,
        requestedVersion: options.version,
      },
    });
  }

  // ---- CDN ---------------------------------------------------------------------------------

  /**
   * Serves stored content like the CDN (`/assets/:projectId/:asset/:resource`): `200` with
   * `Content-Type`, `Content-Length`, `Cache-Control`, `Cache-Tag`, the CDN's protection headers
   * and, for images, `ETag` and `Expires`; or a JSON error body with `404`/`403`. A
   * `placeholder` is the asset's ThumbHash as a PNG.
   */
  private async serveCdn(request: MockRequest): Promise<Response> {
    const { url, segments, query } = request;
    const [root, projectId, assetIdentifier, resource] = segments;
    const notFound = () =>
      this.jsonResponse(404, { code: "asset/not-found", message: "Asset not found" }, url);
    if (root !== "assets" || projectId !== this.projectId || !assetIdentifier) return notFound();
    const assets = await this.databaseStorage.listAssets(this.projectId);
    const asset = assets.find(
      (asset) => asset.id === assetIdentifier || asset.externalId === assetIdentifier,
    );
    if (!asset) return notFound();
    const notAvailable = () =>
      this.jsonResponse(
        403,
        { code: "asset/not-available", message: "Asset is not available" },
        url,
      );
    const grants = request.headers.get("x-api-key") === this.apiKey ? this.grants : [];
    const folders = (await this.databaseStorage.listFolders?.(this.projectId)) ?? [];
    const canDownload = () => permits(grants, "assets:download", asset.folderId ?? null, folders);
    const status = asset.classification.moderation.status;
    const isHead = request.method === "HEAD";

    if (resource === "placeholder") {
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
      return this.cdnResponse(isHead, png, url, {
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
    // `ageConfirmed`, need an API key with `assets:download` for the asset's folder.
    const isPrivate =
      asset.visibility !== "public" ||
      (status === "age-restricted" && query.get("ageConfirmed") !== "true");
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
    const bytes = new Uint8Array(parts.reduce((sum, value) => sum + value.byteLength, 0));
    let offset = 0;
    for (const part of parts) {
      bytes.set(part, offset);
      offset += part.byteLength;
    }
    const contentType = storedContent.type ?? "application/octet-stream";
    const isImage = asset.type === "image";
    return this.cdnResponse(isHead, bytes, url, {
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
  }

  private cdnResponse(
    isHead: boolean,
    bytes: Uint8Array<ArrayBuffer>,
    url: string,
    headers: Record<string, string>,
  ): Response {
    return this.response(200, isHead ? null : bytes, url, {
      ...headers,
      "Content-Length": String(bytes.byteLength),
      "X-Mock-CalmLens-CDN-URL": url,
    });
  }
}
