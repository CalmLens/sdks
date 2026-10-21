import type { Folder } from "../contract/Folder.js";
import { stringifyJsonCanonical } from "../contract/JsonUtils.js";
import type {
  GetEventsResponse,
  PostAssetSignedUrlResponse,
} from "../contract/PublicApiSchemas.js";
import { DOMAIN } from "../contract/SharedConstants.js";
import {
  CalmLensConnection,
  expectAsset,
  invalidPayload,
  newIdempotencyKey,
  prepareSubmitAssetOptions,
  resolveConnectionOptions,
} from "./CalmLensConnection";
import { CalmLensError, invalidArgument, invalidConfig, SDK_ERROR_CODES } from "./CalmLensError";
import { sleep, type TransportRequest } from "./CalmLensTransport";
import type {
  Asset,
  AssetChildrenPage,
  AssetPage,
  AssetSearchQuery,
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
  RequestOptions,
  RetrieveAssetOptions,
  RetryAssetOptions,
  SignedUploadToken,
  SignUploadTokenOptions,
  SubmitAssetOptions,
  UpdateAssetOptions,
  UpdateFolderOptions,
  UploadAssetPartOptions,
  VerifyWebhookSignatureOptions,
  WaitForAssetDecisionOptions,
} from "./CalmLensTypes";
import { signUploadTokenWithApiKey } from "./CalmLensUploadTokens";
import {
  appendCdnSelector,
  encodePathSegment,
  pollForDecision,
  toTextAssetOptions,
  transformSelector,
  validateRequestOptions,
  validateServerClientOptions,
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
    transforms: options.transforms ?? null,
    version: options.version,
  });

