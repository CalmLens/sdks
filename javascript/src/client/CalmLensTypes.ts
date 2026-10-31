import type * as zod from "zod";
import type {
  AssetClassificationStatus as KnownAssetClassificationStatus,
  AssetContentRemovalReason as KnownAssetContentRemovalReason,
  AssetContentStatus as KnownAssetContentStatus,
  AssetModerationDecision as KnownAssetModerationDecision,
  AssetModerationStatus as KnownAssetModerationStatus,
  AssetType as KnownAssetType,
  AssetVisibility as KnownAssetVisibility,
  Asset as SharedAsset,
  AssetClassification as SharedAssetClassification,
  AssetContent as SharedAssetContent,
  AssetModeration as SharedAssetModeration,
  AssetUpload as SharedAssetUpload,
} from "../contract/Asset.js";
import type { AssetBinaryPayloadInput } from "../contract/AssetPayload.js";
import type {
  AssetSearchQuery,
  AssetSearchResult as SharedAssetSearchResult,
} from "../contract/AssetSearch.js";
import type { HashList, HashListEntry } from "../contract/HashList.js";
import type { PUBLIC_LENS_SCHEMA } from "../contract/Lens.js";
import type { ModerationContext } from "../contract/ModerationContext.js";
import type { CursorPage } from "../contract/Page.js";
import type {
  AssetBatchOperation,
  GetAssetChildrenQuery,
  GetAssetsPageQuery,
  GetEventsQuery,
  GetFoldersQuery,
  GetFoldersResponse,
  GetHashListEntriesResponse,
  GetHashListsResponse,
  PatchAssetBody,
  PatchFolderBody,
  PatchHashListBody,
  PostAssetBatchOperationResponse,
  PostAssetDecisionBody,
  PostAssetSignedUrlResponse,
  PostFolderBody,
  PostHashListBody,
  PostHashListEntryBody,
} from "../contract/PublicApiSchemas.js";

// ---- Models -------------------------------------------------------------------------------

// The enum values listed are the ones this SDK version knows; newer API versions may return
// others, so handle unknown values (for example as "not ready").

/** Where the asset is in the pipeline: `uploading`, `processing`, then `done` or `failed`. */
export type AssetClassificationStatus = KnownAssetClassificationStatus | (string & {});
/**
 * The moderation decision in force, which also decides delivery: `pending`, then `allowed`,
 * `limited` (delivered like `allowed`, but marked so your app can reduce its reach, such as
 * keeping it out of recommendations, trending and notifications, ranking it lower or collapsing
 * it), `age-restricted` (delivered only with viewerClaims.ageConfirmed=true), `blocked` or `purged`.
 */
export type AssetModerationStatus = KnownAssetModerationStatus | (string & {});
/** A reviewer's decision: `allowed`, `limited`, `age-restricted`, `blocked` or `purged`. */
export type AssetModerationDecision = KnownAssetModerationDecision | (string & {});
/** Whether CalmLens holds the content: `temporary`, `stored` or `removed`. */
export type AssetContentStatus = KnownAssetContentStatus | (string & {});
/** Why the content was removed. */
export type AssetContentRemovalReason = KnownAssetContentRemovalReason | (string & {});
/** The detected kind of content. Newer API versions may add values. */
export type AssetType = KnownAssetType | (string & {});
/** Who can read retained content from the CDN. Newer API versions may add values. */
export type AssetVisibility = KnownAssetVisibility | (string & {});

/** An asset's processing state. */
export type AssetClassification = Omit<SharedAssetClassification, "status" | "moderation"> & {
  status: AssetClassificationStatus;
  moderation: AssetModeration;
};
/** An asset's moderation state. */
export type AssetModeration = Omit<SharedAssetModeration, "status" | "manualReviews"> & {
  status: AssetModerationStatus;
  manualReviews: Array<
    Omit<SharedAssetModeration["manualReviews"][number], "decision"> & {
      decision: AssetModerationDecision;
    }
  >;
};
/** Whether CalmLens holds an asset's content, and what is known about it. */
export type AssetContent = Omit<SharedAssetContent, "status" | "removalReason"> & {
  status: AssetContentStatus;
  removalReason: AssetContentRemovalReason | null;
};

