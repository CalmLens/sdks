import type { Folder } from "../contract/Folder.js";
import { stringifyJsonCanonical } from "../contract/JsonUtils.js";
import type {
  GetEventsResponse,
  PostAssetSignedUrlResponse,
} from "../contract/PublicApiSchemas.js";
import {
  CalmLensConnection,
  expectAsset,
  getMockHooks,
  invalidPayload,
  newIdempotencyKey,
  prepareSubmitAssetOptions,
  resolveConnectionOptions,
  splitsIntoParts,
} from "./CalmLensConnection";
import { CalmLensError, invalidArgument, invalidConfig, SDK_ERROR_CODES } from "./CalmLensError";
import { NULLABLE_OPTION_KEYS, SERVER_OPTION_KEYS } from "./CalmLensOptionKeys";
import type { TransportRequest } from "./CalmLensTransport";
import type {
  AddHashListEntryOptions,
  ApplyPolicyPresetOptions,
  Asset,
  AssetChildrenPage,
  AssetPage,
  AssetSearchQuery,
  AssetSearchResponse,
  AssetTimelinePage,
  AssignPolicyOptions,
  BatchAssetsOptions,
  BatchAssetsResponse,
  CalmLensServerClientOptions,
  CdnAssetUrlOptions,
  CdnServeOptions,
  ClassifyTextOptions,
  CreateAssetSignedUrlOptions,
  CreateFolderOptions,
  CreateHashListOptions,
  CreatePolicyOptions,
  DecideAssetOptions,
  DeleteAssetContentOptions,
  DeleteAssetOptions,
  EnsureLensesOptions,
  EnsureLensOptions,
  ExplainAssetOptions,
  FolderIdOptions,
  FolderPage,
  HashList,
  HashListEntry,
  HashListEntryIdOptions,
  HashListEntryPage,
  HashListIdOptions,
  HashListPage,
  IterateAssetChildrenOptions,
  IterateAssetsOptions,
  Lens,
  ListAssetChildrenOptions,
  ListAssetsOptions,
  ListAssetTimelineOptions,
  ListEventsOptions,
  ListFoldersOptions,
  ListHashListEntriesOptions,
  ListHashListsOptions,
  MoveAssetOptions,
  MoveFolderOptions,
  Policy,
  PolicyIdOptions,
  PolicyList,
  RequestOptions,
  RetrieveAssetOptions,
  RetryAssetOptions,
  SetPolicyAutomaticUpdatesOptions,
  SignedUploadToken,
  SignUploadTokenOptions,
  SubmitAssetOptions,
  UpdateAssetOptions,
  UpdateFolderOptions,
  UpdateHashListOptions,
  UpdatePolicyOptions,
  UploadAssetPartOptions,
  VerifyWebhookSignatureOptions,
  WaitForAssetDecisionOptions,
} from "./CalmLensTypes";
import { signUploadTokenWithApiKey } from "./CalmLensUploadTokens";
import {
  checkOptionKeys,
  DEFAULT_CDN_BASE_URL,
  DEFAULT_SIGNED_URL_EXPIRES_IN_SECONDS,
  encodePathSegment,
  getAssetUrl,
  pollForDecision,
  toTextAssetOptions,
  transformSelector,
  validateBatchAssetsOptions,
  validateRequestOptions,
  validateServerClientOptions,
  validateSignedUrlOptions,
} from "./CalmLensUtils";
import { isBrowserRuntime, isReactNativeRuntime } from "./CalmLensVersion";
import { verifyWebhookSignature } from "./CalmLensWebhooks";

/** The most lens definitions ensureLenses() sends in one request. */
export const ENSURE_LENSES_MAX_PER_REQUEST = 100;

const getEnsureLensCacheKey = (options: EnsureLensOptions): string =>
  stringifyJsonCanonical({
    identifier: options.identifier,
    name: options.name,
    description: options.description ?? null,
    type: options.type,
    active: options.active,
    transform: options.transform ?? null,
    version: options.version,
  });

const requireId = (value: unknown, name: string): string => encodePathSegment(value, name);

/**
 * `options`, once `checkOptionKeys` finds only keys `operation` takes, without the options given as
 * `null` that the API refuses as `null`: those are left out, as if omitted.
 */
