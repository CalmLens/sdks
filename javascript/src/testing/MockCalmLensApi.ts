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
  LensPage,
  MetadataFieldsResource,
  Policy,
  PolicyPage,
  ProjectSettingsResource,
  UploadedAsset,
  UploadPreset,
  UploadPresetPage,
} from "../client/CalmLensTypes";
import {
  checkTransformOptions,
  isAcceptedUploadMimeType,
  parseTransformSelector,
} from "../client/CalmLensUtils";
import type { ProcessingOptions } from "../contract/Asset.js";
import { validateAssetPayload } from "../contract/AssetPayload.js";
import type { TypedEvent } from "../contract/Event.js";
import type { Folder } from "../contract/Folder.js";
import { type IdPrefix, isId } from "../contract/Ids.js";
import { stringifyJsonCanonical } from "../contract/JsonUtils.js";
import { CLASSIFICATION_CATEGORIES } from "../contract/ModerationCategories.js";
import {
  type ModerationContextItem,
  selectModerationContextItems,
} from "../contract/ModerationContextLimits.js";
import { type PermissionGrant, permits } from "../contract/Permissions.js";
import { placeholderHashToDataURL } from "../contract/PlaceholderHashDecode.js";
import {
  getRejectedUploadMimeTypeError,
  MAX_IMAGE_UPLOAD_BYTES,
  normalizeUploadMimeType,
} from "../contract/SharedConstants.js";
import { decodeUploadToken } from "../contract/UploadToken.js";
import { isFileAccepted } from "../ui/UploadController";
import {
  type MockAssetOutcome,
  MockDecision,
  type MockModerate,
  type MockModerationTrigger,
} from "./MockDecision";
import type { MockDatabaseStorage, MockImageStorage } from "./MockStorage";
import {
  createPage,
  DEFAULT_PAGE_SIZE,
  filterAssets,
  MockInvalidFilter,
  parseSort,
  searchAssets,
} from "./MockUtils";

// The in-memory CalmLens API and CDN behind the mock clients. The mocks run the real clients,
// whose `fetch` is `MockCalmLensApi.handle`: every request is answered here with the API's
// statuses, JSON bodies, error bodies and headers.

export type { MockAssetOutcome } from "./MockDecision";

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
const MOCK_OPERATIONS = [
  "assets.list",
  "assets.iterate",
  "assets.search",
  "assets.retrieve",
  "assets.waitForDecision",
  "assets.update",
  "assets.listChildren",
  "assets.iterateChildren",
  "assets.listTimeline",
  "assets.iterateTimeline",
  "assets.create",
  "assets.classify",
  "assets.uploadPart",
  "assets.move",
  "assets.retry",
  "assets.explain",
  "assets.decide",
  "assets.removeContent",
  "assets.delete",
  "assets.batch",
  "text.classify",
  "cdn.serve",
  "cdn.getAssetInfo",
  "cdn.signAssetUrl",
  "events.list",
  "events.pages",
  "folders.list",
  "folders.iterate",
  "folders.retrieve",
  "folders.create",
  "folders.update",
  "folders.delete",
  "folders.move",
  "hashLists.list",
  "hashLists.iterate",
  "hashLists.retrieve",
  "hashLists.create",
  "hashLists.update",
  "hashLists.delete",
  "hashLists.listEntries",
  "hashLists.iterateEntries",
  "hashLists.addEntry",
  "hashLists.removeEntry",
  "policies.list",
  "policies.iterate",
  "policies.retrieve",
  "policies.create",
  "policies.update",
  "policies.reset",
  "policies.upgrade",
  "policies.setAutomaticUpdates",
  "policies.delete",
  "policies.retrieveAssigned",
  "policies.assign",
  "lenses.list",
  "lenses.iterate",
  "lenses.create",
  "lenses.retrieve",
  "lenses.update",
  "lenses.delete",
  "ensureLens",
  "ensureLenses",
  "uploadPresets.list",
  "uploadPresets.iterate",
  "uploadPresets.ensure",
  "uploadPresets.delete",
  "projectSettings.get",
  "projectSettings.update",
  "metadataFields.list",
  "metadataFields.ensure",
  "metadataFields.delete",
] as const;

export type MockCalmLensOperation = (typeof MOCK_OPERATIONS)[number];

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
  /**
   * The JSON body (plain text arrives as `{ name, content: { plainText, type } }`), an upload
   * form as `{ options, file }` (the file as text for a `text/*` type, else bytes), the bytes of a
   * later part, or `undefined`.
   */
  body: unknown;
  /** The HTTP status the mock answered with, or `undefined` when the request failed without one. */
  status: number | undefined;
}

/**
 * What a simulated request failure does: `"transport-error"` and `"timeout"` fail the request
 * like a network failure (`sdk/transport-error`) or a deadline (`sdk/timeout`); an API error
 * code, such as `"usage/free-uploads-exhausted"`, answers with that API error and its HTTP status; a
 * `CalmLensError` is thrown as is and any other `Error` as the cause of `sdk/transport-error`,
 * like an exception from `fetch`.
 */
export type MockRequestFailure = "transport-error" | "timeout" | ApiErrorCode | Error;

/** Options for a simulated API error: its `details` and the `Retry-After` it answers with. */
export interface MockFailureOptions {
  operation?: MockCalmLensOperation;
  /** The error's `details`, for an API error code. */
  details?: Record<string, unknown>;
  /** Seconds for the `Retry-After` header, for an API error code. */
  retryAfter?: number;
}

/** An event to add to the mock feed; omitted fields get defaults. */
/** An event to add to the feed; its `assetSequence` is assigned like the API's. */
export type MockEventInput = Partial<Omit<TypedEvent, "type" | "assetSequence">> & {
  type: TypedEvent["type"];
};