export type AssetUpload = SharedAssetUpload;
export type AssetUploadStatus = SharedAssetUpload["status"];

/** An asset as the API returns it. Fields the API adds later are present at runtime too. */
export type Asset = Omit<
  SharedAsset,
  "type" | "visibility" | "upload" | "classification" | "content"
> & {
  type: AssetType;
  visibility?: AssetVisibility | null;
  upload: AssetUpload;
  classification: AssetClassification;
  content: AssetContent;
};

/** Digests of an asset's uploaded content. */
export type AssetChecksums = NonNullable<SharedAssetContent["checksums"]>;

/** A signed CDN URL from `assets.createSignedUrl`, and when it expires. */
export type SignedUrl = PostAssetSignedUrlResponse;

/** One page of assets. */
export type AssetPage = CursorPage<Asset>;
/** One page of an asset's extracted children. */
export type AssetChildrenPage = CursorPage<Asset>;

export type AssetSearchResult = Omit<SharedAssetSearchResult, "asset"> & { asset: Asset };
export interface AssetSearchResponse {
  query: string;
  items: AssetSearchResult[];
  semanticStatus: "disabled" | "ready" | "indexing" | "unavailable" | (string & {});
}
export type { AssetSearchQuery };
/** `assets.search` options: `query` is required; `limit` defaults to 10 and `mode` to `hybrid`. */
export type SearchAssetsOptions = Partial<AssetSearchQuery> & { query: string };

// <generated: image-transform-options>
// Generated by packages/sdk-contract/generate.ts from IMAGE_TRANSFORM_OPTIONS_SCHEMA; do not edit.
/** Options for the built-in `imageTransform` lens transform. */
export interface ImageTransformOptions {
  /** The output format. Leave it out to serve the best format the browser accepts. */
  format?: "jpg" | "png" | "webp" | "avif" | "gif";
  /** The width in pixels, 1 to 10,000 after `dpr`. With a size and no `fit`, the image scales down. */
  width?: number;
  /** The height in pixels, 1 to 10,000 after `dpr`. */
  height?: number;
  /** The pixel density, 1 to 3: multiplies the width, height and border width. */
  dpr?: number;
  /** `false` serves the first frame of an animated GIF or WebP. */
  anim?: boolean;
  /** The background colour, such as `#ffffff`, for padding and transparency. */
  background?: string;
  /** The blur radius. */
  blur?: number;
  /** Blurs regions found when the image was processed, before any other option applies. Text regions need OCR on the upload. An image without such regions is served unchanged. */
  redact?: {
    /** Blurs every paragraph of text OCR found. */
    text?: boolean;
    /** Blurs the email addresses, phone numbers, card numbers, IBANs and social security numbers OCR found. */
    personalInformation?: boolean;
  };
  /** A border drawn around the image. */
  border?: {
    /** The border colour. */
    color?: string;
    /** The border width in pixels. */
    width?: number;
  };
  /** The brightness factor. */
  brightness?: number;
  /** The contrast factor. */
  contrast?: number;
  /** The quality: 1 to 100, or a level. Lossy output defaults to `high`. */
  quality?: number | "low" | "medium" | "high";
  /** How the image fits the `width` and `height`. */
  fit?: "scale-down" | "contain" | "pad" | "squeeze" | "cover" | "crop";
  /** Flips the image horizontally (`h`), vertically (`v`) or both (`hv`). */
  flip?: "h" | "v" | "hv";
  /** The gamma. */
  gamma?: number;
  /** `foreground` removes the background. */
  segment?: "foreground";
  /** Where to keep when cropping: a side, `face`, `auto`, or a point. */
  gravity?:
    | "face"
    | "left"
    | "right"
    | "top"
    | "bottom"
    | "center"
    | "auto"
    | "entropy"
    | {
        /** How `x` and `y` place the point. */
        mode: "remainder" | "box-center";
        /** The horizontal position, 0 to 1. */
        x?: number;
        /** The vertical position, 0 to 1. */
        y?: number;
      };
  /** The clockwise rotation in degrees. */
  rotate?: 0 | 90 | 180 | 270;
  /** The saturation factor. */
  saturation?: number;
  /** The sharpen amount. */
  sharpen?: number;
  /** Trims the edges: `border` trims a detected border, or give edges and sizes. */
  trim?:
    | "border"
    | {
        /** Pixels to trim from the top. */
        top?: number;
        /** Pixels to trim from the bottom. */
        bottom?: number;
        /** Pixels to trim from the left. */
        left?: number;
        /** Pixels to trim from the right. */
        right?: number;
        /** The width to keep. */
        width?: number;
        /** The height to keep. */
        height?: number;
        /** Trims a uniform border: `true`, or how to detect it. */
        border?:
          | boolean
          | {
              /** The border colour to trim. */
              color?: string;
              /** How far colours may differ. */
              tolerance?: number;
              /** Pixels of border to keep. */
              keep?: number;
            };
      };
}
// </generated: image-transform-options>