const requireId = (value: unknown, name: string): string => encodePathSegment(value, name);

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
      cdnBaseUrl: (rest.cdnBaseUrl ?? `https://cdn.${DOMAIN}/v1`).replace(/\/+$/, ""),
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
    const body = prepareSubmitAssetOptions(options);
    const uploadsPath = `${this.projectPath}/assets`;
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
       * need a signed URL (`assets.createSignedUrl`) or an authenticated request.
       */
      getAssetUrl: ({ assetIdentifier, ...options }: CdnAssetUrlOptions): string => {
        const resource = options.resource ?? "content";
        const { projectId } = this.#settings;
        const url = `${this.#settings.cdnBaseUrl}/assets/${encodeURIComponent(projectId)}/${requireId(assetIdentifier, "Asset identifier")}/${resource}`;
        return appendCdnSelector(url, options);
      },

      /**
       * Fetches asset content or a preview from the CDN with the client's API key, and returns
       * the `Response` as soon as headers arrive, so the body streams. Non-2xx responses are
       * returned, not thrown; `timeoutMs` covers only the wait for headers.
       */
      serve: async ({
        assetIdentifier,
        init,
        ...urlOptions
      }: CdnServeOptions): Promise<Response> => {
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
        this.buildAssets().classify(toTextAssetOptions(options)),
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
        return signUploadTokenWithApiKey(this.#apiKey, options);
      },
    };
  }

  private buildAssets() {
    return {
      /** Searches accessible assets by keyword or a natural-language description. */
      search: async (
        options: Partial<AssetSearchQuery> & { query: string },
      ): Promise<AssetSearchResponse> =>
        this.request("GET", `${this.projectPath}/assets/search`, { query: options }),

      /** Lists one page of the project's assets, with optional filter and ordering. */
      list: async (options: ListAssetsOptions = {}): Promise<AssetPage> =>
        this.request("GET", `${this.projectPath}/assets/page`, {
          query: options,
        }),

      /**
       * Yields every asset matching `options`, fetching pages as needed. The cursor keeps the position
       * stable when other assets are inserted or deleted.
       */
      iterate: (options: IterateAssetsOptions = {}): AsyncGenerator<Asset, void, undefined> =>
        this.iteratePages((cursor) => this.buildAssets().list({ ...options, cursor })),

      /** Retrieves an asset with its status and classification results. */
      retrieve: async ({ assetId }: RetrieveAssetOptions): Promise<Asset> =>
        this.request("GET", `/assets/${requireId(assetId, "Asset ID")}`),

      /** Updates an asset's editable fields. */
      update: async ({ assetId, ...body }: UpdateAssetOptions): Promise<Asset> =>
        this.request("PATCH", `/assets/${requireId(assetId, "Asset ID")}`, { body }),

      /** Lists one page of the assets extracted from a website or multimedia document. */
      listChildren: async (
        { assetId, ...options }: ListAssetChildrenOptions = {} as ListAssetChildrenOptions,
      ): Promise<AssetChildrenPage> =>
        this.request("GET", `/assets/${requireId(assetId, "Asset ID")}/children`, {
          query: options,
        }),

      /** Yields every child of an asset, fetching pages as needed. */
      iterateChildren: (
        options: IterateAssetChildrenOptions,
      ): AsyncGenerator<Asset, void, undefined> => {
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
        this.submitAsset(options, true),

      /**
       * Uploads an asset and waits for its moderation decision. Audio and video still finish
       * in the background. Retried safely with an `Idempotency-Key`.
       */
      classify: async (options: SubmitAssetOptions): Promise<Asset> => {
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
      uploadPart: async ({ assetId, ...options }: UploadAssetPartOptions): Promise<Asset> => {
        const encodedAssetId = requireId(assetId, "Asset ID");
        return expectAsset(
          await this.#connection.uploadPart(`/assets/${encodedAssetId}/part`, options),
        );
      },

      /**
       * Creates a short-lived signed CDN URL, so browsers can load private content without
       * an API key.
       */
      createSignedUrl: async ({
        assetId,
        ...options
      }: CreateAssetSignedUrlOptions): Promise<PostAssetSignedUrlResponse> => {
        const encodedAssetId = requireId(assetId, "Asset ID");
        return this.request("POST", `/assets/${encodedAssetId}/signed-url`, {
          body: {
            resource: options.resource ?? "content",
            expiresInSeconds: options.expiresInSeconds ?? 60 * 15,
            lens: options.lens,
            transform: transformSelector(options.transform),
          },
        });
      },

      /** Moves an asset into a folder, or to the project root with `folderId: null`. */
      move: async ({ assetId, folderId }: MoveAssetOptions): Promise<Asset> =>
        this.request("POST", `/assets/${requireId(assetId, "Asset ID")}/move`, {
          body: { folderId },
        }),

      /**
       * Processes an asset that failed (classification status `failed`) again. It returns to
       * `processing` and is
       * moderated like a new upload; its content must still be stored.
       */
      retry: async ({ assetId }: RetryAssetOptions): Promise<Asset> =>
        this.request("POST", `/assets/${requireId(assetId, "Asset ID")}/retry`),

      /**
       * Waits until an asset's `classification.moderation.decision` is `approved` or `rejected`, or its
       * `classification.status` is `failed`, and returns that asset, checking every few seconds. Rejects with `sdk/timeout` if there is no
       * decision within `timeoutMs` (default 60000). Webhooks report decisions without polling.
       */
      waitForDecision: async ({
        assetId,
        ...options
      }: WaitForAssetDecisionOptions): Promise<Asset> => {
        requireId(assetId, "Asset ID");
        const client = options.signal ? this.withRequestOptions({ signal: options.signal }) : this;
        return pollForDecision(() => client.assets.retrieve({ assetId }), options, sleep);
      },

      /**
       * Removes an asset's stored content (source, preview and retained extracted text) while
       * keeping the asset record, metadata and classification results. The returned asset has
       * `content.status` set to `removed` and `content.removalReason` to `requested`; the CDN no longer serves it.
       */
      deleteContent: async ({ assetId }: DeleteAssetContentOptions): Promise<Asset> =>
        this.request("DELETE", `/assets/${requireId(assetId, "Asset ID")}/content`),

      /** Deletes an asset record together with its stored content. */
      delete: async ({ assetId }: DeleteAssetOptions): Promise<void> => {
        await this.request("DELETE", `/assets/${requireId(assetId, "Asset ID")}`);
      },
    };
  }

  get events() {
    return {
      /**
       * Lists project events after a cursor, oldest first. Call without `after` to get a cursor
       * for "now", then poll with the returned `cursor`. Webhook deliveries carry the same events
       * reshaped as `{ id, type, createdAt, projectId, data }`.
       */
      list: async (options: ListEventsOptions = {}): Promise<GetEventsResponse> =>
        this.request("GET", `${this.projectPath}/events`, { query: { ...options } }),

      /**
       * Yields pages of events after `after` until no more are waiting. Save each page's
       * `cursor` to resume later. Without `after`, yields one empty page whose cursor is "now".
       */
      pages: (
        options: ListEventsOptions = {},
      ): AsyncGenerator<GetEventsResponse, void, undefined> => this.iterateEventPages(options),
    };
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

  get folders() {
    return {
      /** Lists one page of child folders; fetch a branch when it is opened. */
      list: async (options: ListFoldersOptions = {}): Promise<FolderPage> =>
        this.request("GET", `${this.projectPath}/folders`, { query: options }),

      retrieve: async ({ folderId }: FolderIdOptions): Promise<Folder> =>
        this.request("GET", `/folders/${requireId(folderId, "Folder ID")}`),

      /** Creates a folder at the project root or inside `parentId`. */
      create: async (options: CreateFolderOptions): Promise<Folder> =>
        this.request("POST", `${this.projectPath}/folders`, { body: options }),

      update: async ({ folderId, ...body }: UpdateFolderOptions): Promise<Folder> =>
        this.request("PATCH", `/folders/${requireId(folderId, "Folder ID")}`, { body }),

      /** Deletes an empty folder; throws `folder/not-empty` otherwise. */
      delete: async ({ folderId }: FolderIdOptions): Promise<void> => {
        await this.request("DELETE", `/folders/${requireId(folderId, "Folder ID")}`);
      },

      /** Moves a folder under `parentId`, or to the project root with `parentId: null`. */
      move: async ({ folderId, parentId }: MoveFolderOptions): Promise<Folder> =>
        this.request("POST", `/folders/${requireId(folderId, "Folder ID")}/move`, {
          body: { parentId },
        }),
    };
  }

  /**
   * Create a named lens at any positive version, or update it with a greater version.
   * Supplying the same definition and version is idempotent.
   */
  async ensureLens(options: EnsureLensOptions): Promise<Lens> {
    if (!options?.identifier) throw invalidArgument("Lens identifier is required");
    const [lens] = await this.ensureLenses({ lenses: [options] });
    return lens!;
  }

  /**
   * Create or update several named lenses. New definitions are sent in one API request, or in
   * consecutive requests of at most {@link ENSURE_LENSES_MAX_PER_REQUEST} definitions, in order.
   * Each lens follows the same versioning and idempotency rules as ensureLens().
   */
  async ensureLenses({ lenses }: EnsureLensesOptions): Promise<Lens[]> {
    if (!Array.isArray(lenses) || lenses.length === 0) {
      throw invalidArgument("At least one lens is required");
    }
    if (lenses.some((option) => !option?.identifier)) {
      throw invalidArgument("Lens identifier is required");
    }
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