const checked = <T>(operation: string, options: T): T => {
  checkOptionKeys(options, operation, SERVER_OPTION_KEYS);
  if (!options || typeof options !== "object" || Array.isArray(options)) return options;
  const nullable = NULLABLE_OPTION_KEYS[operation] ?? [];
  return Object.fromEntries(
    Object.entries(options).filter(([key, value]) => value !== null || nullable.includes(key)),
  ) as T;
};

/**
 * Iterators stop rather than loop: a page that says more follow must not hand back a cursor this
 * iteration has already sent, which would repeat the same pages forever.
 */
const assertNewCursor = (sent: Set<string>, cursor: string) => {
  if (sent.has(cursor)) {
    throw new CalmLensError(SDK_ERROR_CODES.INVALID_RESPONSE, {
      message: "The API returned a cursor it had already returned, with more pages to follow",
      details: { cursor },
    });
  }
  sent.add(cursor);
};

type ServerClientSettings = Omit<CalmLensServerClientOptions, "apiKey" | "baseUrl"> & {
  baseUrl: string;
  cdnBaseUrl: string;
};

interface LensCache {
  readonly ensuredLenses: Map<string, Lens>;
  readonly pendingEnsureLenses: Map<string, Promise<void>>;
}

const inspectSymbol = Symbol.for("nodejs.util.inspect.custom");

/**
 * The CalmLens API client for your server, authenticated with a project API key. Create one per
 * project and reuse it; it holds no connections. Every method takes one options object and
 * throws `CalmLensError` on failure. Browsers and apps upload with `CalmLensAppClient` instead.
 */
export default class CalmLensServerClient {
  readonly #apiKey: string;
  readonly #settings: ServerClientSettings;
  readonly #lenses: LensCache;
  readonly #connection: CalmLensConnection;

  /**
   * Verifies that a webhook delivery came from CalmLens: checks the `v1=` HMAC-SHA256 in
   * `x-calmlens-signature` over `"<x-calmlens-timestamp>.<raw body>"` and rejects timestamps
   * more than `toleranceSeconds` (default 300) from now, which stops replayed deliveries.
   * Also exported as `verifyWebhookSignature`; `parseWebhookEvent` verifies and parses.
   *
   * @example
   * ```ts
   * const payload = await request.text();
   * const isValid = await CalmLensServerClient.verifyWebhookSignature({
   *   payload,
   *   headers: request.headers,
   *   secret: process.env.CALMLENS_WEBHOOK_SECRET!,
   * });
   * ```
   */
  static async verifyWebhookSignature(options: VerifyWebhookSignatureOptions): Promise<boolean> {
    return verifyWebhookSignature(options);
  }