/** An `imageTransform` step. */
export interface ImageTransform {
  type: "imageTransform";
  options: ImageTransformOptions;
}

/** One step of a lens. `imageTransform` is the only transform type the API accepts. */
export type LensTransform = ImageTransform;

/**
 * A CDN transform: a selector string with one step per path segment, such as
 * `width=1024,fit=cover/blur=12`, or one or more structured steps such as
 * `{ type: "imageTransform", options: { width: 1024 } }`.
 */
export type CdnTransform = string | LensTransform | LensTransform[];

/** A named, versioned CDN transformation. */
export type Lens = Omit<zod.infer<typeof PUBLIC_LENS_SCHEMA>, "transforms"> & {
  transforms?: LensTransform[] | null;
};

// ---- Client options -----------------------------------------------------------------------

export interface RequestOptions {
  /** Cancels every request made with these options. */
  signal?: AbortSignal;
  /**
   * Deadline in milliseconds for each API request attempt, including reading the response
   * body. For `cdn.serve` it ends when response headers arrive, so long downloads are not cut
   * off. Defaults to 120000.
   */
  timeoutMs?: number;
  /**
   * Deadline in milliseconds for each binary upload attempt (file content and multipart
   * parts). Defaults to none, so large files are never cut off; text content uses `timeoutMs`.
   */
  uploadTimeoutMs?: number;
  /**
   * How many times to retry a request that failed before a response arrived or returned 429,
   * 502, 503, 504 or `idempotency/request-in-progress`. Only reads and requests carrying an
   * `Idempotency-Key` (creates and uploads) are retried, with jittered backoff that honours
   * `Retry-After`. Streamed bodies are never retried. Defaults to 2; 0 disables retries.
   */
  maxRetries?: number;
}

/** Where a client sends requests and how. */
export interface ConnectionOptions extends RequestOptions {
  /** Defaults to `https://api.calmlens.com/v1`. */
  baseUrl?: string;
  /** The `fetch` used for every request. Defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /** Overrides `fetch` for content uploads and multipart parts. */
  uploadFetch?: typeof fetch;
  /** Largest JSON response body the client reads, in bytes. Defaults to 32 MiB. */
  maxResponseBytes?: number;
}

/** Options for `CalmLensServerClient`, which runs on your server with a project API key. */
export interface CalmLensServerClientOptions extends ConnectionOptions {
  /** A project API key. Keep it on your server. */
  apiKey: string;
  projectId: string;
  /** Defaults to `https://cdn.calmlens.com/v1`. */
  cdnBaseUrl?: string;
  /** Overrides `fetch` for `cdn.serve`. */
  cdnFetch?: typeof fetch;
  /**
   * The client refuses to run in a web page or app, where anyone could read the API key. Set
   * this only for trusted environments such as an internal tool behind authentication.
   */
  dangerouslyAllowBrowser?: boolean;
}

