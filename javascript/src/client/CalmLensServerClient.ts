import type { AssetInfo } from "../contract/AssetInfo.js";
import type { Folder } from "../contract/Folder.js";
import { stringifyJsonCanonical } from "../contract/JsonUtils.js";
import type { GetEventsResponse, SignAssetUrlResponse } from "../contract/PublicApiSchemas.js";
import {
  appendAssetLocation,
  buildAssetUrl,
  DEFAULT_SIGNED_URL_EXPIRES_IN,
  getAssetInfo,
  validateSignAssetUrlOptions,
} from "./CalmLensCdn";
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
import {
  type CalmLensResponse,
  type CursorPageData,
  copyLastResponse,
  type ListPromise,
  listPages,
} from "./CalmLensPagination";
import type { TransportRequest } from "./CalmLensTransport";
import type {
  AddHashListEntryOptions,
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
  CreateFolderOptions,
  CreateHashListOptions,
  CreateLensOptions,
  CreatePolicyOptions,
  DecideAssetOptions,
  DeleteAssetOptions,
  DeleteMetadataFieldOptions,
  EnsureLensesOptions,
  EnsureLensOptions,
  EnsureMetadataFieldsOptions,
  EnsureUploadPresetsOptions,
  EnsureUploadPresetsResponse,
  ExplainAssetOptions,
  FolderIdOptions,
  FolderPage,
  GetAssetInfoOptions,
  HashList,
  HashListEntry,
  HashListEntryIdOptions,
  HashListEntryPage,
  HashListIdOptions,
  HashListPage,
  Lens,
  LensIdOptions,
  LensPage,
  ListAssetChildrenOptions,
  ListAssetsOptions,
  ListAssetTimelineOptions,
  ListEventsOptions,
  ListFoldersOptions,
  ListHashListEntriesOptions,
  ListHashListsOptions,
  ListLensesOptions,
  ListPoliciesOptions,
  ListUploadPresetsOptions,
  MetadataFieldsResource,
  MoveAssetOptions,
  MoveFolderOptions,
  Policy,
  PolicyIdOptions,
  PolicyPage,
  ProjectSettingsResource,
  RemoveAssetContentOptions,
  RequestOptions,
  ResetPolicyOptions,
  RetrieveAssetOptions,
  RetryAssetOptions,
  SetPolicyAutomaticUpdatesOptions,
  SignAssetUrlOptions,
  SignedAssetUrl,
  SignedUploadToken,
  SignUploadTokenOptions,
  SubmitAssetOptions,
  UpdateAssetOptions,
  UpdateFolderOptions,
  UpdateHashListOptions,
  UpdateLensOptions,
  UpdatePolicyOptions,
  UpdateProjectSettingsOptions,
  UpgradePolicyOptions,
  UploadAssetPartOptions,
  UploadPresetIdOptions,
  UploadPresetPage,
  VerifyWebhookSignatureOptions,
  WaitForAssetDecisionOptions,
} from "./CalmLensTypes";
import { signUploadTokenWithApiKey } from "./CalmLensUploadTokens";
import {
  checkOptionKeys,
  DEFAULT_CDN_BASE_URL,
  encodePathSegment,
  pollForDecision,
  toTextAssetOptions,
  validateBatchAssetsOptions,
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
    active: options.active ?? true,
    transform: options.transform ?? null,
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

type ServerClientSettings = Omit<CalmLensServerClientOptions, "apiKey" | "baseUrl"> & {
  baseUrl: string;
  cdnBaseUrl: string;
};

interface LensCache {
  readonly ensuredLenses: Map<string, Lens>;
  readonly pendingEnsureLenses: Map<string, Promise<void>>;
}

const inspectSymbol = Symbol.for("nodejs.util.inspect.custom");

const writableCdnResponse = (
  response: Response,
  metadata: Pick<Response, "url" | "redirected" | "type"> = response,
): Response => {
  // Opaque, network-error and upgrade responses cannot be reconstructed by Fetch.
  if (response.status < 200) return response;
  const writable = new Response(response.body, response);
  const { url, redirected, type } = metadata;
  return Object.defineProperties(writable, {
    url: { value: url },
    redirected: { value: redirected },
    type: { value: type },
    clone: {
      value(this: Response) {
        return writableCdnResponse(Response.prototype.clone.call(this), { url, redirected, type });
      },
    },
  });
};

/**
 * The CalmLens API client for your server, authenticated with a project API key. Create one per
 * project and reuse it; it holds no connections. Every method takes one options object and
 * throws `CalmLensError` on failure. Browsers and apps upload with `CalmLensAppClient` instead.
 */
export default class CalmLensServerClient {
  readonly #apiKey: string;
  /** The options this client was created with, without the API key, for `withRequestOptions`. */
  readonly #options: Omit<CalmLensServerClientOptions, "apiKey">;
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
    this.#options = rest;
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
      { ...this.#options, ...options, apiKey: this.#apiKey },
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
  ): Promise<CalmLensResponse<T>> {
    return this.#connection.json<CalmLensResponse<T>>(method, path, options);
  }

  /**
   * A list call: each page sends `options`, checked as `operation` takes them, with the cursor of
   * the page it fetches.
   */
  private paginate<
    Options extends { cursor?: string | null },
    Page extends CursorPageData<unknown>,
  >(
    operation: string,
    options: Options,
    send: (options: Options) => Promise<Page>,
  ): ListPromise<Page> {
    const first = (options as { cursor?: unknown } | null | undefined)?.cursor;
    return listPages(
      async (cursor) => {
        const valid = checked(operation, options);
        return send(cursor === first ? valid : { ...valid, cursor });
      },
      // The events feed reports more events waiting with an empty page and `hasMore`.
      { cursor: typeof first === "string" ? first : undefined, feed: operation === "events.list" },
    );
  }

  private async submitAsset(
    options: SubmitAssetOptions,
    wait: boolean,
  ): Promise<CalmLensResponse<Asset>> {
    const body = prepareSubmitAssetOptions(options, {
      deferUploadChecks: this.#connection.deferUploadChecks,
      partSizeBytes: this.#connection.partSizeBytes,
    });
    const uploadsPath = `${this.projectPath}/assets`;
    if ("content" in body && splitsIntoParts(body.content, this.#connection.partSizeBytes)) {
      return expectAsset(
        await this.#connection.submitInParts(uploadsPath, body, wait, {
          partPath: (assetId) => `/assets/${encodeURIComponent(assetId)}/part`,
          retrieve: (assetId) => this.buildAssets().retrieve({ assetId }),
        }),
      );
    }
    if ("content" in body || "part" in body) {
      return expectAsset(await this.#connection.submitUpload(uploadsPath, body, wait));
    }
    const { idempotencyKey, ...fields } = body;
    const data = await this.#connection.json<unknown>("POST", uploadsPath, {
      query: { wait },
      body: fields,
      idempotencyKey: idempotencyKey ?? newIdempotencyKey(),
    });
    return expectAsset(data);
  }

  get cdn() {
    return {
      /**
       * Builds an asset's CDN URL without a request: the asset URL, which every resource is a path
       * beneath, or a resource URL when `resource` is given, with its lens or transform and the
       * viewer claims. Use it for public assets; private ones need `cdn.signAssetUrl`. Viewer
       * claims are assertions from your app; CalmLens doesn't verify them.
       */
      getAssetUrl: (urlOptions: CdnAssetUrlOptions): string => {
        const { projectId, ...options } = checked("cdn.getAssetUrl", urlOptions);
        return buildAssetUrl(
          this.#settings.cdnBaseUrl,
          projectId ?? this.#settings.projectId,
          options as CdnAssetUrlOptions,
        );
      },

      /**
       * Signs a private asset's URL on your server, so browsers and apps can load it without an API
       * key until it expires. Every resource is a path beneath it, as beneath a public asset URL;
       * `/original` only when signed with `original: true`. With `resource`, returns that resource's
       * URL beneath the grant; lenses, transforms and viewer claims are appended as `getAssetUrl`
       * appends them and aren't part of the signature.
       */
      signAssetUrl: async (
        signOptions: SignAssetUrlOptions,
      ): Promise<CalmLensResponse<SignedAssetUrl>> => {
        const options = checked("cdn.signAssetUrl", signOptions);
        validateSignAssetUrlOptions(options);
        const { projectId, assetId, externalId, expiresIn, original, ...location } = options;
        const project = requireId(projectId ?? this.#settings.projectId, "Project ID");
        const signed = await this.request<SignAssetUrlResponse>(
          "POST",
          `/projects/${project}/signed-asset-urls`,
          {
            body: {
              ...(assetId !== undefined ? { assetId } : { externalId }),
              expiresIn: expiresIn ?? DEFAULT_SIGNED_URL_EXPIRES_IN,
              original: original ?? false,
            },
          },
        );
        if (
          !signed ||
          typeof signed.url !== "string" ||
          !signed.url ||
          typeof signed.expiresAt !== "number"
        ) {
          throw new CalmLensError(SDK_ERROR_CODES.INVALID_RESPONSE, {
            message: "The API returned no signed asset URL",
          });
        }
        return copyLastResponse(
          { url: appendAssetLocation(signed.url, location), expiresAt: signed.expiresAt },
          signed,
        ) as CalmLensResponse<SignedAssetUrl>;
      },

      /**
       * The display info of an asset URL, public or signed (`{url}/info`): its type, size,
       * rendered file, preview and stream, and whether the viewer its claims describe can see it.
       * A server can pass it to `CalmLensAsset` as `info`, so the first render is the real
       * element.
       */
      getAssetInfo: (url: string, options: Omit<GetAssetInfoOptions, "fetch"> = {}) =>
        getAssetInfo(url, { ...options, fetch: this.#settings.cdnFetch }) as Promise<AssetInfo>,

      /**
       * Fetches asset content or a preview from the CDN with the client's API key, and returns
       * a `Response` with writable headers as soon as headers arrive, so the body streams.
       * Non-2xx responses are returned, not thrown; `timeoutMs` covers only the wait for headers.
       */
      serve: async (options: CdnServeOptions): Promise<Response> => {
        const { init, resource = "rendered", ...urlOptions } = checked("cdn.serve", options);
        const url = this.cdn.getAssetUrl({ ...urlOptions, resource } as CdnAssetUrlOptions);
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
        return writableCdnResponse(response);
      },
    };
  }

  get text() {
    return {
      /**
       * Moderates text and waits for the decision. Sends `text` as `text/plain` content named
       * `text` unless you pass `name`.
       */
      classify: async (options: ClassifyTextOptions): Promise<CalmLensResponse<Asset>> =>
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
      ): Promise<CalmLensResponse<AssetSearchResponse>> =>
        this.request("GET", `${this.projectPath}/assets/search`, {
          query: checked("assets.search", options),
        }),

      /**
       * Lists the project's assets, with an optional filter and sort. Await it for one page, or
       * `for await` over it for every matching asset, fetching pages as needed.
       */
      list: (options: ListAssetsOptions = {}): ListPromise<AssetPage> =>
        this.paginate("assets.list", options, (query) =>
          this.request("GET", `${this.projectPath}/assets`, { query }),
        ),

      /** Retrieves an asset with its status and classification results. */
      retrieve: async (options: RetrieveAssetOptions): Promise<CalmLensResponse<Asset>> => {
        const { assetId } = checked("assets.retrieve", options);
        return this.request("GET", `/assets/${requireId(assetId, "Asset ID")}`);
      },

      /** Updates an asset's editable fields. */
      update: async (options: UpdateAssetOptions): Promise<CalmLensResponse<Asset>> => {
        const { assetId, ...body } = checked("assets.update", options);
        return this.request("PATCH", `/assets/${requireId(assetId, "Asset ID")}`, { body });
      },

      /**
       * Lists the assets extracted from a website or multimedia document. Await it for one page,
       * or `for await` over it for every child.
       */
      listChildren: (options: ListAssetChildrenOptions): ListPromise<AssetChildrenPage> =>
        // Untyped callers may leave the options out; the asset ID check then refuses the call.
        this.paginate(
          "assets.listChildren",
          options ?? ({} as ListAssetChildrenOptions),
          ({ assetId, ...query }) =>
            this.request("GET", `/assets/${requireId(assetId, "Asset ID")}/children`, { query }),
        ),

      /**
       * Lists an audio or video asset's findings timeline, in time order. Await it for one page,
       * or `for await` over it for every segment.
       * `classification.moderation.timeline.segmentCount` says how many segments there are.
       */
      listTimeline: (options: ListAssetTimelineOptions): ListPromise<AssetTimelinePage> =>
        this.paginate("assets.listTimeline", options, ({ assetId, ...query }) => {
          const assetPath = `${this.projectPath}/assets/${requireId(assetId, "Asset ID")}`;
          return this.request("GET", `${assetPath}/timeline`, { query });
        }),

      /**
       * Uploads an asset and returns without waiting for its decision (`wait=false`), with
       * `classification.status` `queued`. Retried safely with an `Idempotency-Key`.
       */
      create: async (options: SubmitAssetOptions): Promise<CalmLensResponse<Asset>> =>
        this.submitAsset(checked("assets.create", options), false),

      /**
       * Uploads an asset and waits for its moderation decision. Documents, websites, audio, video
       * and files over 20 MiB sent in parts still finish in the background and return `pending`.
       * Retried safely with an `Idempotency-Key`.
       */
      classify: async (classifyOptions: SubmitAssetOptions): Promise<CalmLensResponse<Asset>> => {
        const options = checked("assets.classify", classifyOptions);
        if (
          options &&
          "content" in options &&
          "plainText" in options.content &&
          (typeof options.content.plainText !== "string" || !options.content.plainText.trim())
        ) {
          throw invalidPayload("Text to classify must be a non-empty string");
        }
        return this.submitAsset(options, true);
      },

      /**
       * Uploads the next part of a multipart upload. Whether the final part waits for the
       * decision was chosen when the upload started; pass `wait` to override it.
       */
      uploadPart: async (partOptions: UploadAssetPartOptions): Promise<CalmLensResponse<Asset>> => {
        const { assetId, ...options } = checked("assets.uploadPart", partOptions);
        const encodedAssetId = requireId(assetId, "Asset ID");
        return expectAsset(
          await this.#connection.uploadPart(`/assets/${encodedAssetId}/part`, options),
        );
      },

      /** Moves an asset into a folder, or to the project root with `folderId: null`. */
      move: async (options: MoveAssetOptions): Promise<CalmLensResponse<Asset>> => {
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
      retry: async (options: RetryAssetOptions): Promise<CalmLensResponse<Asset>> => {
        const { assetId } = checked("assets.retry", options);
        return this.request("POST", `/assets/${requireId(assetId, "Asset ID")}/retry`);
      },

      /**
       * Records a reviewer's decision, replacing the policy's: the asset's moderation status
       * becomes `decision`, the note joins its review history and the matching `asset.<status>`
       * event is sent. An asset still pending moderation can only be blocked or purged. Purging
       * needs `confirmPurge: true` and permanently deletes the stored content.
       */
      decide: async (options: DecideAssetOptions): Promise<CalmLensResponse<Asset>> => {
        const { assetId, ...body } = checked("assets.decide", options);
        return this.request("POST", `/assets/${requireId(assetId, "Asset ID")}/decision`, { body });
      },

      /**
       * Completes the policy evidence behind a decided asset's moderation decision: its
       * `classification.moderation.explanationComplete` becomes `true` and every action stays as
       * decided. With `rerun: true` the asset is moderated again with the project's current policy
       * and an `asset.rerun-requested` event is recorded; use it when the policy has changed since
       * the decision (`asset/policy-changed`). The asset returns unchanged: it keeps its decision
       * until the re-run's is stored, reported by `asset.classified` and `asset.<status>` events,
       * and a failed re-run keeps it. A reviewed asset fails with `asset/reviewed`, and one whose
       * content is gone with `asset/content-unavailable`.
       */
      explain: async (options: ExplainAssetOptions): Promise<CalmLensResponse<Asset>> => {
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
      waitForDecision: async (
        waitOptions: WaitForAssetDecisionOptions,
      ): Promise<CalmLensResponse<Asset>> => {
        const { assetId, ...options } = checked("assets.waitForDecision", waitOptions);
        requireId(assetId, "Asset ID");
        const client = options.signal ? this.withRequestOptions({ signal: options.signal }) : this;
        return pollForDecision<CalmLensResponse<Asset>>(
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
      removeContent: async (
        options: RemoveAssetContentOptions,
      ): Promise<CalmLensResponse<Asset>> => {
        const { assetId } = checked("assets.removeContent", options);
        return this.request("DELETE", `/assets/${requireId(assetId, "Asset ID")}/content`);
      },

      /**
       * Deletes an asset record together with its stored content. An asset extracted from another
       * (one with a `parentId`) fails with `asset/child-not-deletable`: delete its parent instead.
       */
      delete: async (options: DeleteAssetOptions): Promise<void> => {
        const { assetId } = checked("assets.delete", options);
        await this.request("DELETE", `/assets/${requireId(assetId, "Asset ID")}`);
      },

      /**
       * Deletes up to 500 assets (`operation: "delete"`) or removes their stored content
       * (`"remove-content"`) in one request. Every asset must exist in the project and the key
       * needs `assets:delete` for its folder, and a deletion can't name an asset extracted from
       * another (`asset/child-not-deletable`), or nothing is queued. Resolves with
       * `{ batchId, status: "queued", assetCount }` once queued; the work runs in the background
       * and records `asset.deleted` or `asset.content-removed` for each asset, with a `batch-id`
       * fact naming `batchId`. Assets under a safety hold are skipped. Not retried: it carries no
       * `Idempotency-Key`.
       */
      batch: async (
        options: BatchAssetsOptions,
      ): Promise<CalmLensResponse<BatchAssetsResponse>> => {
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
       * event's same fields as a flat JSON body. `types` and `assetId` narrow the feed to some
       * event types or one asset's events; a cursor belongs to the filters it was issued with, so
       * pass the same ones with each `cursor`. `for await` over it yields every event waiting
       * after `cursor`; save the last page's `nextCursor` to resume later.
       */
      list: (options: ListEventsOptions = {}): ListPromise<GetEventsResponse> =>
        this.paginate("events.list", options, ({ types, ...query }) =>
          this.request("GET", `${this.projectPath}/events`, {
            // The API takes the types as one comma-separated value.
            query: { ...query, types: types?.length ? types.join(",") : undefined },
          }),
        ),
    };
  }

  get folders() {
    return {
      /**
       * Lists the child folders of `parentId` (or the project root), sorted by name unless
       * `sort` says otherwise. Await it for one page, or `for await` over it for every folder;
       * fetch a branch when it is opened.
       */
      list: (options: ListFoldersOptions = {}): ListPromise<FolderPage> =>
        this.paginate("folders.list", options, (query) =>
          this.request("GET", `${this.projectPath}/folders`, { query }),
        ),

      retrieve: async (options: FolderIdOptions): Promise<CalmLensResponse<Folder>> => {
        const { folderId } = checked("folders.retrieve", options);
        return this.request("GET", `/folders/${requireId(folderId, "Folder ID")}`);
      },

      /** Creates a folder at the project root or inside `parentId`. */
      create: async (options: CreateFolderOptions): Promise<CalmLensResponse<Folder>> =>
        this.request("POST", `${this.projectPath}/folders`, {
          body: checked("folders.create", options),
        }),

      update: async (options: UpdateFolderOptions): Promise<CalmLensResponse<Folder>> => {
        const { folderId, ...body } = checked("folders.update", options);
        return this.request("PATCH", `/folders/${requireId(folderId, "Folder ID")}`, { body });
      },

      /** Deletes an empty folder; throws `folder/not-empty` otherwise. */
      delete: async (options: FolderIdOptions): Promise<void> => {
        const { folderId } = checked("folders.delete", options);
        await this.request("DELETE", `/folders/${requireId(folderId, "Folder ID")}`);
      },

      /** Moves a folder under `parentId`, or to the project root with `parentId: null`. */
      move: async (options: MoveFolderOptions): Promise<CalmLensResponse<Folder>> => {
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
      /** Lists the project's hash lists, newest first unless `sort` says otherwise. */
      list: (options: ListHashListsOptions = {}): ListPromise<HashListPage> =>
        this.paginate("hashLists.list", options, (query) =>
          this.request("GET", `${this.projectPath}/hash-lists`, { query }),
        ),

      retrieve: async (options: HashListIdOptions): Promise<CalmLensResponse<HashList>> => {
        const { hashListId } = checked("hashLists.retrieve", options);
        return this.request("GET", `/hash-lists/${requireId(hashListId, "Hash list ID")}`);
      },

      create: async (options: CreateHashListOptions): Promise<CalmLensResponse<HashList>> =>
        this.request("POST", `${this.projectPath}/hash-lists`, {
          body: checked("hashLists.create", options),
        }),

      /** Renames a list or changes its action; the new action applies to later uploads. */
      update: async (options: UpdateHashListOptions): Promise<CalmLensResponse<HashList>> => {
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

      /** Lists a list's entries, newest first unless `sort` says otherwise. */
      listEntries: (options: ListHashListEntriesOptions): ListPromise<HashListEntryPage> =>
        this.paginate("hashLists.listEntries", options, ({ hashListId, ...query }) =>
          this.request("GET", `/hash-lists/${requireId(hashListId, "Hash list ID")}/entries`, {
            query,
          }),
        ),

      /** Adds a hash, or an image asset's hash; a hash already in the list returns its entry. */
      addEntry: async (
        options: AddHashListEntryOptions,
      ): Promise<CalmLensResponse<HashListEntry>> => {
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
   * Moderation policies belong to the organisation and its projects share them. Every change sends
   * the policy's `revision`, so a policy changed since is refused. Through a project's key you can
   * change only policies no other project uses.
   */
  get policies() {
    const policyPath = (policyId: string) => `/policies/${requireId(policyId, "Policy ID")}`;
    return {
      /** Lists the organisation's policies, oldest first unless `sort` says otherwise. */
      list: (options: ListPoliciesOptions = {}): ListPromise<PolicyPage> =>
        this.paginate("policies.list", options, (query) =>
          this.request("GET", "/policies", { query }),
        ),

      retrieve: async (options: PolicyIdOptions): Promise<CalmLensResponse<Policy>> =>
        this.request("GET", policyPath(checked("policies.retrieve", options).policyId)),

      /** Creates a policy from `settings`, or a copy of a built-in preset with `presetId`. */
      create: async (options: CreatePolicyOptions): Promise<CalmLensResponse<Policy>> =>
        this.request("POST", "/policies", { body: checked("policies.create", options) }),

      /** Changes the name, description or settings; later moderation uses them. */
      update: async (options: UpdatePolicyOptions): Promise<CalmLensResponse<Policy>> => {
        const { policyId, ...body } = checked("policies.update", options);
        return this.request("PATCH", policyPath(policyId), { body });
      },

      /** Restores the settings of the preset release a `pinned` or `copy` policy is pinned to. */
      reset: async (options: ResetPolicyOptions): Promise<CalmLensResponse<Policy>> => {
        const { policyId, ...body } = checked("policies.reset", options);
        return this.request("POST", `${policyPath(policyId)}/reset`, { body });
      },

      /** Moves an unchanged `pinned` or `copy` policy to the latest release of its preset. */
      upgrade: async (options: UpgradePolicyOptions): Promise<CalmLensResponse<Policy>> => {
        const { policyId, ...body } = checked("policies.upgrade", options);
        return this.request("POST", `${policyPath(policyId)}/upgrade`, { body });
      },

      /** Switches automatic updates on (`live`) or off (`pinned`) for the organisation's own preset policy. */
      setAutomaticUpdates: async (
        options: SetPolicyAutomaticUpdatesOptions,
      ): Promise<CalmLensResponse<Policy>> => {
        const { policyId, ...body } = checked("policies.setAutomaticUpdates", options);
        return this.request("PUT", `${policyPath(policyId)}/automatic-updates`, { body });
      },

      /** Deletes a policy that no project or upload preset uses. */
      delete: async (options: PolicyIdOptions): Promise<void> => {
        await this.request("DELETE", policyPath(checked("policies.delete", options).policyId));
      },

      /** The policy the project moderates with. */
      retrieveAssigned: async (): Promise<CalmLensResponse<Policy>> =>
        this.request("GET", `${this.projectPath}/policy`),

      /** Chooses the policy the project moderates with. */
      assign: async (options: AssignPolicyOptions): Promise<CalmLensResponse<Policy>> =>
        this.request("PUT", `${this.projectPath}/policy`, {
          body: checked("policies.assign", options),
        }),
    };
  }

  /**
   * The project's upload presets: the rules for uploads from browsers and apps. `ensure` creates or
   * replaces presets by key, for deploys that declare them in code; send each preset's `revision`
   * to refuse a change made since you read it.
   */
  get uploadPresets() {
    return {
      /** Lists the project's upload presets, oldest first unless `sort` says otherwise. */
      list: (options: ListUploadPresetsOptions = {}): ListPromise<UploadPresetPage> =>
        this.paginate("uploadPresets.list", options, (query) =>
          this.request("GET", `${this.projectPath}/upload-presets`, { query }),
        ),

      /**
       * Creates each preset, or replaces it with the definition sent, by key. Every preset is
       * checked before any is saved. Returns the stored presets in the order sent.
       */
      ensure: async (
        options: EnsureUploadPresetsOptions,
      ): Promise<CalmLensResponse<EnsureUploadPresetsResponse>> =>
        this.request("PUT", `${this.projectPath}/upload-presets`, {
          body: checked("uploadPresets.ensure", options),
        }),

      /** Deletes an upload preset; assets already uploaded through it stay. */
      delete: async (options: UploadPresetIdOptions): Promise<void> => {
        const { uploadPresetId } = checked("uploadPresets.delete", options);
        await this.request(
          "DELETE",
          `/upload-presets/${requireId(uploadPresetId, "Upload preset ID")}`,
        );
      },
    };
  }

  /**
   * The project's settings, with defaults filled in. `update` replaces them: settings left out
   * return to their defaults. Send the `revision` you read to refuse a change made since.
   */
  get projectSettings() {
    return {
      get: async (): Promise<CalmLensResponse<ProjectSettingsResource>> =>
        this.request("GET", `${this.projectPath}/settings`),

      update: async (
        options: UpdateProjectSettingsOptions,
      ): Promise<CalmLensResponse<ProjectSettingsResource>> =>
        this.request("PUT", `${this.projectPath}/settings`, {
          body: checked("projectSettings.update", options),
        }),
    };
  }

  /**
   * The project's metadata fields. They share the project settings' `revision`; `ensure` creates
   * or replaces fields by ID and keeps the others.
   */
  get metadataFields() {
    return {
      list: async (): Promise<CalmLensResponse<MetadataFieldsResource>> =>
        this.request("GET", `${this.projectPath}/metadata-fields`),

      ensure: async (
        options: EnsureMetadataFieldsOptions,
      ): Promise<CalmLensResponse<MetadataFieldsResource>> =>
        this.request("PUT", `${this.projectPath}/metadata-fields`, {
          body: checked("metadataFields.ensure", options),
        }),

      /** Deletes a field definition; assets keep their values. */
      delete: async (options: DeleteMetadataFieldOptions): Promise<void> => {
        const { fieldId, ...query } = checked("metadataFields.delete", options);
        await this.request(
          "DELETE",
          `${this.projectPath}/metadata-fields/${requireId(fieldId, "Metadata field ID")}`,
          { query },
        );
      },
    };
  }

  /**
   * The project's lenses: named image transforms the CDN applies at `/@<identifier>`. The CDN
   * serves files made with each lens's current definition. `ensureLenses` creates or changes
   * lenses by identifier, for applications that declare theirs in code.
   */
  get lenses() {
    const lensPath = (lensId: string) => `/lenses/${requireId(lensId, "Lens ID")}`;
    // A lens changed here no longer has the definition ensureLens cached for it.
    const forget = (matches: (lens: Lens) => boolean) => {
      for (const [cacheKey, lens] of this.#lenses.ensuredLenses)
        if (matches(lens)) this.#lenses.ensuredLenses.delete(cacheKey);
    };
    return {
      /** Lists the project's lenses, newest first unless `sort` says otherwise. */
      list: (options: ListLensesOptions = {}): ListPromise<LensPage> =>
        this.paginate("lenses.list", options, (query) =>
          this.request("GET", `${this.projectPath}/lenses`, { query }),
        ),

      /** Creates a lens; its identifier must be new to the project. */
      create: async (options: CreateLensOptions): Promise<CalmLensResponse<Lens>> => {
        const lens = await this.request<Lens>("POST", `${this.projectPath}/lenses`, {
          body: checked("lenses.create", options),
        });
        forget((cached) => cached.identifier === lens.identifier);
        return lens;
      },

      retrieve: async (options: LensIdOptions): Promise<CalmLensResponse<Lens>> =>
        this.request("GET", lensPath(checked("lenses.retrieve", options).lensId)),

      /** Changes a lens's name, description, type, transform or whether the CDN serves it. */
      update: async (options: UpdateLensOptions): Promise<CalmLensResponse<Lens>> => {
        const { lensId, ...body } = checked("lenses.update", options);
        const lens = await this.request<Lens>("PATCH", lensPath(lensId), { body });
        forget((cached) => cached.id === lens.id);
        return lens;
      },

      /** Deletes a lens; URLs that select it stop being served. */
      delete: async (options: LensIdOptions): Promise<void> => {
        const { lensId } = checked("lenses.delete", options);
        await this.request("DELETE", lensPath(lensId));
        forget((cached) => cached.id === lensId);
      },
    };
  }

  /**
   * Creates a named lens, or changes it to this definition. Sending the same definition again
   * returns the lens unchanged, from the client's lens cache once it has seen it.
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
   * Each lens is created or changed as ensureLens() does.
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