  constructor(options: CalmLensServerClientOptions, lenses?: LensCache) {
    validateServerClientOptions(options);
    if ((isBrowserRuntime() || isReactNativeRuntime()) && !options.dangerouslyAllowBrowser) {
      throw invalidConfig(
        "CalmLensServerClient is running in a browser or app, where anyone could read the API key. Call CalmLens from your server, upload from the browser or app with CalmLensAppClient, or set dangerouslyAllowBrowser: true for trusted internal tools.",
      );
    }
    const { apiKey, ...rest } = options;
    this.#apiKey = apiKey;
    this.#settings = {
      ...resolveConnectionOptions(rest),
      cdnBaseUrl: (
        rest.cdnBaseUrl ??
        getMockHooks(rest)?.defaultCdnBaseUrl ??
        DEFAULT_CDN_BASE_URL
      ).replace(/\/+$/, ""),
    };
    this.#lenses = lenses ?? { ensuredLenses: new Map(), pendingEnsureLenses: new Map() };
    this.#connection = new CalmLensConnection(this.#settings, apiKey);
  }

  /**
   * A client with different cancellation, deadlines or retries for the calls made through it,
   * sharing this client's credentials and lens cache. This client is unchanged.
   */
  withRequestOptions(options: RequestOptions): CalmLensServerClient {
    validateRequestOptions(options);
    return new CalmLensServerClient(
      { ...this.#settings, ...options, apiKey: this.#apiKey },
      this.#lenses,
    );
  }

  /** Keeps the API key out of `console.log`, `util.inspect` and `JSON.stringify`. */
  [inspectSymbol](): string {
    const { projectId, baseUrl } = this.#settings;
    return `CalmLensServerClient { projectId: ${JSON.stringify(projectId)}, baseUrl: ${JSON.stringify(baseUrl)} }`;
  }

  toJSON(): { projectId: string; baseUrl: string; cdnBaseUrl: string } {
    const { projectId, baseUrl, cdnBaseUrl } = this.#settings;
    return { projectId, baseUrl, cdnBaseUrl };
  }

  private get projectPath() {
    return `/projects/${encodeURIComponent(this.#settings.projectId)}`;
  }

  private request<T>(
    method: TransportRequest["method"],
    path: string,
    options: { query?: Record<string, unknown>; body?: unknown } = {},
  ): Promise<T> {
    return this.#connection.json<T>(method, path, options);
  }

  private async submitAsset(options: SubmitAssetOptions, queue: boolean): Promise<Asset> {
    const body = prepareSubmitAssetOptions(options, {
      deferUploadChecks: this.#connection.deferUploadChecks,
      partSizeBytes: this.#connection.partSizeBytes,
    });
    const uploadsPath = `${this.projectPath}/assets`;
    if ("content" in body && splitsIntoParts(body.content, this.#connection.partSizeBytes)) {
      return expectAsset(
        await this.#connection.submitInParts(uploadsPath, body, queue, {
          partPath: (assetId) => `/assets/${encodeURIComponent(assetId)}/part`,
          retrieve: (assetId) => this.buildAssets().retrieve({ assetId }),
        }),
      );
    }
    if ("content" in body || "part" in body) {
      return expectAsset(await this.#connection.submitRawUpload(uploadsPath, body, queue));
    }
    const { idempotencyKey, ...fields } = body;
    const data = await this.#connection.json<unknown>("POST", uploadsPath, {
      query: { queue },
      body: fields,
      idempotencyKey: idempotencyKey ?? newIdempotencyKey(),
    });
    return expectAsset(data);
  }

  get cdn() {
    return {
      /**
       * Builds a CDN URL for asset content or a preview, without a request. Private assets
       * need a signed URL (`assets.createSignedUrl`) or an authenticated request; public
       * age-restricted assets additionally require `viewerClaims.ageConfirmed: true`. Your
       * platform confirms the viewer's age; CalmLens does not verify this claim, and anyone can
       * add it to a public URL.
       */
      getAssetUrl: (urlOptions: CdnAssetUrlOptions): string => {
        const { assetIdentifier, ...options } = checked("cdn.getAssetUrl", urlOptions);
        const { projectId, cdnBaseUrl } = this.#settings;
        return getAssetUrl({ projectId, cdnBaseUrl, assetIdentifier, ...options });
      },

      /**
       * Fetches asset content or a preview from the CDN with the client's API key, and returns
       * the `Response` as soon as headers arrive, so the body streams. Non-2xx responses are
       * returned, not thrown; `timeoutMs` covers only the wait for headers.
       */
      serve: async (options: CdnServeOptions): Promise<Response> => {
        const { assetIdentifier, init, ...urlOptions } = checked("cdn.serve", options);
        const url = this.cdn.getAssetUrl({ assetIdentifier, ...urlOptions });
        const method = (init?.method?.toUpperCase() ?? "GET") as TransportRequest["method"];
        const { response } = await this.#connection.transport.send(
          {
            method,
            url,
            init,
            timeoutMs: this.#connection.timeoutMs,
            deadline: "headers",
            fetch: this.#settings.cdnFetch,
          },
          { allowHttpErrors: true },
        );
        return response;
      },
    };
  }

  get text() {
    return {
      /**
       * Moderates text and waits for the decision. Sends `text` as `text/plain` content named
       * `text` unless you pass `name`.
       */
      classify: async (options: ClassifyTextOptions): Promise<Asset> =>
        this.buildAssets().classify(toTextAssetOptions(checked("text.classify", options))),
    };
  }

  /** Assets: uploads, moderation and management. */
  get assets() {
    return this.buildAssets();
  }

  /**
   * Signs upload tokens on your server, so a browser or app can upload through an upload preset
   * that requires one. Signing happens locally with your API key: it makes no request.
   */
  get uploadTokens() {
    return {
      /**
       * Signs a single-use token for one upload through `uploadPresetId`. Give `token` to the
       * browser or app, which passes it to `CalmLensAppClient` as `token`.
       */
      sign: async (options: SignUploadTokenOptions): Promise<SignedUploadToken> => {
        return signUploadTokenWithApiKey(
          this.#apiKey,
          checked("uploadTokens.sign", options),
          this.#connection.hooks?.uploadTokenTime(),
        );
      },
    };
  }

  private buildAssets() {
    return {
      /** Searches accessible assets by keyword or a natural-language description. */
      search: async (
        options: Partial<AssetSearchQuery> & { query: string },
      ): Promise<AssetSearchResponse> =>
        this.request("GET", `${this.projectPath}/assets/search`, {
          query: checked("assets.search", options),
        }),

      /** Lists one page of the project's assets, with optional filter and ordering. */
      list: async (options: ListAssetsOptions = {}): Promise<AssetPage> =>
        this.request("GET", `${this.projectPath}/assets`, {
          query: checked("assets.list", options),
        }),

      /**
       * Yields every asset matching `options`, fetching pages as needed. The cursor keeps the position
       * stable when other assets are inserted or deleted.
       */
      iterate: (options: IterateAssetsOptions = {}): AsyncGenerator<Asset, void, undefined> => {
        checked("assets.iterate", options);
        return this.iteratePages((cursor) => this.buildAssets().list({ ...options, cursor }));
      },

      /** Retrieves an asset with its status and classification results. */
      retrieve: async (options: RetrieveAssetOptions): Promise<Asset> => {
        const { assetId } = checked("assets.retrieve", options);
        return this.request("GET", `/assets/${requireId(assetId, "Asset ID")}`);
      },

      /** Updates an asset's editable fields. */
      update: async (options: UpdateAssetOptions): Promise<Asset> => {
        const { assetId, ...body } = checked("assets.update", options);
        return this.request("PATCH", `/assets/${requireId(assetId, "Asset ID")}`, { body });
      },

      /** Lists one page of the assets extracted from a website or multimedia document. */
      listChildren: async (
        options: ListAssetChildrenOptions = {} as ListAssetChildrenOptions,
      ): Promise<AssetChildrenPage> => {
        const { assetId, ...query } = checked("assets.listChildren", options);
        return this.request("GET", `/assets/${requireId(assetId, "Asset ID")}/children`, {
          query,
        });
      },

      /**
       * Lists one page of an audio or video asset's findings timeline, in time order.
       * `classification.moderation.timeline.segmentCount` says how many segments there are.
       */
      listTimeline: async (options: ListAssetTimelineOptions): Promise<AssetTimelinePage> => {
        const { assetId, ...query } = checked("assets.listTimeline", options);
        const assetPath = `${this.projectPath}/assets/${requireId(assetId, "Asset ID")}`;
        return this.request("GET", `${assetPath}/timeline`, {
          query,
        });
      },

      /** Yields every child of an asset, fetching pages as needed. */
      iterateChildren: (
        options: IterateAssetChildrenOptions,
      ): AsyncGenerator<Asset, void, undefined> => {
        checked("assets.iterateChildren", options);
        requireId(options?.assetId, "Asset ID");
        return this.iteratePages((cursor) =>
          this.buildAssets().listChildren({ ...options, cursor }),
        );
      },

      /**
       * Uploads an asset and queues it for moderation, returning immediately with processing
       * status `processing` (or `uploading` for the first multipart part). Retried safely with an
       * `Idempotency-Key`.
       */
      create: async (options: SubmitAssetOptions): Promise<Asset> =>
        this.submitAsset(checked("assets.create", options), true),

      /**
       * Uploads an asset and waits for its moderation decision. Audio and video still finish
       * in the background. Retried safely with an `Idempotency-Key`.
       */
      classify: async (classifyOptions: SubmitAssetOptions): Promise<Asset> => {
        const options = checked("assets.classify", classifyOptions);
        if (
          options &&
          "content" in options &&
          "plainText" in options.content &&
          (typeof options.content.plainText !== "string" || !options.content.plainText.trim())
        ) {
          throw invalidPayload("Text to classify must be a non-empty string");
        }
        return this.submitAsset(options, false);
      },

      /**
       * Uploads the next part of a multipart upload. The upload's queue mode, chosen when it
       * started, applies when the final part arrives; pass `queue` to override it.
       */
      uploadPart: async (partOptions: UploadAssetPartOptions): Promise<Asset> => {
        const { assetId, ...options } = checked("assets.uploadPart", partOptions);
        const encodedAssetId = requireId(assetId, "Asset ID");
        return expectAsset(
          await this.#connection.uploadPart(`/assets/${encodedAssetId}/part`, options),
        );
      },

      /**
       * Creates a short-lived signed CDN URL, so browsers can load private content without
       * an API key.
       */
      createSignedUrl: async (
        signedUrlOptions: CreateAssetSignedUrlOptions,
      ): Promise<PostAssetSignedUrlResponse> => {
        const { assetId, ...options } = checked("assets.createSignedUrl", signedUrlOptions);
        const encodedAssetId = requireId(assetId, "Asset ID");
        validateSignedUrlOptions(options);
        return this.request("POST", `/assets/${encodedAssetId}/signed-url`, {
          body: {
            viewerClaims: options.viewerClaims,
            resource: options.resource,
            expiresInSeconds: options.expiresInSeconds ?? DEFAULT_SIGNED_URL_EXPIRES_IN_SECONDS,
            lens: options.lens,
            transform: transformSelector(options.transform),
          },
        });
      },

      /** Moves an asset into a folder, or to the project root with `folderId: null`. */
      move: async (options: MoveAssetOptions): Promise<Asset> => {
        const { assetId, folderId } = checked("assets.move", options);
        return this.request("POST", `/assets/${requireId(assetId, "Asset ID")}/move`, {
          body: { folderId },
        });
      },

      /**
       * Processes an asset that failed (classification status `failed`) again. It returns to
       * `processing` and is
       * moderated like a new upload; its content must still be stored.
       */
      retry: async (options: RetryAssetOptions): Promise<Asset> => {
        const { assetId } = checked("assets.retry", options);
        return this.request("POST", `/assets/${requireId(assetId, "Asset ID")}/retry`);
      },

      /**
       * Records a reviewer's decision, replacing the policy's: the asset's moderation status
       * becomes `decision`, the note joins its review history and the matching `asset.<status>`
       * event is sent. An asset still pending moderation can only be blocked or purged. Purging
       * needs `confirmPurge: true` and permanently deletes the stored content.
       */
      decide: async (options: DecideAssetOptions): Promise<Asset> => {
        const { assetId, ...body } = checked("assets.decide", options);
        return this.request("POST", `/assets/${requireId(assetId, "Asset ID")}/decision`, { body });
      },

      /**
       * Completes the policy evidence behind a decided asset's moderation decision: the report's
       * `classification.moderation.evidence` becomes `full` and every action stays as
       * decided. With `rerun: true` the asset is moderated again with the project's current policy
       * and returns in `processing`; use it when the policy has changed since the decision
       * (`asset/policy-changed`).
       */
      explain: async (options: ExplainAssetOptions): Promise<Asset> => {
        const { assetId, rerun } = checked("assets.explain", options);
        return this.request("POST", `/assets/${requireId(assetId, "Asset ID")}/explain`, {
          body: rerun ? { rerun } : {},
        });
      },

      /**
       * Waits until an asset is settled, its `classification.status` `completed` (with its
       * decision in `classification.moderation.status`) or `failed`, and returns that asset,
       * checking every few seconds. A `queued` or `processing` asset is still waiting, even when a
       * reviewer has already decided it. Rejects with `sdk/timeout` if it is not settled within
       * `timeoutMs` (default 60000). Webhooks report decisions without polling.
       */
      waitForDecision: async (waitOptions: WaitForAssetDecisionOptions): Promise<Asset> => {
        const { assetId, ...options } = checked("assets.waitForDecision", waitOptions);
        requireId(assetId, "Asset ID");
        const client = options.signal ? this.withRequestOptions({ signal: options.signal }) : this;
        return pollForDecision(
          () => client.assets.retrieve({ assetId }),
          options,
          this.#connection.sleep,
          this.#connection.hooks?.now,
        );
      },

      /**
       * Removes an asset's stored content (source, preview and retained extracted text) while
       * keeping the asset record, metadata and classification results. The returned asset has
       * `content.status` set to `removed` and `content.removalReason` to `requested`; the CDN no longer serves it.
       */
      deleteContent: async (options: DeleteAssetContentOptions): Promise<Asset> => {
        const { assetId } = checked("assets.deleteContent", options);
        return this.request("DELETE", `/assets/${requireId(assetId, "Asset ID")}/content`);
      },

      /** Deletes an asset record together with its stored content. */
      delete: async (options: DeleteAssetOptions): Promise<void> => {
        const { assetId } = checked("assets.delete", options);
        await this.request("DELETE", `/assets/${requireId(assetId, "Asset ID")}`);
      },

      /**
       * Deletes up to 500 assets (`operation: "delete"`) or removes their stored content
       * (`"remove-content"`) in one request. Every asset must exist in the project and the key
       * needs `assets:delete` for its folder, or nothing is queued. Resolves with
       * `{ queued: true }` once queued; the work runs in the background and records
       * `asset.deleted` or `asset.content-removed` for each asset. Assets under a safety hold
       * are skipped. Not retried: it carries no `Idempotency-Key`.
       */
      batch: async (options: BatchAssetsOptions): Promise<BatchAssetsResponse> => {
        const { assetIds, operation } = checked("assets.batch", options);
        validateBatchAssetsOptions({ assetIds, operation });
        return this.request("POST", `${this.projectPath}/assets/batch`, {
          body: { assetIds, operation },
        });
      },
    };
  }

  get events() {
    return {
      /**
       * Lists project events after a cursor, oldest first. Call without `cursor` to get a cursor
       * for "now", then poll with each response's `nextCursor`. Webhook deliveries carry each
       * event's same fields as a flat JSON body.
       */
      list: async (options: ListEventsOptions = {}): Promise<GetEventsResponse> =>
        this.request("GET", `${this.projectPath}/events`, {
          query: { ...checked("events.list", options) },
        }),

      /**
       * Yields pages of events after `cursor` until no more are waiting. Save each page's
       * `nextCursor` to resume later. Without `cursor`, yields one empty page whose `nextCursor`
       * is "now".
       */
      pages: (
        options: ListEventsOptions = {},
      ): AsyncGenerator<GetEventsResponse, void, undefined> =>
        this.iterateEventPages(checked("events.pages", options)),
    };
  }

  private async *iterateEventPages(
    options: ListEventsOptions,
  ): AsyncGenerator<GetEventsResponse, void, undefined> {
    let cursor = options.cursor;
    const sent = new Set(cursor === undefined ? [] : [cursor]);
    for (;;) {
      const page = await this.events.list({ ...options, cursor });
      if (page.hasMore) assertNewCursor(sent, page.nextCursor);
      yield page;
      if (!page.hasMore) return;
      cursor = page.nextCursor;
    }
  }

  private async *iteratePages(
    listPage: (
      cursor?: string,
    ) => Promise<{ items: Asset[]; nextCursor: string | null; hasMore: boolean }>,
  ): AsyncGenerator<Asset, void, undefined> {
    let cursor: string | undefined;
    const sent = new Set<string>();
    for (;;) {
      const page = await listPage(cursor);
      const more = !!page.nextCursor && page.hasMore && page.items.length > 0;
      if (more) assertNewCursor(sent, page.nextCursor!);
      yield* page.items;
      if (!more) return;
      cursor = page.nextCursor!;
    }
  }

  get folders() {
    return {
      /**
       * Lists one page of child folders, sorted by name unless `ordering` says otherwise. Pass
       * `nextCursor` as `cursor` for the next page; fetch a branch when it is opened.
       */
      list: async (options: ListFoldersOptions = {}): Promise<FolderPage> =>
        this.request("GET", `${this.projectPath}/folders`, {
          query: checked("folders.list", options),
        }),

      retrieve: async (options: FolderIdOptions): Promise<Folder> => {
        const { folderId } = checked("folders.retrieve", options);
        return this.request("GET", `/folders/${requireId(folderId, "Folder ID")}`);
      },

      /** Creates a folder at the project root or inside `parentId`. */
      create: async (options: CreateFolderOptions): Promise<Folder> =>
        this.request("POST", `${this.projectPath}/folders`, {
          body: checked("folders.create", options),
        }),

      update: async (options: UpdateFolderOptions): Promise<Folder> => {
        const { folderId, ...body } = checked("folders.update", options);
        return this.request("PATCH", `/folders/${requireId(folderId, "Folder ID")}`, { body });
      },

      /** Deletes an empty folder; throws `folder/not-empty` otherwise. */
      delete: async (options: FolderIdOptions): Promise<void> => {
        const { folderId } = checked("folders.delete", options);
        await this.request("DELETE", `/folders/${requireId(folderId, "Folder ID")}`);
      },

      /** Moves a folder under `parentId`, or to the project root with `parentId: null`. */
      move: async (options: MoveFolderOptions): Promise<Folder> => {
        const { folderId, parentId } = checked("folders.move", options);
        return this.request("POST", `/folders/${requireId(folderId, "Folder ID")}/move`, {
          body: { parentId },
        });
      },
    };
  }

  /**
   * Hash lists hold PDQ hashes of images the project never wants again. Image uploads are
   * compared with every list: `flag` lists record matches, `block` lists also block close ones.
   */
  get hashLists() {
    return {
      /** Lists one page of the project's hash lists, newest first. */
      list: async (options: ListHashListsOptions = {}): Promise<HashListPage> =>
        this.request("GET", `${this.projectPath}/hash-lists`, {
          query: checked("hashLists.list", options),
        }),

      retrieve: async (options: HashListIdOptions): Promise<HashList> => {
        const { hashListId } = checked("hashLists.retrieve", options);
        return this.request("GET", `/hash-lists/${requireId(hashListId, "Hash list ID")}`);
      },

      create: async (options: CreateHashListOptions): Promise<HashList> =>
        this.request("POST", `${this.projectPath}/hash-lists`, {
          body: checked("hashLists.create", options),
        }),

      /** Renames a list or changes its action; the new action applies to later uploads. */
      update: async (options: UpdateHashListOptions): Promise<HashList> => {
        const { hashListId, ...body } = checked("hashLists.update", options);
        return this.request("PATCH", `/hash-lists/${requireId(hashListId, "Hash list ID")}`, {
          body,
        });
      },

      /** Deletes the list and every entry in it. */
      delete: async (options: HashListIdOptions): Promise<void> => {
        const { hashListId } = checked("hashLists.delete", options);
        await this.request("DELETE", `/hash-lists/${requireId(hashListId, "Hash list ID")}`);
      },

      /** Lists one page of a list's entries, newest first. */
      listEntries: async (options: ListHashListEntriesOptions): Promise<HashListEntryPage> => {
        const { hashListId, ...query } = checked("hashLists.listEntries", options);
        return this.request("GET", `/hash-lists/${requireId(hashListId, "Hash list ID")}/entries`, {
          query,
        });
      },

      /** Adds a hash, or an image asset's hash; a hash already in the list returns its entry. */
      addEntry: async (options: AddHashListEntryOptions): Promise<HashListEntry> => {
        const { hashListId, ...body } = checked("hashLists.addEntry", options);
        return this.request(
          "POST",
          `/hash-lists/${requireId(hashListId, "Hash list ID")}/entries`,
          { body },
        );
      },

      removeEntry: async (options: HashListEntryIdOptions): Promise<void> => {
        const { entryId } = checked("hashLists.removeEntry", options);
        await this.request(
          "DELETE",
          `/hash-list-entries/${requireId(entryId, "Hash list entry ID")}`,
        );
      },
    };
  }

  /**
   * Moderation policies belong to the project's organisation and its projects share them. Every
   * change sends the policy's `revision`, so a policy changed since is refused. Through a
   * project's key you can change only policies no other project uses or owns.
   */
  get policies() {
    const policyPath = (policyId: string) =>
      `${this.projectPath}/policies/${requireId(policyId, "Policy ID")}`;
    return {
      /** Lists the organisation's policies and the ID of the one the project uses. */
      list: async (): Promise<PolicyList> => this.request("GET", `${this.projectPath}/policies`),

      retrieve: async (options: PolicyIdOptions): Promise<Policy> =>
        this.request("GET", policyPath(checked("policies.retrieve", options).policyId)),

      /** Creates a policy from `settings`, or a copy of a built-in preset with `presetId`. */
      create: async (options: CreatePolicyOptions): Promise<Policy> =>
        this.request("POST", `${this.projectPath}/policies`, {
          body: checked("policies.create", options),
        }),

      /** Changes the name, description or settings; later moderation uses them. */
      update: async (options: UpdatePolicyOptions): Promise<Policy> => {
        const { policyId, ...body } = checked("policies.update", options);
        return this.request("PATCH", policyPath(policyId), { body });
      },

      /** Resets a preset copy to its pinned version, or updates an unchanged copy to the latest. */
      applyPreset: async (options: ApplyPolicyPresetOptions): Promise<Policy> => {
        const { policyId, ...body } = checked("policies.applyPreset", options);
        return this.request("POST", `${policyPath(policyId)}/preset`, { body });
      },

      /** Switches automatic updates on or off for the organisation's own preset policy. */
      setAutomaticUpdates: async (options: SetPolicyAutomaticUpdatesOptions): Promise<Policy> => {
        const { policyId, ...body } = checked("policies.setAutomaticUpdates", options);
        return this.request("PUT", `${policyPath(policyId)}/automatic-updates`, { body });
      },

      /** Deletes a policy that no project or upload preset uses. */
      delete: async (options: PolicyIdOptions): Promise<void> => {
        await this.request("DELETE", policyPath(checked("policies.delete", options).policyId));
      },

      /** Chooses the policy the project moderates with. */
      assign: async (options: AssignPolicyOptions): Promise<Policy> =>
        this.request("PUT", `${this.projectPath}/policy`, {
          body: checked("policies.assign", options),
        }),
    };
  }

  /**
   * Create a named lens at any positive version, or update it with a greater version.
   * Supplying the same definition and version is idempotent.
   */
  async ensureLens(options: EnsureLensOptions): Promise<Lens> {
    checked("ensureLens", options);
    if (!options?.identifier) throw invalidArgument("Lens identifier is required");
    const [lens] = await this.ensureLenses({ lenses: [options] });
    return lens!;
  }

  /**
   * Create or update several named lenses. New definitions are sent in one API request, or in
   * consecutive requests of at most {@link ENSURE_LENSES_MAX_PER_REQUEST} definitions, in order.
   * Each lens follows the same versioning and idempotency rules as ensureLens().
   */
  async ensureLenses(options: EnsureLensesOptions): Promise<Lens[]> {
    const { lenses } = checked("ensureLenses", options);
    if (!Array.isArray(lenses) || lenses.length === 0) {
      throw invalidArgument("At least one lens is required");
    }
    if (lenses.some((option) => !option?.identifier)) {
      throw invalidArgument("Lens identifier is required");
    }
    for (const lens of lenses) checked("ensureLens", lens);
    const { ensuredLenses, pendingEnsureLenses } = this.#lenses;

    const missingOptions: EnsureLensOptions[] = [];
    const missingKeys = new Set<string>();
    for (const option of lenses) {
      const cacheKey = getEnsureLensCacheKey(option);
      if (!ensuredLenses.has(cacheKey) && !missingKeys.has(cacheKey)) {
        missingKeys.add(cacheKey);
        missingOptions.push(option);
      }
    }

    if (missingOptions.length > 0) {
      const batchCacheKey = JSON.stringify([...missingKeys].sort());
      let pending = pendingEnsureLenses.get(batchCacheKey);
      if (!pending) {
        pending = this.submitEnsureLenses(missingOptions);
        pendingEnsureLenses.set(batchCacheKey, pending);
        void pending.then(
          () => pendingEnsureLenses.delete(batchCacheKey),
          () => pendingEnsureLenses.delete(batchCacheKey),
        );
      }
      await pending;
    }

    return lenses.map((option) => {
      const lens = ensuredLenses.get(getEnsureLensCacheKey(option));
      if (!lens) {
        // Another call replaced this definition with a newer version while we waited.
        throw new CalmLensError(SDK_ERROR_CODES.INVALID_RESPONSE, {
          message: `CalmLens did not return lens "${option.identifier}"`,
        });
      }
      return lens;
    });
  }

  private async submitEnsureLenses(options: EnsureLensOptions[]): Promise<void> {
    // Chunks are sent in order; each chunk is cached before the next is sent.
    for (let start = 0; start < options.length; start += ENSURE_LENSES_MAX_PER_REQUEST) {
      await this.submitEnsureLensesChunk(
        options.slice(start, start + ENSURE_LENSES_MAX_PER_REQUEST),
      );
    }
  }

  private async submitEnsureLensesChunk(options: EnsureLensOptions[]): Promise<void> {
    const result = await this.request<{ lenses?: Lens[] }>("PUT", `${this.projectPath}/lenses`, {
      body: { lenses: options },
    });
    const returned = Array.isArray(result?.lenses) ? result.lenses : [];
    if (returned.length !== options.length) {
      throw new CalmLensError(SDK_ERROR_CODES.INVALID_RESPONSE, {
        message: `Expected ${options.length} lenses but CalmLens returned ${returned.length}`,
      });
    }
    const { ensuredLenses } = this.#lenses;
    for (const [index, lens] of returned.entries()) {
      const optionsForLens = options[index]!;
      if (lens?.identifier !== optionsForLens.identifier) {
        throw new CalmLensError(SDK_ERROR_CODES.INVALID_RESPONSE, {
          message: `Expected lens "${optionsForLens.identifier}" at position ${index}`,
        });
      }
      for (const [cacheKey, cachedLens] of ensuredLenses) {
        if (cachedLens.identifier === optionsForLens.identifier) {
          ensuredLenses.delete(cacheKey);
        }
      }
      ensuredLenses.set(getEnsureLensCacheKey(optionsForLens), lens);
    }
  }
}