/**
 * Options for `CalmLensAppClient`, which runs in browsers and apps and uploads through an upload
 * preset, without an API key.
 */
export interface CalmLensAppClientOptions extends ConnectionOptions {
  /** The upload preset to upload through, from the portal. */
  uploadPresetId: string;
  /**
   * An upload token from your server (`uploadTokens.sign`), required when the preset only
   * accepts uploads with one. Pass a function to fetch a new token for each upload.
   */
  token?: string | (() => string | Promise<string>);
  /** API keys belong on your server, in `CalmLensServerClient`. */
  apiKey?: never;
}

export interface SignUploadTokenOptions {
  /** The upload preset the token uploads through. */
  uploadPresetId: string;
  /** Your ID for the upload, such as the draft post it belongs to. The asset gets it. */
  externalId?: string;
  /** How long the token can start an upload, from 1 second to 1 hour. Defaults to 10 minutes. */
  expiresInSeconds?: number;
}

export interface SignedUploadToken {
  /** Pass this to the browser or app, which gives it to `CalmLensAppClient` as `token`. */
  token: string;
  /** When the token stops starting uploads, in milliseconds since the Unix epoch. */
  expiresAt: number;
}

/** What an upload through a preset can set: everything else comes from the preset or token. */
export type UploadPresetSubmitAssetOptions = IdempotencyOptions & {
  name: string;
  description?: string;
} & (
    | { content: AssetContentOptions }
    | {
        part: CreateMultipartUploadPartOptions;
        /** The size of the whole file, when known. */
        totalSizeInBytes?: number;
      }
  );

/** An upload made through an upload preset, as the uploader sees it. */
export interface UploadedAsset {
  id: string;
  name: string;
  uploadPresetId?: string | null;
  createdAt: number;
  /** The moderation status, present only when the preset shows decisions to uploaders. */
  status?: AssetModerationStatus;
}

// ---- Operation options --------------------------------------------------------------------

export interface IdempotencyOptions {
  /**
   * Sent as the `Idempotency-Key` header, so a retried request returns the original response
   * instead of creating a second asset. The SDK generates one per call when omitted and reuses
   * it for its own retries; pass your own to retry safely across processes.
   */
  idempotencyKey?: string;
}

/**
 * What a CDN URL serves: the asset's `original` file, exactly as uploaded; its `rendered` form for
 * display, in the best format the client accepts, which takes lenses and transforms; or its
 * `placeholder`, a small blurred PNG that is public for every asset whatever its visibility or
 * moderation status. Defaults to `rendered`; ask for `original` to download the exact file. A
 * placeholder takes no lens or transform.
 */
export type CdnResource = "original" | "rendered" | "placeholder";

export interface ViewerClaims {
  /** Defaults to the country of the connection reaching CalmLens. Forward the viewer country through proxies. */
  region?: string;
  /** Customer assertion, not verified by CalmLens. Defaults to false, including authenticated requests. */
  ageConfirmed?: boolean;
}

export interface CdnAssetUrlOptions {
  /** Viewer country supplied by your integration, including when requests go through a proxy. */
  viewerClaims?: ViewerClaims;
  assetIdentifier: string;
  resource?: CdnResource;
  lens?: string;
  transform?: CdnTransform;
}

/**
 * Options for the standalone `getAssetUrl`: a CDN URL from the project ID alone, with no API key
 * and no request, so it works in browsers.
 */
export interface GetAssetUrlOptions extends CdnAssetUrlOptions {
  projectId: string;
  /** Defaults to `https://cdn.calmlens.com/v1`. */
  cdnBaseUrl?: string;
}

export interface CdnServeOptions extends CdnAssetUrlOptions {
  init?: RequestInit;
}

export interface CreateAssetSignedUrlOptions {
  viewerClaims?: ViewerClaims;
  assetId: string;
  resource?: "original" | "rendered";
  lens?: string;
  transform?: CdnTransform;
  expiresInSeconds?: number;
}