/** The upload preset settings a `MockCalmLensAppClient` applies, as the API would. */
export interface MockUploadPreset {
  /** Refuse uploads without a token, like **Users your server approves**. Defaults to `false`. */
  requireToken?: boolean;
  /** Accepted content types, such as `["image/*"]`. Defaults to any type. */
  allowedContentTypes?: string[];
  maxFileSizeInBytes?: number;
  /** Return `classification.moderation.status` to the uploader. Defaults to `true`. */
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
  moderate: MockModerate;
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
type LensDefinition = Omit<Lens, "id" | "projectId" | "createdAt" | "updatedAt">;

/** Where a client sends its requests: the API and CDN base URLs, without trailing slashes. */
export interface MockEndpoints {
  baseUrl: string;
  cdnBaseUrl: string;
}

const MAX_PAGE_SIZE = 100;
const MAX_DECISION_NOTE_LENGTH = 1499;
/** How the API names a reviewer acting through an unnamed API key. */
const API_KEY_REVIEWER_NAME = "An API key";
/** The actor of events the mock's API key causes: mock keys have no ID. */
const MOCK_API_KEY_ACTOR = { type: "api-key", id: null } as const;
/** The actor of a reviewer's decision through the `decide` test hook. */
const MOCK_REVIEWER_ACTOR = { type: "user", id: null } as const;
const AUTOMATED_ACTOR = { type: "automated", id: null } as const;
/** An event type's shape (`resource.action`), as the mock checks `types` without the catalog. */
const EVENT_TYPE_PATTERN = /^[a-z][a-z-]*\.[a-z][a-z-]*$/;
const MAX_SEARCH_PAGE_SIZE = 20;
const MAX_SEARCH_QUERY_LENGTH = 200;

/**
 * The ThumbHash the mock gives every processed asset's preview, standing in for one computed from
 * its pixels. The `placeholder` resource serves it as a PNG, like the CDN.
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
    testInput: asset.classification.testInput,
    moderation: { status: asset.classification.moderation.status },
  },
  content: { status: asset.content.status },
});

/** The moderation status each `asset.<status>` event announces. */
const ANNOUNCED_STATUS: Partial<Record<string, Asset["classification"]["moderation"]["status"]>> = {
  "asset.allowed": "allowed",
  "asset.limited": "limited",
  "asset.age-restricted": "age-restricted",
  "asset.blocked": "blocked",
  "asset.purged": "purged",
};

/** A `moderate` answer or `completeProcessing` decision as a checked `MockDecision`. */
const toDecision = (value: unknown): MockDecision => {
  if (value instanceof MockDecision) return value;
  if (typeof value === "string") return new MockDecision(value as MockAssetOutcome);
  throw invalidArgument("a decision must be a status or a mockDecision(...)");
};

/** An asset's portal link, as event facts carry it. */
const assetNameFact = (asset: Asset) => ({
  key: "asset-name",
  value: asset.name,
  url: `https://calmlens.com/go/asset/${asset.id}`,
});

/** The page the mock serves at `/embed`, standing in for the CDN's embed page. */
const MOCK_EMBED_HTML =
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Embed</title></head><body></body></html>';

/** A ThumbHash as the PNG the placeholder resource serves. */
const mockPlaceholderPng = (thumbhash: string) =>
  Uint8Array.from(atob(placeholderHashToDataURL(thumbhash).split(",", 2)[1]!), (char) =>
    char.charCodeAt(0),
  );

/** Removing or withholding content removes its rendered file and preview, as the API does. */
const NO_RENDERING = { rendered: null, preview: null, hls: null, hlsStatus: null } as const;

/** The size of the waveform the API makes as an audio asset's preview. */
const WAVEFORM_SIZE = { width: 1200, height: 300 } as const;

/** Audio and video formats browsers play as uploaded, so the API serves them as stored (Asset.ts). */
const BROWSER_SAFE_MEDIA_FORMATS: readonly string[] = [
  "video/mp4",
  "audio/mpeg",
  "audio/aac",
  "audio/mp4",
  "audio/x-m4a",
  "audio/ogg",
];

/** Spreadsheets, which have no rendered file or preview (Asset.ts). */
const SPREADSHEET_MIME_TYPES: readonly string[] = [
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel.sheet.macroenabled.12",
  "application/vnd.ms-excel",
  "application/vnd.oasis.opendocument.spreadsheet",
];

/** Whether browsers play an audio or video upload's format as it is, so it is served as stored. */
const isBrowserSafeMediaFormat = (format: string | null) =>
  BROWSER_SAFE_MEDIA_FORMATS.includes(normalizeUploadMimeType(format ?? ""));

/**
 * The rendered file and preview the API reports for an asset with its content held (Asset.ts,
 * getAssetRendered and getAssetPreview). Once uploaded, an image renders as itself with a preview
 * that has no ThumbHash yet, and a PDF and browser-safe audio and video render as uploaded. Once
 * processed, a website renders as its screenshot; a document or presentation as a PDF, with its
 * first page as the preview; video and audio as a browser-safe file (MP4 or M4A unless browsers
 * play the upload), audio with a waveform preview and video with no poster; and every preview has
 * its ThumbHash. Text, spreadsheets and other files have neither. The mock decodes nothing, so
 * sizes are unknown, audio has no peaks, and audio and video never get an HLS stream.
 */
const mockRendering = (
  asset: Asset,
  processed: boolean,
): Pick<Asset["content"], "rendered" | "preview" | "hls" | "hlsStatus"> => {
  const format = asset.content.format;
  const mimeType = normalizeUploadMimeType(format ?? "");
  const browserSafe = isBrowserSafeMediaFormat(format);
  const preview = (size: { width: number | null; height: number | null }) => ({
    ...size,
    thumbhash: processed ? MOCK_THUMBHASH : null,
    averageColor: processed ? "#7f7f7f" : null,
  });
  const unsized = { width: null, height: null };
  const rendersOnUpload =
    asset.type === "image" ||
    mimeType === "application/pdf" ||
    ((asset.type === "video" || asset.type === "audio") && browserSafe);
  if (!processed && !rendersOnUpload) return NO_RENDERING;
  switch (asset.type) {
    case "image":
      return {
        rendered: { kind: "image", format: format ?? "image/png", ...unsized },
        preview: preview(unsized),
        hls: null,
        hlsStatus: null,
      };
    case "website":
      return {
        rendered: { kind: "image", format: "image/png", ...unsized },
        preview: preview(unsized),
        hls: null,
        hlsStatus: null,
      };
    case "multimedia-document":
      if (SPREADSHEET_MIME_TYPES.includes(mimeType)) return NO_RENDERING;
      return {
        rendered: { kind: "pdf", format: "application/pdf", ...unsized },
        preview: processed ? preview(unsized) : null,
        hls: null,
        hlsStatus: null,
      };
    case "video":
      return {
        rendered: {
          kind: "video",
          format: browserSafe ? format! : "video/mp4",
          ...unsized,
        },
        preview: null,
        hls: null,
        hlsStatus: null,
      };
    case "audio":
      return {
        rendered: {
          kind: "audio",
          format: browserSafe ? format! : "audio/mp4",
          ...unsized,
          ...(processed && { peaks: [] }),
        },
        preview: processed ? preview(WAVEFORM_SIZE) : null,
        hls: null,
        hlsStatus: null,
      };
    default:
      return NO_RENDERING;
  }
};

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

/**
 * A request the API's schema refuses: `validation/invalid-request` with HTTP 400, listing the field
 * and its issue code (such as `validation/too-big`) in `details.issues`.
 */
/**
 * The mock's grant, the asset segment of a URL `signAssetUrl` signs: `sig_` and the hex of
 * `{assetId}.{1|0}.{expiresAt}`, its asset, original access and expiry. Every SDK's mock writes it
 * the same way. It is readable, not signed, as the mock has no secret to keep.
 */
const encodeMockGrant = (grant: { assetId: string; original: boolean; expiresAt: number }) =>
  `sig_${[
    ...new TextEncoder().encode(`${grant.assetId}.${grant.original ? 1 : 0}.${grant.expiresAt}`),
  ]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;

/** Reads a mock grant, or `undefined` for a segment the mock didn't sign. */
const decodeMockGrant = (
  segment: string,
): { assetId: string; original: boolean; expiresAt: number } | undefined => {
  const hex = segment.slice("sig_".length);
  if (!/^(?:[0-9a-f]{2})+$/.test(hex)) return undefined;
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(
      Uint8Array.from(hex.match(/../g)!, (pair) => Number.parseInt(pair, 16)),
    );
  } catch {
    return undefined;
  }
  const match = /^(.+)\.([01])\.(\d+)$/s.exec(text);
  if (!match) return undefined;
  return { assetId: match[1]!, original: match[2] === "1", expiresAt: Number(match[3]) };
};

const invalidField = (code: string, path: string) =>
  new ApiFailure(400, API_ERROR_CODES.INVALID_REQUEST, `Invalid ${path}`, {
    issues: [{ path, message: `Invalid ${path}`, code }],
  });

/** The asset fields an upload carries in its body; the API refuses them in the query string. */
const UPLOAD_OPTION_KEYS = [
  "name",
  "description",
  "processingOptions",
  "visibility",
  "metadata",
  "tags",
  "authorId",
  "context",
  "externalId",
  "externalUrl",
  "folderId",
  "uploadPresetId",
] as const;

const indexOfBytes = (haystack: Uint8Array, needle: Uint8Array, from = 0) => {
  for (let index = haystack.indexOf(needle[0]!, from); index !== -1; ) {
    if (index + needle.length > haystack.length) return -1;
    let offset = 1;
    while (offset < needle.length && haystack[index + offset] === needle[offset]) offset++;
    if (offset === needle.length) return index;
    index = haystack.indexOf(needle[0]!, index + 1);
  }
  return -1;
};

/** An upload form as the API reads it: the `options` part's JSON text, then the `file` part. */
interface UploadForm {
  options: string;
  bytes: Uint8Array<ArrayBuffer>;
}

/**
 * Reads a raw upload's `multipart/form-data` body like the API: an `options` part, then a `file`
 * part, then the closing boundary. Anything else is refused.
 */
const readUploadForm = (request: MockRequest): UploadForm => {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.split(";")[0]!.trim().toLowerCase() !== "multipart/form-data") {
    throw new ApiFailure(
      415,
      API_ERROR_CODES.UNSUPPORTED_CONTENT_TYPE,
      "Send a raw upload as multipart/form-data: an options part, then a file part.",
      { contentType: contentType.split(";")[0]!.trim() || null },
    );
  }
  const boundary = /;\s*boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  const invalid = (message: string) => fail(API_ERROR_CODES.INVALID_UPLOAD_PAYLOAD, { message });
  if (!boundary) throw invalid("The multipart/form-data Content-Type needs a boundary");
  const encoder = new TextEncoder();
  const delimiter = encoder.encode(`\r\n--${boundary[1] ?? boundary[2]}`);
  const body = new Uint8Array(2 + request.bytes.length);
  body.set(encoder.encode("\r\n"));
  body.set(request.bytes, 2);
  const parts: Array<{ name: string | undefined; content: Uint8Array<ArrayBuffer> }> = [];
  let at = indexOfBytes(body, delimiter);
  while (at !== -1) {
    const start = at + delimiter.length;
    if (body[start] === 0x2d && body[start + 1] === 0x2d) break;
    const headerEnd = indexOfBytes(body, encoder.encode("\r\n\r\n"), start);
    const next = headerEnd === -1 ? -1 : indexOfBytes(body, delimiter, headerEnd + 4);
    if (next === -1) throw invalid("The upload body ended before its closing boundary");
    const headers = new TextDecoder().decode(body.slice(start, headerEnd));
    const name = /content-disposition:\s*form-data\s*;[^\r\n]*?\bname="([^"]*)"/i.exec(
      headers,
    )?.[1];
    parts.push({ name, content: body.slice(headerEnd + 4, next) });
    at = next;
  }
  if (at === -1) throw invalid("The upload body ended before its closing boundary");
  if (parts.length !== 2 || parts[0]!.name !== "options" || parts[1]!.name !== "file") {
    throw invalid("The upload form must hold an options part, then a file part");
  }
  return { options: new TextDecoder().decode(parts[0]!.content), bytes: parts[1]!.content };
};

/** A request that names asset fields in its query, which the API refuses. */
const assertNoUploadOptionsInQuery = (query: URLSearchParams) => {
  const fields = UPLOAD_OPTION_KEYS.filter((key) => query.has(key));
  if (fields.length) throw fail(API_ERROR_CODES.UPLOAD_OPTIONS_IN_QUERY, { details: { fields } });
};

/**
 * Refuses `metadata` the API's schema refuses (METADATA_ITEM_SCHEMA): it is `null` or a list of
 * `{ id, value }` objects with a string `id` and any JSON `value`.
 */
const checkMetadata = (metadata: unknown) => {
  if (metadata === undefined || metadata === null) return;
  if (!Array.isArray(metadata)) throw invalidField("validation/invalid-type", "metadata");
  metadata.forEach((item: unknown, index) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw invalidField("validation/invalid-type", `metadata.${index}`);
    }
    if (typeof (item as { id?: unknown }).id !== "string") {
      throw invalidField("validation/invalid-type", `metadata.${index}.id`);
    }
    if ((item as { value?: unknown }).value === undefined) {
      throw invalidField("validation/invalid-value", `metadata.${index}.value`);
    }
  });
};

/** A request as the in-memory API reads it. */
interface MockRequest {
  method: string;
  url: string;
  /** Decoded path segments after the base URL. */
  segments: string[];
  /** The same path segments as sent, still percent-encoded. */
  rawSegments: string[];
  query: URLSearchParams;
  headers: Headers;
  bytes: Uint8Array<ArrayBuffer>;
  cdn: boolean;
}

/** What a handler answers: the success status and the JSON body. */
type Answer = [status: number, body: unknown];

/** The built-in presets the mock knows, by display name. */
const MOCK_PRESET_NAMES = {
  "general-community": "General",
  "children-platform": "Kids",
  "education-support": "Learning and support",
  "wholesome-community": "Teen-safe",
} as const;
type MockPresetId = keyof typeof MOCK_PRESET_NAMES;

/** A stored policy: the API's shape without its derived fields, plus its reset baseline. */
interface MockPolicy extends Omit<Policy, "preset" | "projectIds"> {
  preset: { id: MockPresetId; version: number; own: boolean } | null;
  /** Whether the organisation's own preset policy follows its preset (mode `live`). */
  followsPreset: boolean;
  baseline: Policy["settings"];
}

/**
 * The settings of the mock's presets: every category with its default action (`allow` for
 * personal information and profanity, `block` otherwise) and no rules. The mock holds no built-in
 * preset settings, and uploads are never decided by a policy.
 */
const mockPresetSettings = (): Policy["settings"] =>
  ({
    categorySettings: Object.fromEntries(
      CLASSIFICATION_CATEGORIES.map((category) => [
        category,
        {
          action:
            category === "personal-information" || category === "profanity" ? "allow" : "block",
          allowances: [],
          restrictions: [],
        },
      ]),
    ),
  }) as unknown as Policy["settings"];

/**
 * Refuses settings the API refuses (MODERATION_POLICY_SETTINGS_SCHEMA): every category, each with
 * an `action` and its `allowances` and `restrictions` lists.
 */
const checkPolicySettings = (settings: unknown) => {
  const categories = (settings as { categorySettings?: Record<string, unknown> })?.categorySettings;
  if (!categories || typeof categories !== "object")
    throw invalidField("validation/invalid-type", "settings.categorySettings");
  for (const category of CLASSIFICATION_CATEGORIES) {
    const value = categories[category] as Record<string, unknown> | undefined;
    if (!value || typeof value !== "object")
      throw invalidField("validation/invalid-type", `settings.categorySettings.${category}`);
    for (const key of ["allowances", "restrictions"])
      if (!Array.isArray(value[key]))
        throw invalidField(
          "validation/invalid-type",
          `settings.categorySettings.${category}.${key}`,
        );
    if (typeof value.action !== "string")
      throw invalidField(
        "validation/invalid-value",
        `settings.categorySettings.${category}.action`,
      );
  }
  for (const key of Object.keys(categories))
    if (!(CLASSIFICATION_CATEGORIES as readonly string[]).includes(key))
      throw invalidField("validation/unknown-field", `settings.categorySettings.${key}`);
};

/** The client methods that send a request, the one it is recorded under first. */
const operationsOf = (request: MockRequest): MockCalmLensOperation[] => {
  const { method, segments, query, cdn } = request;
  if (cdn) return segments[3] === "info" ? ["cdn.getAssetInfo"] : ["cdn.serve"];
  const [root] = segments;
  if (root === "projects") {
    const route = segments.slice(2).join("/");
    switch (route) {
      case "events":
        return ["events.list", "events.pages"];
      case "lenses":
        return method === "GET"
          ? ["lenses.list", "lenses.iterate"]
          : method === "POST"
            ? ["lenses.create"]
            : ["ensureLenses", "ensureLens"];
      case "folders":
        return method === "GET" ? ["folders.list", "folders.iterate"] : ["folders.create"];
      case "hash-lists":
        return method === "GET" ? ["hashLists.list", "hashLists.iterate"] : ["hashLists.create"];
      case "policy":
        return method === "GET" ? ["policies.retrieveAssigned"] : ["policies.assign"];
      case "upload-presets":
        return method === "GET"
          ? ["uploadPresets.list", "uploadPresets.iterate"]
          : ["uploadPresets.ensure"];
      case "settings":
        return method === "GET" ? ["projectSettings.get"] : ["projectSettings.update"];
      case "metadata-fields":
        return method === "GET" ? ["metadataFields.list"] : ["metadataFields.ensure"];
      case "assets/search":
        return ["assets.search"];
      case "assets/batch":
        return ["assets.batch"];
      case "signed-asset-urls":
        return ["cdn.signAssetUrl"];
      case "assets":
        if (method === "GET") return ["assets.list", "assets.iterate"];
        if (query.get("wait") === "false") return ["assets.create"];
        return isTextUpload(request) ? ["assets.classify", "text.classify"] : ["assets.classify"];
    }
    if (segments[2] === "assets" && segments[4] === "timeline" && segments.length === 5) {
      return ["assets.listTimeline", "assets.iterateTimeline"];
    }
    if (segments[2] === "metadata-fields" && segments.length === 4)
      return ["metadataFields.delete"];
    return [];
  }
  if (root === "policies") {
    const [, policyId, policyAction] = segments;
    if (policyId === undefined)
      return method === "GET" ? ["policies.list", "policies.iterate"] : ["policies.create"];
    if (policyAction === "reset") return ["policies.reset"];
    if (policyAction === "upgrade") return ["policies.upgrade"];
    if (policyAction === "automatic-updates") return ["policies.setAutomaticUpdates"];
    return method === "GET"
      ? ["policies.retrieve"]
      : method === "PATCH"
        ? ["policies.update"]
        : ["policies.delete"];
  }
  if (root === "lenses" && segments[1] !== undefined) {
    return method === "GET"
      ? ["lenses.retrieve"]
      : method === "PATCH"
        ? ["lenses.update"]
        : ["lenses.delete"];
  }
  if (root === "upload-presets" && segments.length === 2) return ["uploadPresets.delete"];
  if (root === "upload-presets") {
    // App clients: `/upload-presets/:id/assets[/:assetId[/part]]`.
    if (segments[3] === undefined) {
      return [query.get("wait") === "false" ? "assets.create" : "assets.classify"];
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
      return method === "GET"
        ? ["hashLists.listEntries", "hashLists.iterateEntries"]
        : ["hashLists.addEntry"];
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
      return ["assets.removeContent"];
    case "children":
      return ["assets.listChildren", "assets.iterateChildren"];
    case "part":
      return ["assets.uploadPart"];
    case "move":
      return ["assets.move"];
    case "retry":
      return ["assets.retry"];
    case "explain":
      return ["assets.explain"];
    case "decision":
      return ["assets.decide"];
  }
  return [];
};

/** A plain-text upload: the SDKs send text as a JSON body with `content.plainText`. */
const isTextUpload = (request: MockRequest) => {
  if (request.headers.get("x-calmlens-upload")) return false;
  try {
    const body = JSON.parse(new TextDecoder().decode(request.bytes));
    return typeof body?.content?.plainText === "string";
  } catch {
    return false;
  }
};

/** Like the API: a new folder is 201 Created, a queued batch 202 Accepted, everything else 200. */
const SUCCESS_STATUS: Partial<Record<MockCalmLensOperation, number>> = {
  "folders.create": 201,
  "hashLists.create": 201,
  "policies.create": 201,
  "assets.batch": 202,
};

const decodeSegment = (segment: string) => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
};

/** The upload fields of a create request, from its JSON body or its upload form's options. */
interface UploadFields {
  name: string;
  description?: string;
  processingOptions?: ProcessingOptions;
  visibility?: Asset["visibility"];
  metadata?: Asset["metadata"];
  tags?: Asset["tags"];
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
  /** The CDN base URL of the client sending the current request, for the URLs it signs. */
  private cdnBaseUrl = "";
  private readonly lenses = new Map<string, Lens>();
  private readonly eventFeed: TypedEvent[] = [];
  /** Each asset's latest `assetSequence`, which the API keeps on the asset row. */
  private readonly assetEventSequences = new Map<string, number>();
  /** The processing options each asset was uploaded with, which the API keeps but doesn't return. */
  private readonly processingOptions = new Map<string, ProcessingOptions>();
  /**
   * The decided assets whose re-run (`assets.explain` with `rerun`) is still queued; they keep
   * their decision until `completeProcessing` decides them.
   */
  private readonly pendingReruns = new Set<string>();
  /** What each open multipart upload was started with, as the API saves it. */
  private readonly openUploads = new Map<string, { queue: boolean; totalSizeInBytes?: number }>();
  private readonly idempotentResults = new Map<
    string,
    { fingerprint: string; status: number; body: string }
  >();
  private readonly pendingFailures: Array<{ failure: MockRequestFailure } & MockFailureOptions> =
    [];
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
  failNextRequest(failure: MockRequestFailure, options: MockFailureOptions = {}): void {
    if (
      options.operation !== undefined &&
      !(MOCK_OPERATIONS as readonly string[]).includes(options.operation)
    ) {
      throw invalidArgument(`${options.operation} is not a client method that sends requests`);
    }
    const isApiError = typeof failure === "string" && failure in API_ERROR_DEFINITIONS;
    if (!isApiError && (options.details !== undefined || options.retryAfter !== undefined)) {
      throw invalidArgument("details and retryAfter apply only to an API error code");
    }
    if (
      options.retryAfter !== undefined &&
      !(Number.isInteger(options.retryAfter) && options.retryAfter >= 0)
    ) {
      throw invalidArgument("retryAfter must be a whole number of seconds");
    }
    this.pendingFailures.push({ failure, ...options });
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
  async enqueueEvent(input: MockEventInput): Promise<TypedEvent> {
    // Like the API's events, one about an asset carries the asset as it is now, with the
    // moderation status an `asset.<status>` event announces.
    const asset =
      input.asset === undefined && input.assetId
        ? await this.databaseStorage.getAsset(input.assetId)
        : undefined;
    if (!asset) return this.pushEvent(input);
    const snapshot = toEventAsset(asset);
    const announced = ANNOUNCED_STATUS[input.type];
    if (announced) snapshot.classification.moderation.status = announced;
    return this.pushEvent({ ...input, asset: snapshot } as MockEventInput);
  }

  /** Adds an event to the feed, filling the fields the API always sets. */
  private pushEvent(input: MockEventInput): TypedEvent {
    const now = this.now();
    const event = {
      id: this.createId("evt"),
      projectId: this.projectId,
      severity: "low",
      title: input.type,
      description: null,
      assetId: null,
      asset: null,
      // The mock's API key, which has no ID, unless the event names someone else.
      actor: MOCK_API_KEY_ACTOR,
      facts: [],
      createdAt: now,
      ...input,
    } as TypedEvent;
    // Like the API: each event about an asset takes the asset's next number; others have none.
    const sequence = event.assetId ? (this.assetEventSequences.get(event.assetId) ?? 0) + 1 : null;
    if (event.assetId && sequence !== null) this.assetEventSequences.set(event.assetId, sequence);
    event.assetSequence = sequence;
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
    return structuredClone(await this.recordDecision(asset, decision));
  }

  /**
   * Finishes processing a pending asset as the pipeline would (see
   * `MockCalmLensServerClient.completeProcessing`): with `decision`, or else what `moderate`
   * returns for the `complete` trigger.
   */
  async completeProcessing(
    assetId: string,
    decision?: MockAssetOutcome | MockDecision,
  ): Promise<Asset> {
    let asset: Asset;
    try {
      asset = await this.findOwnAsset(assetId);
    } catch (failure) {
      throw this.toError(failure);
    }
    const rerun = this.pendingReruns.has(asset.id);
    if (!rerun && asset.classification.status !== "processing") {
      throw invalidArgument(`asset ${assetId} isn't processing`);
    }
    const settled = decision === undefined ? undefined : toDecision(decision);
    if (!rerun) return structuredClone(await this.moderateStored(asset, "complete", settled));
    return structuredClone(
      await this.settleRerun(asset, settled ?? (await this.decisionFor(asset, "complete", true))),
    );
  }

  /**
   * `POST /assets/:assetId/decision`, like the API: an asset still uploading or processing can't
   * be decided, one pending moderation can only be blocked or purged, a decision must change the
   * status and purged content can only be blocked. The review is the API key's, and mock API keys
   * have no ID or name, so its ID is `null` and the event names the reviewer "An API key".
   */
  private async decideAsset(assetId: string, body: Record<string, unknown>): Promise<Asset> {
    const { decision, note: rawNote } = body;
    if (decision === "purged") {
      if (body.confirmPurge !== true)
        throw invalidField("validation/invalid-value", "confirmPurge");
    } else if (!REVIEW_DECISIONS.includes(decision as MockReviewDecision)) {
      throw invalidField("validation/invalid-value", "decision");
    }
    if (typeof rawNote !== "string") throw invalidField("validation/invalid-type", "note");
    const note = rawNote.trim();
    if (!note) throw invalidField("validation/too-small", "note");
    if (note.length > MAX_DECISION_NOTE_LENGTH) throw invalidField("validation/too-big", "note");
    const asset = await this.findOwnAsset(assetId);
    if (asset.upload.status === "uploading" || asset.classification.status === "processing") {
      throw fail(API_ERROR_CODES.ASSET_PROCESSING);
    }
    const status = asset.classification.moderation.status;
    if (decision !== "purged" && decision !== "blocked" && status === "pending") {
      throw fail(API_ERROR_CODES.ASSET_DECISION_NOT_ALLOWED);
    }
    if (status === decision) throw fail(API_ERROR_CODES.ASSET_DECISION_UNCHANGED);
    if (decision !== "purged" && decision !== "blocked" && status === "purged") {
      throw fail(API_ERROR_CODES.ASSET_CONTENT_PURGED);
    }
    return this.recordDecision(asset, decision as MockReviewDecision, { note });
  }

  /**
   * Sets the reviewer's decision: the moderation status, a manual review and the
   * `asset.<status>` event (after `asset.content-removed` when purging). Either way the review is
   * the mock API key's; the test hook records no note, the API's handler records it.
   */
  private async recordDecision(
    asset: Asset,
    decision: MockReviewDecision,
    review?: { note: string },
  ): Promise<Asset> {
    // Like the API: a queued re-run no longer replaces a reviewed decision.
    this.pendingReruns.delete(asset.id);
    const decided = await this.applyOutcome(asset, decision, "requested");
    const now = this.now();
    // Like the API: the human review queue's decision settles its review, one through the API
    // leaves it waiting.
    if (!review) decided.classification.moderation.pendingReview = null;
    decided.classification.moderation.manualReviews = [
      ...(decided.classification.moderation.manualReviews ?? []),
      {
        id: this.createId("rev"),
        decision,
        note: review?.note ?? null,
        // Mock API keys have no ID.
        decidedBy: { type: "api-key", id: null },
        reviewedAt: now,
        applied: true,
      },
    ];
    const stored = await this.databaseStorage.updateAsset(decided);
    if (decision === "purged")
      this.recordLifecycleEvent("asset.content-removed", stored, {
        actor: review ? MOCK_API_KEY_ACTOR : MOCK_REVIEWER_ACTOR,
      });
    this.pushEvent({
      type: `asset.${decision}`,
      // Like the event catalog: only allowing and limiting are low severity.
      severity: decision === "allowed" || decision === "limited" ? "low" : "high",
      title: `asset.${decision}`,
      assetId: stored.id,
      asset: toEventAsset(stored),
      // A decision through the API is the API key's; the test hook's is a reviewer's.
      actor: review ? MOCK_API_KEY_ACTOR : MOCK_REVIEWER_ACTOR,
      facts: [
        { key: "asset-type", value: stored.type },
        {
          key: "asset-name",
          value: stored.name,
          url: `https://calmlens.com/go/asset/${stored.id}`,
        },
        ...(review ? [{ key: "reviewer-name", value: API_KEY_REVIEWER_NAME }] : []),
        { key: "note", value: review?.note ?? null },
      ],
    } as MockEventInput);
    return stored;
  }

  /** The `CalmLensError` the real client throws for an API failure, for helpers that send none. */
  private toError(failure: unknown): unknown {
    if (!(failure instanceof ApiFailure)) return failure;
    const requestId = `mock-request-${++this.requestCount}`;
    return new CalmLensError(failure.code, {
      message: failure.message,
      status: failure.status,
      details: failure.details ?? {},
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
    this.cdnBaseUrl = endpoints.cdnBaseUrl;
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
      rawSegments: path.split("/").filter(Boolean),
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
      const [{ failure, details, retryAfter }] = this.pendingFailures.splice(index, 1) as [
        { failure: MockRequestFailure } & MockFailureOptions,
      ];
      if (typeof failure === "string" && failure in API_ERROR_DEFINITIONS) {
        return this.answered(
          call,
          this.failureResponse(fail(failure as ApiErrorCode, { details }), url, retryAfter),
        );
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

  private describeBody(request: MockRequest): unknown {
    const { bytes, headers } = request;
    if (bytes.byteLength === 0) return undefined;
    const type = headers.get("content-type") ?? "";
    if (type.startsWith("multipart/form-data")) {
      try {
        const form = readUploadForm(request);
        const file = request.query.get("contentType") ?? "";
        return {
          options: JSON.parse(form.options),
          file: file.startsWith("text/")
            ? new TextDecoder().decode(form.bytes)
            : form.bytes.slice(),
        };
      } catch {
        return bytes.slice();
      }
    }
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
    requestId = `mock-request-${++this.requestCount}`,
  ): Response {
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
    requestId?: string,
  ): Response {
    return this.response(
      status,
      JSON.stringify(body),
      url,
      { "Content-Type": "application/json", ...headers },
      requestId,
    );
  }

  /** The API's error body: `{ code, message, requestId, details }`, `requestId` as in the header. */
  private failureResponse(failure: ApiFailure, url: string, retryAfter?: number): Response {
    const requestId = `mock-request-${++this.requestCount}`;
    return this.jsonResponse(
      failure.status,
      {
        code: failure.code,
        message: failure.message,
        requestId,
        details: failure.details ?? {},
      },
      url,
      retryAfter === undefined ? {} : { "Retry-After": String(retryAfter) },
      requestId,
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
    // Like the API, raw uploads are told apart by their query, type and length, not their bytes,
    // and an upload form by its options too, but not its boundary.
    const upload = headers.get("x-calmlens-upload");
    const contentType = headers.get("content-type");
    const isForm = !!upload && /^multipart\/form-data\b/i.test(contentType ?? "");
    let formOptions: string | undefined;
    if (isForm && request.segments.at(-1) !== "part") {
      try {
        formOptions = readUploadForm(request).options;
      } catch {
        // The route refuses it below.
      }
    }
    const fingerprint = JSON.stringify([
      request.method,
      request.segments,
      [...request.query].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
      isForm ? "multipart/form-data" : contentType,
      upload,
      upload ? request.bytes.byteLength : new TextDecoder().decode(request.bytes),
      formOptions ?? null,
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
        case "GET assets":
          return [200, await this.listAssets(request.query)];
        case "GET assets/search":
          return [200, await this.searchAssets(request.query)];
        case "POST assets/batch":
          return [202, await this.batch(this.json(request))];
        case "POST signed-asset-urls":
          return [200, await this.signAssetUrl(this.json(request))];
        case "GET events":
          return [200, this.listEvents(request.query)];
        case "GET folders":
          return [200, await this.listFolders(request.query)];
        case "POST folders":
          return [201, await this.createFolder(this.json(request))];
        case "GET hash-lists":
          return [200, this.listHashLists(request.query)];
        case "POST hash-lists":
          return [201, this.createHashList(this.json(request))];
        case "PUT lenses":
          return [200, this.ensureLenses(this.json(request))];
        case "GET lenses":
          return [200, this.listLenses(request.query)];
        case "POST lenses":
          return [201, this.createLens(this.json(request))];
        case "GET policy":
          return [200, this.toPolicy(this.findPolicy(this.ensurePolicies()))];
        case "PUT policy":
          return [200, this.assignPolicy(this.json(request))];
        case "GET upload-presets":
          return [200, this.listUploadPresets(request.query)];
        case "PUT upload-presets":
          return [200, this.ensureUploadPresets(this.json(request))];
        case "GET settings":
          return [200, this.toProjectSettings()];
        case "PUT settings":
          return [200, this.updateProjectSettings(this.json(request))];
        case "GET metadata-fields":
          return [200, this.toMetadataFields()];
        case "PUT metadata-fields":
          return [200, this.ensureMetadataFields(this.json(request))];
      }
      const [, , collection, itemId, itemAction, ...more] = segments;
      if (collection === "metadata-fields" && itemId !== undefined && itemAction === undefined) {
        if (method === "DELETE") return [200, this.deleteMetadataField(itemId, request.query)];
      }
      if (
        collection === "assets" &&
        itemId !== undefined &&
        itemAction === "timeline" &&
        more.length === 0 &&
        method === "GET"
      ) {
        return [200, await this.listTimeline(itemId, request.query)];
      }
    }
    if (root === "policies" && rest.length === 0) {
      if (id === undefined) {
        if (method === "GET") return [200, this.listPolicies(request.query)];
        if (method === "POST") return [201, this.createPolicy(this.json(request))];
      } else {
        switch (`${method} ${action ?? ""}`) {
          case "GET ":
            return [200, this.toPolicy(this.findPolicy(id))];
          case "PATCH ":
            return [200, this.updatePolicy(id, this.json(request))];
          case "DELETE ":
            return [200, this.deletePolicy(id)];
          case "POST reset":
            return [200, this.restorePolicy(id, "reset", this.json(request))];
          case "POST upgrade":
            return [200, this.restorePolicy(id, "upgrade", this.json(request))];
          case "PUT automatic-updates":
            return [200, this.setPolicyAutomaticUpdates(id, this.json(request))];
        }
      }
    }
    if (root === "lenses" && id !== undefined && action === undefined) {
      switch (method) {
        case "GET":
          return [200, this.findLens(id)];
        case "PATCH":
          return [200, this.updateLens(id, this.json(request))];
        case "DELETE":
          return [200, this.deleteLens(id)];
      }
    }
    if (root === "upload-presets" && id !== undefined && action === undefined) {
      if (method === "DELETE") return [200, this.deleteUploadPreset(id)];
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
        case "POST move":
          return [200, await this.moveAsset(id, this.json(request))];
        case "POST retry":
          return [200, await this.retryAsset(id)];
        case "POST explain":
          return [200, await this.explainAsset(id, this.json(request))];
        case "POST decision":
          return [200, await this.decideAsset(id, this.json(request))];
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
    throw fail(API_ERROR_CODES.ROUTE_NOT_FOUND, {
      message: `No route for ${method} /${segments.join("/")}`,
    });
  }

  // ---- Policies ----------------------------------------------------------------------------
  // The project starts on the organisation's own General preset policy, following automatic
  // updates. The mock's presets have one release, version 1, with `mockPresetSettings`.

  private readonly policies = new Map<string, MockPolicy>();
  private projectPolicyId: string | undefined;

  /** The project's policy, after creating the organisation's own General policy on first use. */
  private ensurePolicies(): string {
    if (this.projectPolicyId) return this.projectPolicyId;
    const now = this.now();
    const general = this.newPolicy({
      name: MOCK_PRESET_NAMES["general-community"],
      settings: mockPresetSettings(),
      followsPreset: true,
      preset: { id: "general-community", version: 1, own: true },
      createdAt: now,
    });
    this.projectPolicyId = general.id;
    return general.id;
  }

  private newPolicy(values: {
    name: string;
    description?: string;
    settings: Policy["settings"];
    followsPreset?: boolean;
    preset?: { id: MockPresetId; version: number; own: boolean };
    createdAt: number;
  }): MockPolicy {
    const policy: MockPolicy = {
      id: this.createId("pol"),
      name: values.name,
      description: values.description ?? "",
      settings: values.settings,
      revision: 1,
      followsPreset: values.followsPreset ?? false,
      preset: values.preset ?? null,
      baseline: structuredClone(values.settings),
      createdAt: values.createdAt,
      updatedAt: values.createdAt,
    };
    this.policies.set(policy.id, policy);
    return policy;
  }

  private toPolicy(policy: MockPolicy): Policy {
    const { baseline: _baseline, preset, followsPreset, ...rest } = policy;
    return {
      ...structuredClone(rest),
      preset: preset && {
        id: preset.id,
        version: preset.version,
        latestVersion: 1,
        mode: preset.own ? (followsPreset ? "live" : "pinned") : "copy",
      },
      projectIds: policy.id === this.projectPolicyId ? [this.projectId] : [],
    };
  }

  private findPolicy(policyId: string): MockPolicy {
    this.ensurePolicies();
    const policy = this.policies.get(policyId);
    if (!policy) throw fail(API_ERROR_CODES.POLICY_NOT_FOUND);
    return policy;
  }

  /** A page of the organisation's policies, oldest first unless `sort` says otherwise. */
  private listPolicies(query: URLSearchParams): PolicyPage {
    this.ensurePolicies();
    return createPage(
      [...this.policies.values()].map((policy) => this.toPolicy(policy)),
      this.pageQuery(query),
      {
        scope: `policies:${this.projectId}`,
        fail: this.pageFailure,
        defaultSort: [{ field: "createdAt", direction: "asc" }],
      },
    );
  }

  private createPolicy(body: Record<string, unknown>): Policy {
    this.ensurePolicies();
    const { name, description, settings, presetId } = body;
    const preset = typeof presetId === "string" ? (presetId as MockPresetId) : undefined;
    if (
      (settings === undefined) === (preset === undefined) ||
      (preset !== undefined && !(preset in MOCK_PRESET_NAMES)) ||
      (preset === undefined && (typeof name !== "string" || !name.trim()))
    ) {
      throw fail(API_ERROR_CODES.INVALID_VALUE, {
        message: "Send settings with a name, or presetId",
      });
    }
    if (!preset) checkPolicySettings(settings);
    const policy = this.newPolicy({
      name: typeof name === "string" && name.trim() ? name.trim() : MOCK_PRESET_NAMES[preset!],
      ...(typeof description === "string" ? { description } : {}),
      settings: preset ? mockPresetSettings() : (settings as Policy["settings"]),
      ...(preset ? { preset: { id: preset, version: 1, own: false } } : {}),
      createdAt: this.now(),
    });
    return this.toPolicy(policy);
  }

  /** Saves new values under the next revision, once `revision` is the current one. */
  private savePolicy(policy: MockPolicy, revision: unknown, values: Partial<MockPolicy>) {
    if (revision !== policy.revision) throw fail(API_ERROR_CODES.POLICY_REVISION_CONFLICT);
    const saved: MockPolicy = {
      ...policy,
      ...values,
      revision: policy.revision + 1,
      updatedAt: this.now(),
    };
    this.policies.set(policy.id, saved);
    return this.toPolicy(saved);
  }

  private updatePolicy(policyId: string, body: Record<string, unknown>): Policy {
    const policy = this.findPolicy(policyId);
    if (body.settings !== undefined) checkPolicySettings(body.settings);
    return this.savePolicy(policy, body.revision, {
      ...(typeof body.name === "string" ? { name: body.name.trim() } : {}),
      ...(typeof body.description === "string" ? { description: body.description } : {}),
      ...(body.settings !== undefined ? { settings: body.settings as Policy["settings"] } : {}),
      // Saving a `live` policy pins it.
      followsPreset: false,
    });
  }

  /** Resets a `pinned` or `copy` policy to its preset release, or upgrades it to the latest. */
  private restorePolicy(
    policyId: string,
    operation: "reset" | "upgrade",
    body: Record<string, unknown>,
  ): Policy {
    const policy = this.findPolicy(policyId);
    if (!policy.preset || policy.followsPreset) throw fail(API_ERROR_CODES.POLICY_NO_PRESET);
    if (body.presetVersion !== policy.preset.version) {
      throw fail(API_ERROR_CODES.POLICY_PRESET_VERSION_CONFLICT);
    }
    // The mock's presets have one release, so an upgrade never has a newer one to apply.
    if (operation === "upgrade") throw fail(API_ERROR_CODES.POLICY_PRESET_UPDATE_UNAVAILABLE);
    return this.savePolicy(policy, body.revision, { settings: structuredClone(policy.baseline) });
  }

  private setPolicyAutomaticUpdates(policyId: string, body: Record<string, unknown>): Policy {
    const policy = this.findPolicy(policyId);
    const enabled = body.enabled === true;
    if (!policy.preset?.own || policy.followsPreset === enabled) {
      throw fail(API_ERROR_CODES.POLICY_AUTOMATIC_UPDATES_UNAVAILABLE);
    }
    if (body.revision !== policy.revision) throw fail(API_ERROR_CODES.POLICY_REVISION_CONFLICT);
    if (body.presetVersion !== 1) throw fail(API_ERROR_CODES.POLICY_PRESET_VERSION_CONFLICT);
    return this.savePolicy(policy, body.revision, {
      followsPreset: enabled,
      ...(enabled
        ? {
            name: MOCK_PRESET_NAMES[policy.preset.id],
            description: "",
            settings: structuredClone(policy.baseline),
          }
        : {}),
    });
  }

  private deletePolicy(policyId: string): Record<string, never> {
    const policy = this.findPolicy(policyId);
    if (policy.id === this.projectPolicyId) throw fail(API_ERROR_CODES.POLICY_IN_USE);
    this.policies.delete(policy.id);
    return {};
  }

  private assignPolicy(body: Record<string, unknown>): Policy {
    const policy = this.findPolicy(String(body.policyId));
    this.projectPolicyId = policy.id;
    return this.toPolicy(policy);
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
      createdAt: now,
      updatedAt: now,
    };
    this.hashLists.set(list.id, list);
    return list;
  }

  private listHashLists(query: URLSearchParams) {
    return createPage([...this.hashLists.values()], this.pageQuery(query), {
      scope: `hash-lists:${this.projectId}`,
      fail: this.pageFailure,
    });
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
    return createPage(
      [...this.hashListEntries.values()].filter((entry) => entry.hashListId === hashListId),
      this.pageQuery(query),
      { scope: `hash-list-entries:${hashListId}`, fail: this.pageFailure },
    );
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
      const { content } = await this.findOwnAsset(assetId);
      if (!content.perceptualHash) throw fail(API_ERROR_CODES.HASH_LIST_ASSET_NOT_HASHED);
      hash = content.perceptualHash;
      quality = content.perceptualHashQuality ?? null;
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
      assetId: assetId ?? null,
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
      throw invalidField("validation/invalid-type", "");
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

  /** The list's `sort`, from `fields`, as the API's `sortQueryField` reads it. */
  private sort(query: URLSearchParams, fields: readonly string[], max: number) {
    return parseSort(
      query.get("sort"),
      fields,
      max,
      () => invalidField("validation/invalid-value", "sort") as unknown as Error,
    );
  }

  private pageFailure = (
    code: "validation/too-small" | "validation/too-big" | "cursor/invalid",
    path?: string,
  ): Error =>
    (code === "cursor/invalid"
      ? fail(API_ERROR_CODES.INVALID_CURSOR)
      : invalidField(code, path ?? "pageSize")) as unknown as Error;

  /**
   * A cursor list's query, checked like CURSOR_PAGE_QUERY_SCHEMA before anything else: `pageSize`
   * from 1 to 100, and a `sort` of at most two fields from `createdAt` and `id`.
   */
  private pageQuery(query: URLSearchParams) {
    const pageSize = this.integer(query, "pageSize", DEFAULT_PAGE_SIZE);
    if (pageSize < 1) throw invalidField("validation/too-small", "pageSize");
    if (pageSize > 100) throw invalidField("validation/too-big", "pageSize");
    return {
      pageSize,
      cursor: query.get("cursor") ?? undefined,
      sort: this.sort(query, ["createdAt", "id"], 2),
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
    const page = this.pageQuery(query);
    const filter = query.get("filter") ?? undefined;
    try {
      assets = filterAssets(assets, filter);
    } catch (error) {
      if (error instanceof MockInvalidFilter) throw fail(API_ERROR_CODES.INVALID_FILTER);
      throw error;
    }
    return createPage(assets, page, {
      scope: JSON.stringify([this.projectId, filter ?? null]),
      fail: this.pageFailure,
    });
  }

  /**
   * Keyword search like the API's: every whitespace-separated token must appear,
   * case-insensitively, in the asset's name, ID, external ID, description, tags, type, content
   * format or extension, or moderation status. There is no semantic search.
   */
  private async searchAssets(params: URLSearchParams) {
    // Like the API's query schema: a trimmed query of 1 to 200 characters, 1 to 20 results.
    const query = (params.get("query") ?? "").trim();
    if (!query) throw invalidField("validation/too-small", "query");
    if (query.length > MAX_SEARCH_QUERY_LENGTH) throw invalidField("validation/too-big", "query");
    const pageSize = this.integer(params, "pageSize", 10);
    if (pageSize < 1) throw invalidField("validation/too-small", "pageSize");
    if (pageSize > MAX_SEARCH_PAGE_SIZE) throw invalidField("validation/too-big", "pageSize");
    const items = searchAssets(
      await this.databaseStorage.listAssets(this.projectId),
      query,
      pageSize,
    );
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

  /**
   * An asset's findings timeline, as the API lists it (publicGetAssetTimeline.ts): refused while a
   * safety hold is on. The mock analyses no audio or video, so it keeps no segments: every
   * timeline is empty, and no cursor continues one.
   */
  private async listTimeline(assetId: string, query: URLSearchParams) {
    const asset = await this.findOwnAsset(assetId);
    const pageSize = this.integer(query, "pageSize", DEFAULT_PAGE_SIZE);
    if (pageSize < 1) throw invalidField("validation/too-small", "pageSize");
    if (pageSize > 100) throw invalidField("validation/too-big", "pageSize");
    if (asset.content.safetyHold) {
      throw fail(API_ERROR_CODES.ASSET_HELD, { details: { hold: "safety" } });
    }
    if (query.get("cursor") !== null) throw fail(API_ERROR_CODES.INVALID_CURSOR);
    return { items: [], nextCursor: null, hasMore: false };
  }

  private async updateAsset(assetId: string, body: Record<string, unknown>): Promise<Asset> {
    checkMetadata(body.metadata);
    if (body.name === null) throw invalidField("validation/invalid-type", "name");
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

  /**
   * Signs an asset URL like the API (`POST /projects/:projectId/signed-asset-urls`): a grant to one
   * asset, by ID or external ID, until it expires, serving the original only when asked. The mock's
   * grant is readable (its asset, original access and expiry), unlike the CDN's, and only the
   * mock's CDN accepts it.
   */
  private async signAssetUrl(body: Record<string, unknown>) {
    // Like the API's schema, none of these fields takes null.
    for (const key of ["assetId", "externalId", "expiresIn", "original"]) {
      if (body[key] === null) throw invalidField("validation/invalid-type", key);
    }
    const { assetId, externalId } = body;
    if ((assetId === undefined) === (externalId === undefined)) {
      throw new ApiFailure(
        400,
        API_ERROR_CODES.INVALID_REQUEST,
        "Send either assetId or externalId",
        {
          issues: [{ path: "", message: "Send either assetId or externalId", code: "custom" }],
        },
      );
    }
    const expiresIn = body.expiresIn ?? 60 * 15;
    if (typeof expiresIn !== "number" || !Number.isInteger(expiresIn)) {
      throw invalidField("validation/invalid-type", "expiresIn");
    }
    if (expiresIn < 1) throw invalidField("validation/too-small", "expiresIn");
    if (expiresIn > 60 * 60 * 24) throw invalidField("validation/too-big", "expiresIn");
    const original = body.original ?? false;
    if (typeof original !== "boolean") throw invalidField("validation/invalid-type", "original");
    let asset: Asset | undefined;
    if (externalId !== undefined) {
      asset = (await this.databaseStorage.listAssets(this.projectId)).find(
        (candidate) => candidate.externalId === externalId,
      );
      if (!asset) throw fail(API_ERROR_CODES.ASSET_NOT_FOUND);
    } else {
      asset = await this.findOwnAsset(String(assetId));
    }
    if (asset.content.safetyHold) throw fail(API_ERROR_CODES.ASSET_HELD);
    const expiresAt = this.now() + expiresIn * 1000;
    const grant = encodeMockGrant({ assetId: asset.id, original, expiresAt });
    return {
      url: `${this.cdnBaseUrl}/assets/${encodeURIComponent(this.projectId)}/${grant}`,
      expiresAt,
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
    return this.moderateStored(retried, "retry");
  }

  private async explainAsset(assetId: string, body: Record<string, unknown>): Promise<Asset> {
    const asset = await this.findOwnAsset(assetId);
    if (asset.classification.status !== "completed") {
      throw fail(API_ERROR_CODES.ASSET_NOT_DECIDED);
    }
    if (!body.rerun) {
      // Like the API: the evidence is completed and every action stays as decided.
      const policy = asset.classification.moderation;
      if (policy?.explanationComplete !== false) return asset;
      return this.databaseStorage.updateAsset({
        ...asset,
        updatedAt: this.now(),
        classification: {
          ...asset.classification,
          moderation: {
            ...asset.classification.moderation,
            explanationComplete: true,
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
    // Like the API: the request is recorded, and the asset returns as it was. It keeps its
    // decision while it's moderated again under the current policy.
    this.pushEvent({
      type: "asset.rerun-requested",
      actor: MOCK_API_KEY_ACTOR,
      severity: "low",
      assetId: asset.id,
      asset: toEventAsset(asset),
      facts: [
        assetNameFact(asset),
        { key: "asset-type", value: asset.type },
        { key: "moderation-status", value: asset.classification.moderation.status },
      ],
    } as MockEventInput);
    const response = structuredClone(asset);
    await this.settleRerun(asset, await this.decisionFor(asset, "rerun", true));
    return response;
  }

  /**
   * Checks every asset like the API (an ID that is not an asset ID is
   * `validation/invalid-format`, an unknown
   * one `asset/not-found`, and either refuses the whole batch), then applies the operation at
   * once instead of in the background: `delete` deletes each asset with its stored child
   * assets and records `asset.deleted` with the asset as it was; `remove-content` removes
   * the content like `removeContent`. Each event carries the batch's `batch-id` fact. Mock assets
   * carry no safety holds, so none is skipped.
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
    const batchId = this.createId("batch");
    for (const asset of assets) {
      if (operation === "delete") {
        await this.deleteAssetTree(asset);
        this.recordLifecycleEvent("asset.deleted", asset, { batchId });
      } else {
        await this.removeContent(asset, batchId);
      }
    }
    return { batchId, status: "queued", assetCount: assets.length };
  }

  /**
   * Removes an asset's content like the API: the record and report stay; stored content,
   * extracted text and the placeholder go. Content already removed keeps its reason, and an
   * `asset.content-removed` event is recorded either way.
   */
  private async removeContent(asset: Asset, batchId?: string): Promise<Asset> {
    await this.imageStorage.deleteContent(asset.id);
    let removed = asset;
    if (asset.content.status === "removed") {
      if (asset.content.rendered || asset.content.preview) {
        removed = await this.databaseStorage.updateAsset({
          ...asset,
          content: { ...asset.content, ...NO_RENDERING },
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
          metadata: null,
          ...NO_RENDERING,
        },
        updatedAt: now,
      });
    }
    this.recordLifecycleEvent("asset.content-removed", removed, { batchId });
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

  /**
   * The upload fields of `POST .../assets`, from the JSON body (text and URLs) or an upload form's
   * options (files). Like the API, asset fields in the query are refused.
   */
  private uploadFields(request: MockRequest): UploadFields {
    const { query } = request;
    assertNoUploadOptionsInQuery(query);
    const upload = request.headers.get("x-calmlens-upload");
    if (upload !== "content" && upload !== "part") {
      const body = this.json(request);
      checkMetadata(body.metadata);
      const {
        content,
        part,
        sizeInBytes: _size,
        totalSizeInBytes,
        ...fields
      } = body as Record<string, unknown> & {
        content?: { plainText?: unknown; type?: unknown };
        part?: { plainText?: unknown; type?: unknown; partNumber?: unknown; isFinal?: unknown };
        totalSizeInBytes?: unknown;
      };
      const text = content ?? part;
      if (text === undefined) return fields as unknown as UploadFields;
      if (typeof text.plainText !== "string" || typeof text.type !== "string") {
        throw invalidField("validation/invalid-type", content ? "content" : "part");
      }
      return {
        ...(fields as unknown as UploadFields),
        contentType: text.type,
        bytes: new TextEncoder().encode(text.plainText) as Uint8Array<ArrayBuffer>,
        part: part
          ? {
              partNumber: typeof part.partNumber === "number" ? part.partNumber : 1,
              isFinal: part.isFinal === true,
              totalSizeInBytes: typeof totalSizeInBytes === "number" ? totalSizeInBytes : undefined,
            }
          : undefined,
      };
    }
    const form = readUploadForm(request);
    let options: Record<string, unknown>;
    try {
      options = JSON.parse(form.options);
    } catch {
      throw fail(API_ERROR_CODES.INVALID_UPLOAD_PAYLOAD, {
        message: "The options part must be a JSON object with the asset's fields",
      });
    }
    if (!options || typeof options !== "object" || Array.isArray(options)) {
      throw fail(API_ERROR_CODES.INVALID_UPLOAD_PAYLOAD, {
        message: "The options part must be a JSON object with the asset's fields",
      });
    }
    const unknown = Object.keys(options).find(
      (key) => !(UPLOAD_OPTION_KEYS as readonly string[]).includes(key),
    );
    if (unknown !== undefined) throw invalidField("validation/unknown-field", unknown);
    if (typeof options.name !== "string") throw invalidField("validation/invalid-type", "name");
    checkMetadata(options.metadata);
    const total = query.get("totalSizeInBytes");
    return {
      ...(options as unknown as UploadFields),
      contentType: query.get("contentType") ?? "",
      bytes: form.bytes,
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
    return this.storeAsset(
      this.applyUploadPreset(this.uploadFields(request)),
      request.query.get("wait") === "false",
    );
  }

  /**
   * An API-key upload through a preset, as the API applies it: the preset gives the folder and
   * visibility, which the upload can't change, and the processing options unless the upload sets
   * its own, and refuses types and sizes it doesn't accept.
   */
  private applyUploadPreset(fields: UploadFields): UploadFields {
    if (!fields.uploadPresetId) return fields;
    const preset = [...this.configuredPresets.values()].find(
      ({ id }) => id === fields.uploadPresetId,
    );
    if (!preset) throw fail(API_ERROR_CODES.UPLOAD_PRESET_NOT_FOUND);
    if (!preset.enabled) throw fail(API_ERROR_CODES.UPLOAD_PRESET_DISABLED);
    if (preset.folderId && fields.folderId && fields.folderId !== preset.folderId) {
      throw fail(API_ERROR_CODES.UPLOAD_PRESET_FIELD_NOT_ALLOWED, {
        details: { field: "folderId" },
      });
    }
    if (fields.visibility && fields.visibility !== preset.visibility) {
      throw fail(API_ERROR_CODES.UPLOAD_PRESET_FIELD_NOT_ALLOWED, {
        details: { field: "visibility" },
      });
    }
    const contentType = fields.contentType;
    if (
      preset.allowedContentTypes?.length &&
      contentType !== undefined &&
      !isFileAccepted(
        { name: fields.name, type: contentType },
        preset.allowedContentTypes.join(","),
      )
    ) {
      throw fail(API_ERROR_CODES.UNSUPPORTED_UPLOAD_TYPE, {
        details: {
          source: "preset",
          contentType,
          allowedContentTypes: preset.allowedContentTypes,
        },
      });
    }
    const size = fields.part?.totalSizeInBytes ?? fields.bytes?.byteLength;
    if (preset.maxSizeInBytes && size !== undefined && size > preset.maxSizeInBytes) {
      throw fail(API_ERROR_CODES.UPLOAD_TOO_LARGE, {
        details: { limitBytes: preset.maxSizeInBytes, source: "preset" },
      });
    }
    return {
      ...fields,
      folderId: preset.folderId ?? fields.folderId,
      visibility: preset.visibility,
      processingOptions:
        fields.processingOptions ?? (preset.processingOptions as UploadFields["processingOptions"]),
    };
  }

  private async storeAsset(fields: UploadFields, queue: boolean): Promise<Asset> {
    if (!fields.name)
      throw fail(API_ERROR_CODES.INVALID_UPLOAD_PAYLOAD, { message: "Asset name is required" });
    const { contentType, part } = fields;
    const bytes = fields.bytes ?? new Uint8Array(0);
    if (contentType !== undefined && !isAcceptedUploadMimeType(contentType)) {
      throw fail(API_ERROR_CODES.UNSUPPORTED_UPLOAD_TYPE, {
        message: getRejectedUploadMimeTypeError(contentType),
        details: { mimeType: contentType, source: "calmlens" },
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
          : this.multipartImageSizeError(type, part.totalSizeInBytes)) ??
        (part.isFinal
          ? (this.multipartTotalSizeError(part.totalSizeInBytes, partSize, true) ??
            this.multipartImageSizeError(type, partSize))
          : undefined);
      if (sizeError) throw this.sizeFailure(sizeError);
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
    this.processingOptions.set(id, processingOptions);
    const hasContent = fields.url === undefined;
    const contextItems = selectModerationContextItems(fields.context?.items ?? []);
    // Fields the API returns as `null` when they are not set.
    const asset: Asset = {
      id,
      projectId: this.projectId,
      parentId: null,
      parentPages: [],
      folderId: fields.folderId ?? null,
      uploadPresetId: fields.uploadPresetId ?? null,
      createdAt: now,
      updatedAt: now,
      name: fields.name,
      description: fields.description ?? null,
      externalId: fields.externalId ?? null,
      externalUrl: fields.url ?? fields.externalUrl ?? null,
      type,
      metadata: fields.metadata ?? [],
      authorId: fields.authorId ?? null,
      // Like the API, only the posts CalmLens uses are kept, and only while the content is held.
      context: contextItems.length ? { items: contextItems } : null,
      tags: fields.tags ?? [],
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
        // The mock decodes nothing, so the file's own details are unknown.
        width: null,
        height: null,
        durationSeconds: null,
        pageCount: null,
        perceptualHash: null,
        perceptualHashQuality: null,
        metadata: null,
        extractedText: null,
        // Like the API, the rendered file and preview come with processing.
        ...NO_RENDERING,
      },
      upload: {
        status: isOpenUpload ? "uploading" : "completed",
        updatedAt: now,
        // Like the API, only an open upload counts the parts received.
        partsReceived: isOpenUpload ? part.partNumber : null,
      },
      classification: {
        status: isOpenUpload ? "queued" : "processing",
        failureReason: null,
        updatedAt: now,
        completedAt: null,
        // The mock never reads test inputs.
        progress: null,
        testInput: false,
        moderation: {
          status: "pending",
          manualReviews: [],
          automatedStatus: null,
          policy: null,
          pendingReview: null,
          source: null,
          rule: null,
          explanationComplete: null,
          categories: null,
          flaggedCategories: [],
          regions: [],
          raw: null,
          timeline: null,
        },
        // Like the API, a feature's result is `null` until it has run.
        ocr: null,
        linkDetection: null,
      },
    } as unknown as Asset;

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

    if (isOpenUpload) return this.databaseStorage.createAsset(asset);
    if (hasContent) asset.content = { ...asset.content, ...mockRendering(asset, false) };
    const decision = await this.decisionFor(asset, "upload", queue, hasContent ? bytes : null);
    const stored = await this.databaseStorage.createAsset(
      decision.status === "pending" ? asset : await this.decided(asset, decision),
    );
    this.recordUploaded(asset);
    this.recordProcessingEvents(stored, decision);
    return stored;
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
      this.multipartImageSizeError(asset.type, received) ??
      this.multipartTotalSizeError(upload?.totalSizeInBytes, received, isFinal);
    if (sizeError) throw this.sizeFailure(sizeError);
    const validation = validateAssetPayload({ uint8Array: bytes }, { multipart: true, isFinal });
    if (!validation.ok) {
      throw fail(API_ERROR_CODES.INVALID_UPLOAD_PAYLOAD, { message: validation.error });
    }

    await this.imageStorage.putPart(assetId, { uint8Array: bytes, partNumber, isFinal });
    // `wait=false` queues the final part; without `wait`, the upload's saved choice applies.
    const waitOverride = query.get("wait");
    const queue = waitOverride === null ? (upload?.queue ?? false) : waitOverride === "false";
    if (isFinal) this.openUploads.delete(assetId);
    const now = this.now();
    const next: Asset = {
      ...asset,
      updatedAt: now,
      content: { ...asset.content, sizeInBytes: received },
      // Like the API, a completed upload no longer counts parts.
      upload: { ...asset.upload, updatedAt: now, partsReceived: isFinal ? null : partNumber },
    };
    if (!isFinal) return this.databaseStorage.updateAsset(next);
    const processing = await this.applyOutcome(next, "pending");
    const decision = await this.decisionFor(processing, "upload", queue);
    const stored = await this.databaseStorage.updateAsset(
      decision.status === "pending" ? processing : await this.decided(processing, decision),
    );
    this.recordUploaded(processing);
    this.recordProcessingEvents(stored, decision);
    return stored;
  }

  /** Like the API: image uploads in parts total at most 20 MiB, at any size below that. */
  private multipartImageSizeError(type: string, sizeInBytes: number): ApiErrorCode | undefined {
    if (type !== "image") return undefined;
    if (sizeInBytes > MAX_IMAGE_UPLOAD_BYTES) return API_ERROR_CODES.UPLOAD_TOO_LARGE;
    return undefined;
  }

  /** The failure for a size error code, with the limit `upload/too-large` carries. */
  private sizeFailure(code: ApiErrorCode) {
    return fail(
      code,
      code === API_ERROR_CODES.UPLOAD_TOO_LARGE
        ? { details: { limitBytes: MAX_IMAGE_UPLOAD_BYTES, source: "plan" } }
        : {},
    );
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

  /**
   * Asks `moderate` how to decide `asset`, with its content: `bytes` when the caller has them,
   * otherwise the stored parts in order (none once the content is removed).
   */
  private async decisionFor(
    asset: Asset,
    trigger: MockModerationTrigger,
    queued: boolean,
    bytes?: Uint8Array | null,
  ): Promise<MockDecision> {
    let data = bytes;
    if (data === undefined) {
      const stored =
        asset.content.status === "removed"
          ? undefined
          : await this.imageStorage.getContent(asset.id);
      const parts = stored
        ? [...stored.parts].sort(([a], [b]) => a - b).map(([, part]) => part)
        : [];
      data = stored ? new Uint8Array(await new Blob(parts as BlobPart[]).arrayBuffer()) : null;
    }
    const content = {
      bytes: data,
      text: data && asset.type === "plaintext-document" ? new TextDecoder().decode(data) : null,
    };
    return toDecision(
      await this.options.moderate({ asset: structuredClone(asset), content, trigger, queued }),
    );
  }

  /**
   * `asset` decided as `decision` says, with its report. Like the API for an image with nobody in
   * it, a decided image reports the person and face detection its upload turned on.
   */
  private async decided(asset: Asset, decision: MockDecision): Promise<Asset> {
    const next = await this.applyOutcome(
      asset,
      decision.status,
      "policy",
      decision.report(this.now()),
    );
    const features = this.processingOptions.get(asset.id)?.features;
    if (next.classification.status !== "completed" || asset.type !== "image") return next;
    return {
      ...next,
      classification: {
        ...next.classification,
        // The mock reads no text, QR codes, people or faces in an image: features find nothing.
        ...(features?.ocr?.enabled === true && {
          ocr: { status: "evaluated", textRegions: [] },
        }),
        ...(features?.linkDetection?.enabled !== false && {
          linkDetection: { status: "evaluated", qrCodes: [], links: [] },
        }),
        ...(features?.personDetection?.enabled === true && {
          personDetection: { status: "evaluated", people: [] },
        }),
        ...(features?.faceDetection?.enabled === true && {
          faceDetection: { status: "evaluated", faces: [] },
        }),
      },
    };
  }

  /**
   * Stores a processing asset's `decision` and records its events; a `pending` decision leaves it
   * processing.
   */
  private async settle(asset: Asset, decision: MockDecision): Promise<Asset> {
    if (decision.status === "pending") return asset;
    const stored = await this.databaseStorage.updateAsset(await this.decided(asset, decision));
    this.recordProcessingEvents(stored, decision);
    return stored;
  }

  /**
   * Applies a re-run's `decision` to a decided asset like the pipeline: a `pending` decision stays
   * queued for `completeProcessing`, a `failed` one keeps the asset's decision, and any other
   * replaces it with the pipeline's events.
   */
  private async settleRerun(asset: Asset, decision: MockDecision): Promise<Asset> {
    this.pendingReruns.delete(asset.id);
    if (decision.status === "pending") {
      this.pendingReruns.add(asset.id);
      return asset;
    }
    if (decision.status === "failed") return asset;
    return this.settle(asset, decision);
  }

  /** Asks `moderate` (unless `decision` is given) and settles a processing asset. */
  private async moderateStored(
    asset: Asset,
    trigger: MockModerationTrigger,
    decision?: MockDecision,
  ): Promise<Asset> {
    return this.settle(asset, decision ?? (await this.decisionFor(asset, trigger, true)));
  }

  /** `asset.uploaded`, as the API records it when an upload completes (UploadAssetUtils.ts). */
  private recordUploaded(asset: Asset): void {
    this.pushEvent({
      type: "asset.uploaded",
      severity: "low",
      assetId: asset.id,
      asset: toEventAsset(asset),
      facts: [
        { key: "asset-type", value: asset.type },
        assetNameFact(asset),
        { key: "file-format", value: asset.content.format ?? null },
      ],
    } as MockEventInput);
  }

  /**
   * The events the pipeline records when it settles an asset (AssetClassification.ts and
   * AssetErrorAlert.ts): `asset.classified` and the automated `asset.<status>`, or
   * `asset.failed`.
   */
  private recordProcessingEvents(asset: Asset, decision: MockDecision): void {
    if (decision.status === "pending") return;
    const event = { assetId: asset.id, asset: toEventAsset(asset), actor: AUTOMATED_ACTOR };
    if (decision.status === "failed") {
      this.pushEvent({
        ...event,
        type: "asset.failed",
        severity: "high",
        facts: [
          assetNameFact(asset),
          { key: "asset-type", value: asset.type },
          { key: "previous-status", value: "processing" },
          {
            key: "failure-reason",
            value: asset.classification.failureReason ?? "processing-error",
          },
        ],
      } as MockEventInput);
      return;
    }
    const flaggedCategories = decision.report()?.flaggedCategories ?? [];
    this.pushEvent({
      ...event,
      type: "asset.classified",
      severity: "low",
      facts: [
        { key: "flagged-categories", value: flaggedCategories },
        { key: "moderation-status", value: decision.status },
        { key: "asset-type", value: asset.type },
        assetNameFact(asset),
      ],
    } as MockEventInput);
    this.pushEvent({
      ...event,
      type: `asset.${decision.status}`,
      // Like the event catalog: only allowing and limiting are low severity.
      severity: decision.status === "allowed" || decision.status === "limited" ? "low" : "high",
      facts: [
        { key: "flagged-categories", value: flaggedCategories },
        { key: "asset-type", value: asset.type },
        assetNameFact(asset),
      ],
    } as MockEventInput);
  }

  /**
   * Moves an asset to `outcome` like the pipeline would: a decision finishes processing, `purged`
   * deletes the content (with `purgeReason`, `policy` for the pipeline), and finished processing
   * removes content kept only temporarily (`keepContentAfterProcessing` off). A decided asset gets
   * its rendered file and preview (with a ThumbHash for its placeholder), which go with its content.
   */
  private async applyOutcome(
    asset: Asset,
    outcome: MockAssetOutcome,
    purgeReason: "policy" | "requested" = "policy",
    report?: ReturnType<MockDecision["report"]>,
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
    // Like the API, an asset whose content is held has its rendered file and preview, completed by
    // its decision, and removing content (when processing finishes or by purging) removes them
    // with it, so no placeholder outlives the content. A safety hold withholds them.
    const rendering =
      asset.content.status !== "removed" && !purge && !asset.content.safetyHold
        ? mockRendering(asset, decided)
        : NO_RENDERING;
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
            metadata: null,
            ...NO_RENDERING,
          }
        : { ...asset.content, ...rendering },
      upload: { ...asset.upload, status: "completed", updatedAt: now },
      classification: {
        ...asset.classification,
        status: classificationStatus,
        // Like the API, a failure names its reason; the mock's failures are processing errors.
        failureReason: classificationStatus === "failed" ? "processing-error" : null,
        updatedAt: now,
        completedAt: decided ? now : null,
        moderation: {
          ...asset.classification.moderation,
          status: decided ? outcome : "pending",
          ...report,
        },
      },
    };
  }

  /** Adds an `asset.deleted`, `asset.content-removed` or `asset.retried` event, like the API. */
  private recordLifecycleEvent(
    type: "asset.deleted" | "asset.content-removed" | "asset.retried",
    asset: Asset,
    options: { batchId?: string; actor?: TypedEvent["actor"] } = {},
  ): void {
    const { batchId, actor = MOCK_API_KEY_ACTOR } = options;
    this.pushEvent({
      type,
      actor,
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
        ...(batchId ? [{ key: "batch-id", value: batchId }] : []),
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
    // Like toUploadedAsset in the API: the asset's upload and processing state, and its
    // moderation status only when the preset shows decisions.
    const toUploaded = (asset: Asset): UploadedAsset => ({
      id: asset.id,
      name: asset.name,
      uploadPresetId,
      createdAt: asset.createdAt,
      upload: { status: asset.upload.status, partsReceived: asset.upload.partsReceived },
      classification: {
        status: asset.classification.status,
        failureReason: asset.classification.failureReason,
        ...(preset.showDecisions !== false && {
          moderation: { status: asset.classification.moderation.status },
        }),
      },
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
    // Like the API, a browser upload's external ID is the one its token was signed for.
    const tokenExternalId = token
      ? decodeUploadToken(token.replace(/^Bearer /, ""))?.claims.x
      : undefined;
    if (fields.externalId && fields.externalId !== tokenExternalId) {
      throw fail(API_ERROR_CODES.UPLOAD_PRESET_FIELD_NOT_ALLOWED, {
        details: { field: "externalId" },
      });
    }
    // Like the API, a browser can't set the fields its server sets.
    for (const field of ["metadata", "tags", "authorId", "context", "processingOptions"] as const) {
      if (fields[field] !== undefined && fields[field] !== null) {
        throw fail(API_ERROR_CODES.UPLOAD_PRESET_FIELD_NOT_ALLOWED, { details: { field } });
      }
    }
    if (
      preset.allowedContentTypes &&
      !isFileAccepted(
        { name: fields.name, type: fields.contentType ?? "" },
        preset.allowedContentTypes.join(","),
      )
    ) {
      throw fail(API_ERROR_CODES.UNSUPPORTED_UPLOAD_TYPE, {
        details: {
          source: "preset",
          contentType: fields.contentType ?? "",
          allowedContentTypes: preset.allowedContentTypes,
        },
      });
    }
    const size = fields.part?.totalSizeInBytes ?? fields.bytes?.byteLength;
    if (
      preset.maxFileSizeInBytes !== undefined &&
      size !== undefined &&
      size > preset.maxFileSizeInBytes
    ) {
      throw fail(API_ERROR_CODES.UPLOAD_TOO_LARGE, {
        details: { limitBytes: preset.maxFileSizeInBytes, source: "preset" },
      });
    }
    const asset = await this.storeAsset(
      {
        ...fields,
        externalId: tokenExternalId,
        uploadPresetId,
        visibility: preset.visibility ?? "public",
        folderId: preset.folderId ?? undefined,
        processingOptions: {
          keepContentAfterProcessing: preset.keepContentAfterProcessing ?? true,
        },
      },
      request.query.get("wait") === "false",
    );
    session.uploads.add(asset.id);
    return toUploaded(asset);
  }

  // ---- Events ------------------------------------------------------------------------------

  /**
   * Reads the feed like the API: without `cursor`, no events and a `nextCursor` for "now"; with
   * `cursor`, up to `pageSize` events added since, oldest first. `nextCursor` is never null: it
   * is where to keep polling from.
   */
  private listEvents(query: URLSearchParams) {
    const pageSize = this.integer(query, "pageSize", DEFAULT_PAGE_SIZE);
    // Like the API's query schema: an integer from 1 to 100.
    if (pageSize < 1) throw invalidField("validation/too-small", "pageSize");
    if (pageSize > MAX_PAGE_SIZE) throw invalidField("validation/too-big", "pageSize");
    // `types` is a comma-separated list of event types and `assetId` an asset ID, as the API takes.
    const typesValue = query.get("types");
    const types = typesValue === null ? [] : typesValue.split(",");
    if (
      typesValue !== null &&
      (types.length === 0 || types.some((type) => !EVENT_TYPE_PATTERN.test(type)))
    )
      throw invalidField("validation/invalid-value", "types");
    const assetId = query.get("assetId");
    if (assetId !== null && !isId(assetId, "asset"))
      throw invalidField("validation/invalid-format", "assetId");
    // Like the API, a cursor belongs to the filters it was issued with.
    const filter = btoa(JSON.stringify([[...new Set(types)].sort(), assetId]));
    const matches = (event: TypedEvent) =>
      (!types.length || types.includes(event.type)) &&
      (assetId === null || event.assetId === assetId);
    const cursor = query.get("cursor");
    // The mock's key holds every permission, so no event type is excluded.
    if (!cursor)
      return {
        items: [],
        nextCursor: `mock_${this.eventFeed.length}~${filter}`,
        hasMore: false,
        excludedTypes: [],
      };
    const match = /^mock_(\d+)~(.*)$/.exec(cursor);
    const position = match && match[2] === filter ? Number(match[1]) : Number.NaN;
    if (!Number.isSafeInteger(position) || position > this.eventFeed.length) {
      throw fail(API_ERROR_CODES.INVALID_CURSOR);
    }
    const items: TypedEvent[] = [];
    let next = position;
    while (next < this.eventFeed.length && items.length < pageSize) {
      const event = this.eventFeed[next++]!;
      if (matches(event)) items.push(event);
    }
    return {
      items,
      nextCursor: `mock_${next}~${filter}`,
      hasMore: this.eventFeed.slice(next).some(matches),
      excludedTypes: [],
    };
  }

  // ---- Folders -----------------------------------------------------------------------------

  /**
   * Lists folders like the API: one keyset page of a parent's children, optionally matching
   * `search`, by name unless `ordering` says otherwise, with the folders above them.
   */
  private async listFolders(query: URLSearchParams) {
    const all = (await this.databaseStorage.listFolders?.(this.projectId)) ?? [];
    const parentId = query.get("parentId");
    const search = query.get("search")?.trim() || null;
    // The folder list sorts by one field, `name` or `createdAt`.
    const sort = this.sort(query, ["name", "createdAt"], 1);
    const matching = all.filter(
      (folder) =>
        (folder.parentId ?? null) === parentId &&
        (!search || folder.name.toLowerCase().includes(search.toLowerCase())),
    );
    const page = createPage(
      matching,
      {
        cursor: query.get("cursor") ?? undefined,
        pageSize: this.integer(query, "pageSize", DEFAULT_PAGE_SIZE),
        sort,
      },
      {
        scope: JSON.stringify([this.projectId, parentId, search]),
        fail: this.pageFailure,
        defaultSort: [{ field: "name", direction: "asc" }],
      },
    );
    const folders = page.items;
    const ids = new Set([...(parentId ? [parentId] : []), ...folders.map((folder) => folder.id)]);
    const byId = new Map(all.map((folder) => [folder.id, folder]));
    for (const id of ids) {
      const parent = byId.get(id)?.parentId;
      if (parent) ids.add(parent);
    }
    return {
      items: folders,
      ancestors: all.filter(
        (folder) => ids.has(folder.id) && !folders.some((item) => item.id === folder.id),
      ),
      nextCursor: page.nextCursor,
      hasMore: page.hasMore,
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

  // ---- Configuration: upload presets, project settings, metadata fields ----------------------

  private readonly configuredPresets = new Map<string, UploadPreset>();
  private settingsRevision = 1;
  private projectSettingsValues: Record<string, unknown> = {};
  private metadataFieldList: Record<string, unknown>[] = [];

  /** A page of the project's upload presets, oldest first unless `sort` says otherwise. */
  private listUploadPresets(query: URLSearchParams): UploadPresetPage {
    return createPage([...this.configuredPresets.values()], this.pageQuery(query), {
      scope: `upload-presets:${this.projectId}`,
      fail: this.pageFailure,
      defaultSort: [{ field: "createdAt", direction: "asc" }],
    });
  }

  /** Like the API: every preset's revision and settings are checked before any is saved. */
  private ensureUploadPresets(body: Record<string, unknown>) {
    const definitions = Array.isArray(body.uploadPresets)
      ? (body.uploadPresets as Record<string, any>[])
      : [];
    if (definitions.length === 0) throw invalidField("validation/too-small", "uploadPresets");
    const plans = definitions.map((definition, index) => {
      if (typeof definition.key !== "string" || !definition.key)
        throw invalidField("validation/invalid-type", `uploadPresets.${index}.key`);
      if (typeof definition.name !== "string" || !definition.name)
        throw invalidField("validation/invalid-type", `uploadPresets.${index}.name`);
      const existing = this.configuredPresets.get(definition.key);
      if (definition.revision !== undefined && definition.revision !== (existing?.revision ?? 0))
        throw fail(API_ERROR_CODES.UPLOAD_PRESET_REVISION_CONFLICT, {
          details: { key: definition.key, revision: existing?.revision ?? 0 },
        });
      const list = (value: unknown) =>
        Array.isArray(value) && value.length ? [...new Set(value as string[])] : null;
      const values = {
        key: definition.key,
        name: definition.name,
        access: definition.access ?? "token",
        enabled: definition.enabled ?? true,
        allowedContentTypes: list(definition.allowedContentTypes),
        maxSizeInBytes: definition.maxSizeInBytes ?? null,
        folderId: definition.folderId ?? null,
        policyId: definition.policyId ?? null,
        visibility: definition.visibility ?? "private",
        processingOptions: definition.processingOptions ?? null,
        revealDecision: definition.revealDecision ?? false,
        dailyUploadLimit: definition.dailyUploadLimit ?? null,
        allowedOrigins: list(definition.allowedOrigins),
      } as const;
      if (values.access === "anyone" && !values.dailyUploadLimit)
        throw fail(API_ERROR_CODES.UPLOAD_PRESET_DAILY_LIMIT_REQUIRED);
      return { existing, values };
    });
    return {
      uploadPresets: plans.map(({ existing, values }) => {
        if (existing) {
          const unchanged = Object.entries(values).every(
            ([key, value]) =>
              stringifyJsonCanonical(value) ===
              stringifyJsonCanonical(existing[key as keyof UploadPreset] ?? null),
          );
          if (unchanged) return existing;
        }
        const now = this.now();
        const preset = {
          id: existing?.id ?? this.createId("preset"),
          projectId: this.projectId,
          createdByUserId: null,
          ...values,
          revision: (existing?.revision ?? 0) + 1,
          createdAt: existing?.createdAt ?? now,
          updatedAt: now,
        } as UploadPreset;
        this.configuredPresets.set(preset.key, preset);
        return preset;
      }),
    };
  }

  private deleteUploadPreset(uploadPresetId: string) {
    const preset = [...this.configuredPresets.values()].find(({ id }) => id === uploadPresetId);
    if (!preset) throw fail(API_ERROR_CODES.UPLOAD_PRESET_NOT_FOUND);
    this.configuredPresets.delete(preset.key);
    return {};
  }

  private toProjectSettings(): ProjectSettingsResource {
    return {
      projectId: this.projectId,
      revision: this.settingsRevision,
      settings: {
        optOutJurisdictions: [],
        blockUnmoderatedAssets: true,
        storeSensitiveMetadata: false,
        streamingEnabled: false,
        aiMediaSearchEnabled: false,
        remoteUrlRule: null,
        websiteSubmissionsPerMinute: null,
        ...this.projectSettingsValues,
        humanReview: {
          allowedSamplePercent: 0,
          restrictedSamplePercent: 0,
          uncertaintyMarginPercent: 0,
          reviewMissingEvidence: false,
          ...(this.projectSettingsValues.humanReview as object | undefined),
        },
      } as ProjectSettingsResource["settings"],
    };
  }

  private checkSettingsRevision(revision: unknown) {
    if (revision !== undefined && revision !== null && Number(revision) !== this.settingsRevision)
      throw fail(API_ERROR_CODES.PROJECT_SETTINGS_REVISION_CONFLICT);
  }

  /** Replaces the settings: those left out return to their defaults. */
  private updateProjectSettings(body: Record<string, unknown>): ProjectSettingsResource {
    this.checkSettingsRevision(body.revision);
    const settings = body.settings;
    if (!settings || typeof settings !== "object" || Array.isArray(settings))
      throw invalidField("validation/invalid-type", "settings");
    const before = stringifyJsonCanonical(this.toProjectSettings().settings);
    const previous = this.projectSettingsValues;
    this.projectSettingsValues = { ...(settings as Record<string, unknown>) };
    if (stringifyJsonCanonical(this.toProjectSettings().settings) === before)
      this.projectSettingsValues = previous;
    else this.settingsRevision += 1;
    return this.toProjectSettings();
  }

  private toMetadataFields(): MetadataFieldsResource {
    return {
      projectId: this.projectId,
      revision: this.settingsRevision,
      fields: this.metadataFieldList as MetadataFieldsResource["fields"],
    };
  }

  /** Creates or replaces fields by ID, keeping the others in order. */
  private ensureMetadataFields(body: Record<string, unknown>): MetadataFieldsResource {
    this.checkSettingsRevision(body.revision);
    const fields = Array.isArray(body.fields) ? (body.fields as Record<string, unknown>[]) : [];
    if (fields.length === 0) throw invalidField("validation/too-small", "fields");
    const byId = new Map(fields.map((field) => [field.id, field]));
    const merged = [
      ...this.metadataFieldList.map((field) => byId.get(field.id) ?? field),
      ...fields.filter((field) => !this.metadataFieldList.some(({ id }) => id === field.id)),
    ];
    if (stringifyJsonCanonical(merged) !== stringifyJsonCanonical(this.metadataFieldList)) {
      this.metadataFieldList = merged;
      this.settingsRevision += 1;
    }
    return this.toMetadataFields();
  }

  private deleteMetadataField(fieldId: string, query: URLSearchParams): MetadataFieldsResource {
    if (!this.metadataFieldList.some(({ id }) => id === fieldId))
      throw fail(API_ERROR_CODES.METADATA_FIELD_NOT_FOUND, { details: { fieldId } });
    this.checkSettingsRevision(query.get("revision") ?? undefined);
    this.metadataFieldList = this.metadataFieldList.filter(({ id }) => id !== fieldId);
    this.settingsRevision += 1;
    return this.toMetadataFields();
  }

  // ---- Lenses ------------------------------------------------------------------------------

  /** Saves each lens in order, like the API: new ones, or a changed definition. */
  private ensureLenses(body: Record<string, unknown>) {
    const lenses = Array.isArray(body.lenses) ? (body.lenses as LensDefinition[]) : [];
    if (lenses.length === 0) throw invalidField("validation/too-small", "lenses");
    return { lenses: lenses.map((lens) => this.ensureLens(lens)) };
  }

  private ensureLens(options: LensDefinition): Lens {
    const existing = this.lenses.get(options.identifier);
    if (!existing) return this.saveNewLens(options);
    const hasMatchingDefinition =
      existing.name === options.name &&
      (existing.description ?? null) === (options.description ?? null) &&
      existing.type === options.type &&
      existing.active === (options.active ?? true) &&
      stringifyJsonCanonical(existing.transform ?? null) ===
        stringifyJsonCanonical(options.transform ?? null);
    if (hasMatchingDefinition) return existing;
    const lens = { ...existing, ...options, active: options.active ?? true, updatedAt: this.now() };
    this.lenses.set(lens.identifier, lens);
    return lens;
  }

  private saveNewLens(options: LensDefinition): Lens {
    const now = this.now();
    const lens: Lens = {
      id: this.createId("lens"),
      projectId: this.projectId,
      ...options,
      active: options.active ?? true,
      createdAt: now,
      updatedAt: now,
    };
    this.lenses.set(lens.identifier, lens);
    return lens;
  }

  /** A page of the project's lenses, newest first unless `sort` says otherwise. */
  private listLenses(query: URLSearchParams): LensPage {
    return createPage([...this.lenses.values()], this.pageQuery(query), {
      scope: `lenses:${this.projectId}`,
      fail: this.pageFailure,
    });
  }

  private createLens(body: Record<string, unknown>): Lens {
    const definition = body as LensDefinition;
    if (typeof definition.identifier !== "string" || !definition.identifier)
      throw invalidField("validation/invalid-type", "identifier");
    if (this.lenses.has(definition.identifier))
      throw fail(API_ERROR_CODES.LENS_IDENTIFIER_TAKEN, {
        details: { identifier: definition.identifier },
      });
    return this.saveNewLens(definition);
  }

  private findLens(lensId: string): Lens {
    const lens = [...this.lenses.values()].find((candidate) => candidate.id === lensId);
    if (!lens) throw fail(API_ERROR_CODES.LENS_NOT_FOUND);
    return lens;
  }

  private updateLens(lensId: string, body: Record<string, unknown>): Lens {
    const lens = this.findLens(lensId);
    const { identifier: _identifier, ...changes } = body as Partial<LensDefinition>;
    return this.ensureLens({ ...lens, ...changes });
  }

  private deleteLens(lensId: string): Record<string, never> {
    this.lenses.delete(this.findLens(lensId).identifier);
    return {};
  }

  // ---- CDN ---------------------------------------------------------------------------------

  /**
   * Serves an asset's resources like the CDN (`/assets/:projectId/:asset/:resource`): `200` with
   * `Content-Type`, `Content-Length`, `Cache-Control`, `Cache-Tag`, the CDN's protection headers
   * and, for still images, `ETag` and `Expires`; or a JSON error body with `400`, `403` or `404`.
   * `original` is the upload; `rendered` the image, PDF, video or audio file `content.rendered`
   * describes; `preview` the still `content.preview` describes; and `placeholder` its ThumbHash as a
   * PNG. The mock converts nothing: an upload stands in for its rendered file, an image for its own
   * preview, and the placeholder PNG for a screenshot, page, poster or waveform.
   */
  private async serveCdn(request: MockRequest): Promise<Response> {
    const { url, segments, query } = request;
    const [root, projectId, , resource] = segments;
    const assetSegment = request.rawSegments[2] ?? "";
    const selectorPath = request.rawSegments.slice(4);
    const notFound = () =>
      this.jsonResponse(404, { code: "asset/not-found", message: "Asset not found" }, url);
    const noRenderedVersion = () =>
      this.jsonResponse(
        404,
        { code: "asset/no-rendered-version", message: "This asset has no such resource" },
        url,
      );
    const invalidTransform = () =>
      this.jsonResponse(
        400,
        { code: "transform/invalid", message: "Invalid transform selector" },
        url,
      );
    // Like the CDN (serveAssetResource.ts), everything beneath `/hls/` is the HLS stream's
    // playlists and segments, which take no lens or transform; otherwise the selector after the
    // resource is read (AssetTransformParser.ts), and the original and the embed page take none.
    const isHls = resource === "hls";
    let selector: ReturnType<typeof parseTransformSelector>;
    try {
      selector = parseTransformSelector(isHls ? "" : selectorPath.join("/"));
    } catch {
      return invalidTransform();
    }
    const hasSelector = Boolean(selector.lens || selector.options);
    if ((resource === "original" || resource === "embed" || resource === "info") && hasSelector) {
      return invalidTransform();
    }
    if (root !== "assets" || projectId !== this.projectId || !assetSegment) return notFound();
    const assets = await this.databaseStorage.listAssets(this.projectId);
    // Like the CDN (CdnUtils.ts), the asset is `ext:` and its URL-encoded external ID, a grant
    // (`sig_…`) or its ID.
    let grant: ReturnType<typeof decodeMockGrant>;
    let asset: Asset | undefined;
    if (assetSegment.startsWith("sig_")) {
      grant = decodeMockGrant(assetSegment);
      if (!grant) {
        return this.jsonResponse(
          403,
          { code: "signed-url/invalid", message: "The signed asset URL's grant is invalid" },
          url,
        );
      }
      if (grant.expiresAt <= this.now()) {
        return this.jsonResponse(
          403,
          { code: "signed-url/expired", message: "The signed URL has expired" },
          url,
        );
      }
      const grantedId = grant.assetId;
      asset = assets.find((candidate) => candidate.id === grantedId);
    } else if (assetSegment.startsWith("ext:")) {
      let externalId: string | undefined;
      try {
        externalId = decodeURIComponent(assetSegment.slice("ext:".length));
      } catch {}
      asset = externalId
        ? assets.find((candidate) => candidate.externalId === externalId)
        : undefined;
    } else {
      const assetId = decodeSegment(assetSegment);
      asset = assets.find((candidate) => candidate.id === assetId);
    }
    if (!asset) return notFound();
    if (resource === "original" && grant && !grant.original) {
      return this.jsonResponse(
        403,
        {
          code: "signed-url/original-not-granted",
          message: "This signed asset URL doesn't grant the original file",
        },
        url,
      );
    }
    const notAvailable = () =>
      this.jsonResponse(
        403,
        { code: "asset/not-available", message: "Asset is not available" },
        url,
      );
    const hasApiKey = request.headers.get("x-api-key") === this.apiKey;
    const grants = hasApiKey ? this.grants : [];
    const folders = (await this.databaseStorage.listFolders?.(this.projectId)) ?? [];
    const canDownload = () => permits(grants, "assets:download", asset.folderId ?? null, folders);
    const status = asset.classification.moderation.status;
    const isHead = request.method === "HEAD";
    const { rendered, preview } = asset.content;
    // Like the CDN, a private asset answers anyone without a grant or the project's API key as an
    // unknown asset does, whatever its state. Its placeholder is public.
    if (
      asset.visibility !== "public" &&
      !grant &&
      !hasApiKey &&
      resource !== "placeholder" &&
      resource !== "info"
    ) {
      return notFound();
    }
    if (resource === "info") return this.serveInfo(request, asset, Boolean(grant) || canDownload());
    // Like the CDN, a safety hold refuses every resource.
    if (asset.content.safetyHold) return notAvailable();

    if (resource === "placeholder") {
      // Like the CDN's placeholder handler: the preview's ThumbHash, public whatever the asset's
      // visibility or moderation status; refused for purged assets and assets without one (not
      // yet processed, without a preview, or content removed).
      const thumbhash = preview?.thumbhash;
      if (!thumbhash || status === "purged") return notAvailable();
      return this.cdnResponse(isHead, mockPlaceholderPng(thumbhash), url, {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=3600",
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
      (resource === "original" && !storedContent)
    ) {
      return notAvailable();
    }
    // Then access: age-restricted assets need `viewerClaims.ageConfirmed` whatever the key, and
    // private assets need an API key with `assets:download` for the asset's folder.
    let claims: { ageConfirmed?: boolean } = {};
    try {
      claims = JSON.parse(
        query.get("viewerClaims") ?? request.headers.get("X-CalmLens-Viewer-Claims") ?? "{}",
      );
    } catch {
      return this.jsonResponse(400, { code: "viewer-claims/invalid" }, url);
    }
    if (status === "age-restricted" && claims.ageConfirmed !== true)
      return this.jsonResponse(403, { code: "viewer/age-confirmation-required" }, url);
    const isPrivate = asset.visibility !== "public";
    if (isPrivate && !grant && !canDownload()) {
      return this.jsonResponse(
        403,
        {
          code: "auth/permission-denied",
          message: "This API key needs assets:download permission for this asset’s folder.",
        },
        url,
      );
    }

    // The embed page shows any asset that may be delivered, as its viewer for the asset's type or a
    // notice that the type has none.
    if (resource === "embed") {
      return this.cdnResponse(isHead, new TextEncoder().encode(MOCK_EMBED_HTML), url, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": Object.keys(claims).length
          ? "private, no-store"
          : `${isPrivate ? "private" : "public"}, max-age=3600`,
        "Cache-Tag": `asset-${asset.id}`,
        "X-Content-Type-Options": "nosniff",
      });
    }

    // Then whether the asset has the resource, and whether it is a still image that takes a lens
    // or transform: the preview always is, the rendered file only when it is an image.
    if ((resource === "rendered" && !rendered) || (resource === "preview" && !preview)) {
      return noRenderedVersion();
    }
    // The mock never prepares a stream, so it has no playlists or segments to serve.
    if (isHls && !asset.content.hls) return noRenderedVersion();
    const stillImage =
      resource === "preview" || (resource === "rendered" && rendered?.kind === "image");
    if (!stillImage && hasSelector) return invalidTransform();

    // Then the options, checked against the transform schema once the asset may be served.
    if (selector.options) {
      const { unknownKeys, invalidKeys } = checkTransformOptions(selector.options);
      if (unknownKeys.length || invalidKeys.length) {
        return this.jsonResponse(
          400,
          {
            code: "transform-options/invalid",
            message: `Invalid transform options: ${[...unknownKeys, ...invalidKeys].join(", ")}`,
          },
          url,
        );
      }
    }

    // The bytes: the upload, which stands in for its own rendered file and an image's preview,
    // or the placeholder PNG for a still the mock doesn't make.
    const servesUpload =
      resource === "original" ||
      (resource === "rendered" && rendered?.kind !== "image") ||
      asset.type === "image";
    let bytes: Uint8Array<ArrayBuffer>;
    let contentType: string;
    if (servesUpload) {
      if (!storedContent) return notAvailable();
      const parts = [...storedContent.parts.entries()]
        .sort(([left], [right]) => left - right)
        .map(([, value]) => value);
      bytes = new Uint8Array(parts.reduce((sum, value) => sum + value.byteLength, 0));
      let offset = 0;
      for (const part of parts) {
        bytes.set(part, offset);
        offset += part.byteLength;
      }
      contentType =
        resource === "rendered" && rendered
          ? rendered.format
          : (storedContent.type ?? "application/octet-stream");
    } else {
      bytes = mockPlaceholderPng(preview?.thumbhash ?? MOCK_THUMBHASH);
      contentType = "image/png";
    }
    const immutable = stillImage || (resource === "original" && asset.type === "image");
    return this.cdnResponse(isHead, bytes, url, {
      "Content-Type": contentType,
      // Like the CDN: a still image's bytes are immutable for a year, other content is kept for
      // an hour, publicly only when delivery is public.
      "Cache-Control": Object.keys(claims).length
        ? "private, no-store"
        : `${isPrivate ? "private" : "public"}, ${
            immutable ? "max-age=31536000, immutable" : "max-age=3600"
          }`,
      "Cache-Tag": `asset-${asset.id}`,
      ...(immutable
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

  /**
   * The display info at `/info`, like the CDN's (AssetInfo.ts): the allowlisted fields and whether
   * the viewer the claims describe can see the content, decided as the other resources decide it.
   * A private asset's needs a grant or an API key with `assets:download`.
   */
  private serveInfo(request: MockRequest, asset: Asset, authorised: boolean): Response {
    const { url, query } = request;
    const isPrivate = asset.visibility !== "public";
    if (isPrivate && !authorised) {
      return this.jsonResponse(404, { code: "asset/not-found", message: "Asset not found" }, url);
    }
    let claims: { ageConfirmed?: boolean } = {};
    try {
      claims = JSON.parse(
        query.get("viewerClaims") ?? request.headers.get("X-CalmLens-Viewer-Claims") ?? "{}",
      );
    } catch {
      return this.jsonResponse(400, { code: "viewer-claims/invalid" }, url);
    }
    const status = asset.classification.moderation.status;
    const availability =
      asset.content.safetyHold ||
      asset.upload.status === "uploading" ||
      status === "blocked" ||
      status === "purged" ||
      asset.classification.status === "failed" ||
      asset.content.status === "removed"
        ? "unavailable"
        : status === "age-restricted" && claims.ageConfirmed !== true
          ? "age-restricted"
          : "available";
    const { content } = asset;
    const info = {
      id: asset.id,
      projectId: asset.projectId,
      type: asset.type,
      externalUrl: asset.externalUrl ?? null,
      content: {
        format: content.format,
        width: content.width,
        height: content.height,
        durationSeconds: content.durationSeconds,
        pageCount: content.pageCount,
        rendered: content.rendered,
        preview: content.preview,
        hls: content.hls,
      },
      availability,
    };
    const bytes = new TextEncoder().encode(JSON.stringify(info));
    return this.cdnResponse(request.method === "HEAD", bytes, url, {
      "Content-Type": "application/json",
      "Cache-Control": `${isPrivate ? "private" : "public"}, max-age=60`,
      "Cache-Tag": `asset-${asset.id}`,
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