export type EnsureLensOptions = Pick<
  Lens,
  "identifier" | "name" | "description" | "type" | "active" | "transforms" | "version"
>;

export interface EnsureLensesOptions {
  lenses: EnsureLensOptions[];
}

export type ListAssetsOptions = Partial<GetAssetsPageQuery>;
/** `assets.iterate` options: list filters and page size; pages are fetched as needed. */
export type IterateAssetsOptions = Omit<ListAssetsOptions, "cursor">;

export type ListEventsOptions = GetEventsQuery;

export interface RetrieveAssetOptions {
  assetId: string;
}

export interface RetryAssetOptions {
  assetId: string;
}

/** A reviewer's decision for `assets.decide`; purging must be confirmed. */
export type DecideAssetOptions = { assetId: string } & PostAssetDecisionBody;

export interface ExplainAssetOptions {
  assetId: string;
  /**
   * Moderates the asset again with the project's current policy, answering every question,
   * instead of explaining the decision as made. The asset returns to `processing` and gets a new
   * decision, which can differ from the old one.
   */
  rerun?: boolean;
}

export interface WaitForAssetDecisionOptions {
  assetId: string;
  /** How long to wait for a decision, in milliseconds. Defaults to 60000. */
  timeoutMs?: number;
  /** Stops waiting; the call rejects with `sdk/cancelled`. */
  signal?: AbortSignal;
}

export interface DeleteAssetOptions {
  assetId: string;
}

export interface DeleteAssetContentOptions {
  assetId: string;
}

/**
 * What `assets.batch` does to every asset: `delete` deletes it with its child assets and stored
 * content; `remove-content` removes its stored content and keeps the record.
 */
export type { AssetBatchOperation };

export interface BatchAssetsOptions {
  /** IDs of 1 to 500 assets in the project. */
  assetIds: string[];
  operation: AssetBatchOperation;
}

/** `assets.batch` resolves once the operation is queued: `{ queued: true }`. */
export type BatchAssetsResponse = PostAssetBatchOperationResponse;

export type UpdateAssetOptions = PatchAssetBody & { assetId: string };

export type CreateFolderOptions = PostFolderBody;
export type UpdateFolderOptions = PatchFolderBody & { folderId: string };
export interface FolderIdOptions {
  folderId: string;
}
export interface MoveFolderOptions extends FolderIdOptions {
  parentId: string | null;
}
export type { HashList, HashListEntry };
/** `hashLists.list` options: a page of the project's hash lists, newest first. */
export type ListHashListsOptions = {
  /** The previous page's `nextCursor`; omit for the first page. */
  cursor?: string;
  /** 1 to 100; 10 by default. */
  pageSize?: number;
};
export type HashListPage = GetHashListsResponse;
export type CreateHashListOptions = PostHashListBody;
export type UpdateHashListOptions = PatchHashListBody & { hashListId: string };
export interface HashListIdOptions {
  hashListId: string;
}
export interface ListHashListEntriesOptions extends HashListIdOptions {
  /** The previous page's `nextCursor`; omit for the first page. */
  cursor?: string;
  pageSize?: number;
}
export type HashListEntryPage = GetHashListEntriesResponse;
/** Send `hash` (and `quality` when you know it) or `assetId`, an image asset in the project. */
export type AddHashListEntryOptions = PostHashListEntryBody & HashListIdOptions;
export interface HashListEntryIdOptions {
  entryId: string;
}

export interface MoveAssetOptions {
  assetId: string;
  folderId: string | null;
}

export type ListAssetChildrenOptions = Partial<GetAssetChildrenQuery> & {
  assetId: string;
};
/** `assets.iterateChildren` options. */
export type IterateAssetChildrenOptions = Omit<ListAssetChildrenOptions, "cursor">;

export type AssetContentOptions = AssetBinaryPayloadInput & {
  type: string;
  sizeInBytes?: number;
};

export type MultipartUploadPartOptions = AssetBinaryPayloadInput & {
  partNumber: number;
  isFinal?: boolean;
  sizeInBytes?: number;
};

export interface UploadAssetPartOptions extends IdempotencyOptions {
  assetId: string;
  part: MultipartUploadPartOptions;
  /**
   * Overrides the queue mode saved when the upload started, for this upload's final part.
   * Leave it unset to use the saved choice (`create` queues, `classify` waits).
   */
  queue?: boolean;
}

export type CreateMultipartUploadPartOptions = AssetContentOptions & {
  partNumber?: number;
  isFinal?: boolean;
  sizeInBytes?: number;
};

export interface SubmitAssetCommonOptions extends IdempotencyOptions {
  name: string;
  description?: string;
  processingOptions?: SharedAsset["processingOptions"];
  visibility?: "public" | "private";
  metadata?: SharedAsset["metadata"];
  /**
   * Your identifier for who wrote the content. CalmLens only compares it with the author IDs in
   * `context`, to tell which posts share a speaker.
   */
  authorId?: string;
  /**
   * Earlier posts in the conversation, oldest first. CalmLens moderates only the content and uses
   * these to read who it addresses, what it refers to and whether it quotes, reports, counters
   * or mocks something. The SDK sends only the posts CalmLens uses: the most recent 5 that fit
   * in 2,000 characters.
   */
  context?: ModerationContext;
  externalId?: string;
  externalUrl?: string;
  folderId?: string | null;
  /** An upload preset whose folder, visibility, file types and size limit apply. */
  uploadPresetId?: string;
  isFinal?: never;
}

export type SubmitAssetOptions =
  | (SubmitAssetCommonOptions & {
      content: AssetContentOptions;
    })
  | (SubmitAssetCommonOptions & {
      url: string;
    })
  | (SubmitAssetCommonOptions & {
      part: CreateMultipartUploadPartOptions;
      /** @deprecated The first part's size; use `part.sizeInBytes`. */
      sizeInBytes?: number;
      /**
       * The size of the whole file, when known. CalmLens then rejects an upload that could
       * never finish before storing it, and a part that would overshoot the declared size.
       */
      totalSizeInBytes?: number;
    });

export interface MultipartUploadOptions extends SubmitAssetCommonOptions {
  part: CreateMultipartUploadPartOptions;
  totalSizeInBytes?: number;
}

/** A webhook request body exactly as received: a string, `Uint8Array`/`Buffer` or `ArrayBuffer`. */
export type WebhookPayloadInput = string | Uint8Array | ArrayBuffer;

/** Request headers, as a `Headers` object or a Node-style record (`req.headers`). */
export type WebhookHeadersInput = Headers | Record<string, string | string[] | undefined | null>;

export interface VerifyWebhookSignatureOptions {
  /**
   * The raw request body, exactly as received: the string from `request.text()`, or the
   * `Buffer` from `express.raw()`. Parsed JSON is rejected, because re-serializing it can change
   * the signed bytes.
   */
  payload: WebhookPayloadInput;
  /** The `x-calmlens-signature` header value, e.g. `v1=<hex>` (a comma-separated list is allowed). */
  signature?: string | null;
  /** The `x-calmlens-timestamp` header value (unix seconds). */
  timestamp?: string | number | null;
  /** The request headers, read when `signature` or `timestamp` is not given. */
  headers?: WebhookHeadersInput;
  /** The connector's signing secret. */
  secret: string;
  /**
   * Maximum allowed distance between `timestamp` and now, in seconds. Defaults to
   * `WEBHOOK_SIGNATURE_TOLERANCE_SECONDS` (300).
   */
  toleranceSeconds?: number;
  /** The current time, as a `Date` or milliseconds since the epoch. Defaults to `Date.now()`. */
  now?: Date | number;
}

export interface ClassifyTextOptions
  extends Omit<SubmitAssetCommonOptions, "name" | "visibility" | "isFinal"> {
  text: string;
  name?: string;
}

export type ListFoldersOptions = GetFoldersQuery;
export type FolderPage = GetFoldersResponse;
