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
  validateCallOptions,
} from "./CalmLensConnection";
import { CalmLensError, invalidArgument, invalidConfig, SDK_ERROR_CODES } from "./CalmLensError";
import { readEnv } from "./CalmLensLogging";
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
  stringifyQuery,
  toTextAssetOptions,
  validateBatchAssetsOptions,
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

/** `options`, after checking that text it classifies isn't empty. */
const checkedTextContent = <T extends SubmitAssetOptions>(options: T): T => {
  if (
    options &&
    "content" in options &&
    "plainText" in options.content &&
    (typeof options.content.plainText !== "string" || !options.content.plainText.trim())
  ) {
    throw invalidPayload("Text to classify must be a non-empty string");
  }
  return options;
};

/** A signal that aborts when any of `signals` does. */
const anySignal = (signals: AbortSignal[]): AbortSignal => {
  if (typeof AbortSignal.any === "function") return AbortSignal.any(signals);
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) controller.abort(signal.reason);
    else signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
  }
  return controller.signal;
};

/**
 * Fills in what the options leave out from the environment: `CALMLENS_API_KEY`,
 * `CALMLENS_PROJECT_ID` and `CALMLENS_BASE_URL`, in runtimes that have one.
 */
const withEnvironmentDefaults = (
  options: CalmLensServerClientOptions,
): CalmLensServerClientOptions => {
  // Mock clients never read the environment, so tests behave the same everywhere.
  if (!options || typeof options !== "object" || getMockHooks(options)) return options;
  const apiKey = options.apiKey ?? readEnv("CALMLENS_API_KEY");
  const projectId = options.projectId ?? readEnv("CALMLENS_PROJECT_ID");
  const baseUrl = options.baseUrl ?? readEnv("CALMLENS_BASE_URL");
  return {
    ...options,
    ...(apiKey !== undefined && { apiKey }),
    ...(projectId !== undefined && { projectId }),
    ...(baseUrl !== undefined && { baseUrl }),
  };
};

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
  projectId: string;
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
 * project and reuse it; it holds no connections. Every method takes one options object, then
 * optional `RequestOptions` for that call, and throws `CalmLensError` on failure. Options left
 * out of the constructor come from `CALMLENS_API_KEY`, `CALMLENS_PROJECT_ID`, `CALMLENS_BASE_URL`
 * and `CALMLENS_LOG`. Browsers and apps upload with `CalmLensAppClient` instead.
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

  constructor(clientOptions: CalmLensServerClientOptions = {}, lenses?: LensCache) {
    const options = withEnvironmentDefaults(clientOptions);
    validateServerClientOptions(options);
    if ((isBrowserRuntime() || isReactNativeRuntime()) && !options.dangerouslyAllowBrowser) {
      throw invalidConfig(
        "CalmLensServerClient is running in a browser or app, where anyone could read the API key. Call CalmLens from your server, upload from the browser or app with CalmLensAppClient, or set dangerouslyAllowBrowser: true for trusted internal tools.",
      );
    }
    const { apiKey, projectId, ...rest } = options as Required<
      Pick<CalmLensServerClientOptions, "apiKey" | "projectId">
    > &
      CalmLensServerClientOptions;
    this.#apiKey = apiKey;
    this.#settings = {
      projectId,
      ...resolveConnectionOptions(rest),
      cdnBaseUrl: (
        rest.cdnBaseUrl ??
        getMockHooks(rest)?.defaultCdnBaseUrl ??
        DEFAULT_CDN_BASE_URL
      ).replace(/\/+$/, ""),
    };
    this.#lenses = lenses ?? { ensuredLenses: new Map(), pendingEnsureLenses: new Map() };
    this.#connection = new CalmLensConnection(this.#settings, apiKey, {
      readEnvironment: !getMockHooks(options),
    });
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

  get #projectPath() {
    return `/projects/${encodeURIComponent(this.#settings.projectId)}`;
  }

  /** Sends one of `operation`'s requests with its request options. */
  async #send<T>(
    operation: string,
    requestOptions: RequestOptions | undefined,
    method: TransportRequest["method"],
    path: string,
    options: { query?: Record<string, unknown>; body?: unknown } = {},
  ): Promise<CalmLensResponse<T>> {
    return this.#connection
      .forCall(operation, requestOptions)
      .json<CalmLensResponse<T>>(method, path, options);
  }

  /**
   * Sends any API request with the client's API key, retries, deadlines and error handling, for
   * endpoints or fields this SDK version doesn't cover yet. `path` is relative to the base URL,
   * such as `/assets/asset_123`; `query` and `body` are sent as they are, without the option
   * check the other methods make. GET, HEAD and requests with an `idempotencyKey` are retried.
   * Resolves with the parsed JSON body and its `lastResponse` (`undefined` for an empty body).
   */
  async request<T = unknown>(
    method: TransportRequest["method"],
    path: string,
    {
      query,
      body,
      headers,
    }: {
      query?: Record<string, unknown>;
      body?: unknown;
      headers?: Record<string, string>;
    } = {},
    requestOptions?: RequestOptions,
  ): Promise<CalmLensResponse<T>> {
    const methods = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"];
    if (typeof method !== "string" || !methods.includes(method)) {
      throw invalidArgument(`method must be one of ${methods.join(", ")}`);
    }
    if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//")) {
      throw invalidArgument('path must start with "/", such as "/assets/asset_123"');
    }
    const { headers: callHeaders, ...rest } = requestOptions ?? {};
    return this.#send<T>(
      // Raw requests have no client method name.
      undefined as unknown as string,
      { ...rest, ...((callHeaders || headers) && { headers: { ...callHeaders, ...headers } }) },
      method,
      path,
      { query, body },
    );
  }

  /**
   * A list call: each page sends `options`, checked as `operation` takes them, with the cursor of
   * the page it fetches.
   */
  #paginate<Options extends { cursor?: string | null }, Page extends CursorPageData<unknown>>(
    operation: string,
    options: Options,
    requestOptions: RequestOptions | undefined,
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

  async #submitAsset(
    operation: string,
    options: SubmitAssetOptions,
    wait: boolean,
    requestOptions: RequestOptions | undefined,
  ): Promise<CalmLensResponse<Asset>> {
    const connection = this.#connection.forCall(operation, requestOptions);
    const body = prepareSubmitAssetOptions(options, {
      deferUploadChecks: connection.deferUploadChecks,
      partSizeBytes: connection.partSizeBytes,
    });
    const uploadsPath = `${this.#projectPath}/assets`;
    if ("content" in body && splitsIntoParts(body.content, connection.partSizeBytes)) {
      const { idempotencyKey: _key, extraBody: _body, ...readOptions } = requestOptions ?? {};
      return expectAsset(
        await connection.submitInParts(uploadsPath, body, wait, {
          partPath: (assetId) => `/assets/${encodeURIComponent(assetId)}/part`,
          retrieve: (assetId) => this.#buildAssets().retrieve({ assetId }, readOptions),
        }),
      );
    }
    if ("content" in body || "part" in body) {
      return expectAsset(await connection.submitUpload(uploadsPath, body, wait));
    }
    const { idempotencyKey, ...fields } = body;
    const data = await connection.json<unknown>("POST", uploadsPath, {
      query: { wait },
      body: fields,
      idempotencyKey: idempotencyKey ?? requestOptions?.idempotencyKey ?? newIdempotencyKey(),
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
        requestOptions?: RequestOptions,
      ): Promise<CalmLensResponse<SignedAssetUrl>> => {
        const options = checked("cdn.signAssetUrl", signOptions);
        validateSignAssetUrlOptions(options);
        const { projectId, assetId, externalId, expiresIn, original, ...location } = options;
        const project = requireId(projectId ?? this.#settings.projectId, "Project ID");
        const signed = await this.#send<SignAssetUrlResponse>(
          "cdn.signAssetUrl",
          requestOptions,
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
      serve: async (
        options: CdnServeOptions,
        requestOptions?: RequestOptions,
      ): Promise<Response> => {
        const { init, resource = "rendered", ...urlOptions } = checked("cdn.serve", options);
        const connection = this.#connection.forCall("cdn.serve", requestOptions);
        if (requestOptions?.extraBody)
          throw invalidArgument("cdn.serve sends no body: extraBody can't apply");
        const url = this.cdn.getAssetUrl({ ...urlOptions, resource } as CdnAssetUrlOptions);
        const extraQuery = requestOptions?.extraQuery && stringifyQuery(requestOptions.extraQuery);
        const method = (init?.method?.toUpperCase() ?? "GET") as TransportRequest["method"];
        const { response } = await connection.transport.send(
          {
            ...connection.callRequest(),
            method,
            url: extraQuery ? `${url}${url.includes("?") ? "&" : "?"}${extraQuery}` : url,
            headers: requestOptions?.headers,
            init,
            timeoutMs: connection.timeoutMs,
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
      classify: async (
        options: ClassifyTextOptions,
        requestOptions?: RequestOptions,
      ): Promise<CalmLensResponse<Asset>> =>
        this.#submitAsset(
          "text.classify",
          checkedTextContent(toTextAssetOptions(checked("text.classify", options))),
          true,
          requestOptions,
        ),
    };
  }

  /** Assets: uploads, moderation and management. */
  get assets() {
    return this.#buildAssets();
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

  #buildAssets() {
    return {
      /** Searches accessible assets by keyword or a natural-language description. */
      search: async (
        options: Partial<AssetSearchQuery> & { query: string },
        requestOptions?: RequestOptions,
      ): Promise<CalmLensResponse<AssetSearchResponse>> =>
        this.#send("assets.search", requestOptions, "GET", `${this.#projectPath}/assets/search`, {
          query: checked("assets.search", options),
        }),

      /**
       * Lists the project's assets, with an optional filter and sort. Await it for one page, or
       * `for await` over it for every matching asset, fetching pages as needed.
       */
      list: (
        options: ListAssetsOptions = {},
        requestOptions?: RequestOptions,
      ): ListPromise<AssetPage> =>
        this.#paginate("assets.list", options, requestOptions, (query) =>
          this.#send("assets.list", requestOptions, "GET", `${this.#projectPath}/assets`, {
            query,
          }),
        ),

      /** Retrieves an asset with its status and classification results. */
      retrieve: async (
        options: RetrieveAssetOptions,
        requestOptions?: RequestOptions,
      ): Promise<CalmLensResponse<Asset>> => {
        const { assetId } = checked("assets.retrieve", options);
        return this.#send(
          "assets.retrieve",
          requestOptions,
          "GET",
          `/assets/${requireId(assetId, "Asset ID")}`,
        );
      },

      /** Updates an asset's editable fields. */
      update: async (
        options: UpdateAssetOptions,
        requestOptions?: RequestOptions,
      ): Promise<CalmLensResponse<Asset>> => {
        const { assetId, ...body } = checked("assets.update", options);
        return this.#send(
          "assets.update",
          requestOptions,
          "PATCH",
          `/assets/${requireId(assetId, "Asset ID")}`,
          { body },
        );
      },

      /**
       * Lists the assets extracted from a website or multimedia document. Await it for one page,
       * or `for await` over it for every child.
       */
      listChildren: (
        options: ListAssetChildrenOptions,
        requestOptions?: RequestOptions,
      ): ListPromise<AssetChildrenPage> =>
        // Untyped callers may leave the options out; the asset ID check then refuses the call.
        this.#paginate(
          "assets.listChildren",
          options ?? ({} as ListAssetChildrenOptions),
          requestOptions,
          ({ assetId, ...query }) =>
            this.#send(
              "assets.listChildren",
              requestOptions,
              "GET",
              `/assets/${requireId(assetId, "Asset ID")}/children`,
              { query },
            ),
        ),

      /**
       * Lists an audio or video asset's findings timeline, in time order. Await it for one page,
       * or `for await` over it for every segment.
       * `classification.moderation.timeline.segmentCount` says how many segments there are.
       */
      listTimeline: (
        options: ListAssetTimelineOptions,
        requestOptions?: RequestOptions,
      ): ListPromise<AssetTimelinePage> =>
        this.#paginate("assets.listTimeline", options, requestOptions, ({ assetId, ...query }) => {
          const assetPath = `${this.#projectPath}/assets/${requireId(assetId, "Asset ID")}`;
          return this.#send("assets.listTimeline", requestOptions, "GET", `${assetPath}/timeline`, {
            query,
          });
        }),

      /**
       * Uploads an asset and returns without waiting for its decision (`wait=false`), with
       * `classification.status` `queued`. Retried safely with an `Idempotency-Key`.
       */
      create: async (
        options: SubmitAssetOptions,
        requestOptions?: RequestOptions,
      ): Promise<CalmLensResponse<Asset>> =>
        this.#submitAsset(
          "assets.create",
          checked("assets.create", options),
          false,
          requestOptions,
        ),

      /**
       * Uploads an asset and waits for its moderation decision. Documents, websites, audio, video
       * and files over 20 MiB sent in parts still finish in the background and return `pending`.
       * Retried safely with an `Idempotency-Key`.
       */
      classify: async (
        options: SubmitAssetOptions,
        requestOptions?: RequestOptions,
      ): Promise<CalmLensResponse<Asset>> =>
        this.#submitAsset(
          "assets.classify",
          checkedTextContent(checked("assets.classify", options)),
          true,
          requestOptions,
        ),

      /**
       * Uploads the next part of a multipart upload. Whether the final part waits for the
       * decision was chosen when the upload started; pass `wait` to override it.
       */
      uploadPart: async (
        partOptions: UploadAssetPartOptions,
        requestOptions?: RequestOptions,
      ): Promise<CalmLensResponse<Asset>> => {
        const { assetId, ...options } = checked("assets.uploadPart", partOptions);
        const encodedAssetId = requireId(assetId, "Asset ID");
        const connection = this.#connection.forCall("assets.uploadPart", requestOptions);
        return expectAsset(await connection.uploadPart(`/assets/${encodedAssetId}/part`, options));
      },

      /** Moves an asset into a folder, or to the project root with `folderId: null`. */
      move: async (
        options: MoveAssetOptions,
        requestOptions?: RequestOptions,
      ): Promise<CalmLensResponse<Asset>> => {
        const { assetId, folderId } = checked("assets.move", options);
        return this.#send(
          "assets.move",
          requestOptions,
          "POST",
          `/assets/${requireId(assetId, "Asset ID")}/move`,
          {
            body: { folderId },
          },
        );
      },

      /**
       * Processes an asset that failed (classification status `failed`) again. It returns to
       * `processing` and is
       * moderated like a new upload; its content must still be stored.
       */
      retry: async (
        options: RetryAssetOptions,
        requestOptions?: RequestOptions,
      ): Promise<CalmLensResponse<Asset>> => {
        const { assetId } = checked("assets.retry", options);
        return this.#send(
          "assets.retry",
          requestOptions,
          "POST",
          `/assets/${requireId(assetId, "Asset ID")}/retry`,
        );
      },

      /**
       * Records a reviewer's decision, replacing the policy's: the asset's moderation status
       * becomes `decision`, the note joins its review history and the matching `asset.<status>`
       * event is sent. An asset still pending moderation can only be blocked or purged. Purging
       * needs `confirmPurge: true` and permanently deletes the stored content.
       */
      decide: async (
        options: DecideAssetOptions,
        requestOptions?: RequestOptions,
      ): Promise<CalmLensResponse<Asset>> => {
        const { assetId, ...body } = checked("assets.decide", options);
        return this.#send(
          "assets.decide",
          requestOptions,
          "POST",
          `/assets/${requireId(assetId, "Asset ID")}/decision`,
          { body },
        );
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
      explain: async (
        options: ExplainAssetOptions,
        requestOptions?: RequestOptions,
      ): Promise<CalmLensResponse<Asset>> => {
        const { assetId, rerun } = checked("assets.explain", options);
        return this.#send(
          "assets.explain",
          requestOptions,
          "POST",
          `/assets/${requireId(assetId, "Asset ID")}/explain`,
          {
            body: rerun ? { rerun } : {},
          },
        );
      },

      /**
       * Waits until an asset is settled, its `classification.status` `completed` (with its
       * decision in `classification.moderation.decision`) or `failed`, and returns that asset,
       * checking every few seconds. A `queued` or `processing` asset is still waiting, even when a
       * reviewer has already decided it. Rejects with `sdk/timeout` if it is not settled within
       * `timeoutMs` (default 60000). Webhooks report decisions without polling.
       */
      waitForDecision: async (
        waitOptions: WaitForAssetDecisionOptions,
        requestOptions?: RequestOptions,
      ): Promise<CalmLensResponse<Asset>> => {
        const { assetId, ...options } = checked("assets.waitForDecision", waitOptions);
        requireId(assetId, "Asset ID");
        validateCallOptions(requestOptions);
        const signals = [options.signal, requestOptions?.signal].filter(
          (signal): signal is AbortSignal => signal !== undefined,
        );
        const signal = signals.length > 1 ? anySignal(signals) : signals[0];
        // Each check is an assets.retrieve with these request options.
        const checkOptions = { ...requestOptions, ...(signal && { signal }) };
        return pollForDecision<CalmLensResponse<Asset>>(
          () =>
            this.#send(
              "assets.waitForDecision",
              checkOptions,
              "GET",
              `/assets/${requireId(assetId, "Asset ID")}`,
            ),
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
        requestOptions?: RequestOptions,
      ): Promise<CalmLensResponse<Asset>> => {
        const { assetId } = checked("assets.removeContent", options);
        return this.#send(
          "assets.removeContent",
          requestOptions,
          "DELETE",
          `/assets/${requireId(assetId, "Asset ID")}/content`,
        );
      },

      /**
       * Deletes an asset record together with its stored content. An asset extracted from another
       * (one with a `parentId`) fails with `asset/child-not-deletable`: delete its parent instead.
       */
      delete: async (
        options: DeleteAssetOptions,
        requestOptions?: RequestOptions,
      ): Promise<void> => {
        const { assetId } = checked("assets.delete", options);
        await this.#send(
          "assets.delete",
          requestOptions,
          "DELETE",
          `/assets/${requireId(assetId, "Asset ID")}`,
        );
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
        requestOptions?: RequestOptions,
      ): Promise<CalmLensResponse<BatchAssetsResponse>> => {
        const { assetIds, operation } = checked("assets.batch", options);
        validateBatchAssetsOptions({ assetIds, operation });
        return this.#send(
          "assets.batch",
          requestOptions,
          "POST",
          `${this.#projectPath}/assets/batch`,
          {
            body: { assetIds, operation },
          },
        );
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
      list: (
        options: ListEventsOptions = {},
        requestOptions?: RequestOptions,
      ): ListPromise<GetEventsResponse> =>
        this.#paginate("events.list", options, requestOptions, ({ types, ...query }) =>
          this.#send("events.list", requestOptions, "GET", `${this.#projectPath}/events`, {
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
      list: (
        options: ListFoldersOptions = {},
        requestOptions?: RequestOptions,
      ): ListPromise<FolderPage> =>
        this.#paginate("folders.list", options, requestOptions, (query) =>
          this.#send("folders.list", requestOptions, "GET", `${this.#projectPath}/folders`, {
            query,
          }),
        ),

      retrieve: async (
        options: FolderIdOptions,
        requestOptions?: RequestOptions,
      ): Promise<CalmLensResponse<Folder>> => {
        const { folderId } = checked("folders.retrieve", options);
        return this.#send(
          "folders.retrieve",
          requestOptions,
          "GET",
          `/folders/${requireId(folderId, "Folder ID")}`,
        );
      },

      /** Creates a folder at the project root or inside `parentId`. */
      create: async (
        options: CreateFolderOptions,
        requestOptions?: RequestOptions,
      ): Promise<CalmLensResponse<Folder>> =>
        this.#send("folders.create", requestOptions, "POST", `${this.#projectPath}/folders`, {
          body: checked("folders.create", options),
        }),

      update: async (
        options: UpdateFolderOptions,
        requestOptions?: RequestOptions,
      ): Promise<CalmLensResponse<Folder>> => {
        const { folderId, ...body } = checked("folders.update", options);
        return this.#send(
          "folders.update",
          requestOptions,
          "PATCH",
          `/folders/${requireId(folderId, "Folder ID")}`,
          { body },
        );
      },

      /** Deletes an empty folder; throws `folder/not-empty` otherwise. */
      delete: async (options: FolderIdOptions, requestOptions?: RequestOptions): Promise<void> => {
        const { folderId } = checked("folders.delete", options);
        await this.#send(
          "folders.delete",
          requestOptions,
          "DELETE",
          `/folders/${requireId(folderId, "Folder ID")}`,
        );
      },

      /** Moves a folder under `parentId`, or to the project root with `parentId: null`. */
      move: async (
        options: MoveFolderOptions,
        requestOptions?: RequestOptions,
      ): Promise<CalmLensResponse<Folder>> => {
        const { folderId, parentId } = checked("folders.move", options);
        return this.#send(
          "folders.move",
          requestOptions,
          "POST",
          `/folders/${requireId(folderId, "Folder ID")}/move`,
          {
            body: { parentId },
          },
        );
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
      list: (
        options: ListHashListsOptions = {},
        requestOptions?: RequestOptions,
      ): ListPromise<HashListPage> =>
        this.#paginate("hashLists.list", options, requestOptions, (query) =>
          this.#send("hashLists.list", requestOptions, "GET", `${this.#projectPath}/hash-lists`, {
            query,
          }),
        ),

      retrieve: async (
        options: HashListIdOptions,
        requestOptions?: RequestOptions,
      ): Promise<CalmLensResponse<HashList>> => {
        const { hashListId } = checked("hashLists.retrieve", options);
        return this.#send(
          "hashLists.retrieve",
          requestOptions,
          "GET",
          `/hash-lists/${requireId(hashListId, "Hash list ID")}`,
        );
      },

      create: async (
        options: CreateHashListOptions,
        requestOptions?: RequestOptions,
      ): Promise<CalmLensResponse<HashList>> =>
        this.#send("hashLists.create", requestOptions, "POST", `${this.#projectPath}/hash-lists`, {
          body: checked("hashLists.create", options),
        }),

      /** Renames a list or changes its action; the new action applies to later uploads. */
      update: async (
        options: UpdateHashListOptions,
        requestOptions?: RequestOptions,
      ): Promise<CalmLensResponse<HashList>> => {
        const { hashListId, ...body } = checked("hashLists.update", options);
        return this.#send(
          "hashLists.update",
          requestOptions,
          "PATCH",
          `/hash-lists/${requireId(hashListId, "Hash list ID")}`,
          {
            body,
          },
        );
      },

      /** Deletes the list and every entry in it. */
      delete: async (
        options: HashListIdOptions,
        requestOptions?: RequestOptions,
      ): Promise<void> => {
        const { hashListId } = checked("hashLists.delete", options);
        await this.#send(
          "hashLists.delete",
          requestOptions,
          "DELETE",
          `/hash-lists/${requireId(hashListId, "Hash list ID")}`,
        );
      },

      /** Lists a list's entries, newest first unless `sort` says otherwise. */
      listEntries: (
        options: ListHashListEntriesOptions,
        requestOptions?: RequestOptions,
      ): ListPromise<HashListEntryPage> =>
        this.#paginate(
          "hashLists.listEntries",
          options,
          requestOptions,
          ({ hashListId, ...query }) =>
            this.#send(
              "hashLists.listEntries",
              requestOptions,
              "GET",
              `/hash-lists/${requireId(hashListId, "Hash list ID")}/entries`,
              {
                query,
              },
            ),
        ),

      /** Adds a hash, or an image asset's hash; a hash already in the list returns its entry. */
      addEntry: async (
        options: AddHashListEntryOptions,
        requestOptions?: RequestOptions,
      ): Promise<CalmLensResponse<HashListEntry>> => {
        const { hashListId, ...body } = checked("hashLists.addEntry", options);
        return this.#send(
          "hashLists.addEntry",
          requestOptions,
          "POST",
          `/hash-lists/${requireId(hashListId, "Hash list ID")}/entries`,
          { body },
        );
      },

      removeEntry: async (
        options: HashListEntryIdOptions,
        requestOptions?: RequestOptions,
      ): Promise<void> => {
        const { entryId } = checked("hashLists.removeEntry", options);
        await this.#send(
          "hashLists.removeEntry",
          requestOptions,
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
      list: (
        options: ListPoliciesOptions = {},
        requestOptions?: RequestOptions,
      ): ListPromise<PolicyPage> =>
        this.#paginate("policies.list", options, requestOptions, (query) =>
          this.#send("policies.list", requestOptions, "GET", "/policies", { query }),
        ),

      retrieve: async (
        options: PolicyIdOptions,
        requestOptions?: RequestOptions,
      ): Promise<CalmLensResponse<Policy>> =>
        this.#send(
          "policies.retrieve",
          requestOptions,
          "GET",
          policyPath(checked("policies.retrieve", options).policyId),
        ),

      /** Creates a policy from `settings`, or a copy of a built-in preset with `presetId`. */
      create: async (
        options: CreatePolicyOptions,
        requestOptions?: RequestOptions,
      ): Promise<CalmLensResponse<Policy>> =>
        this.#send("policies.create", requestOptions, "POST", "/policies", {
          body: checked("policies.create", options),
        }),

      /** Changes the name, description or settings; later moderation uses them. */
      update: async (
        options: UpdatePolicyOptions,
        requestOptions?: RequestOptions,
      ): Promise<CalmLensResponse<Policy>> => {
        const { policyId, ...body } = checked("policies.update", options);
        return this.#send("policies.update", requestOptions, "PATCH", policyPath(policyId), {
          body,
        });
      },

      /** Restores the settings of the preset release a `pinned` or `copy` policy is pinned to. */
      reset: async (
        options: ResetPolicyOptions,
        requestOptions?: RequestOptions,
      ): Promise<CalmLensResponse<Policy>> => {
        const { policyId, ...body } = checked("policies.reset", options);
        return this.#send(
          "policies.reset",
          requestOptions,
          "POST",
          `${policyPath(policyId)}/reset`,
          { body },
        );
      },

      /** Moves an unchanged `pinned` or `copy` policy to the latest release of its preset. */
      upgrade: async (
        options: UpgradePolicyOptions,
        requestOptions?: RequestOptions,
      ): Promise<CalmLensResponse<Policy>> => {
        const { policyId, ...body } = checked("policies.upgrade", options);
        return this.#send(
          "policies.upgrade",
          requestOptions,
          "POST",
          `${policyPath(policyId)}/upgrade`,
          { body },
        );
      },

      /** Switches automatic updates on (`live`) or off (`pinned`) for the organisation's own preset policy. */
      setAutomaticUpdates: async (
        options: SetPolicyAutomaticUpdatesOptions,
        requestOptions?: RequestOptions,
      ): Promise<CalmLensResponse<Policy>> => {
        const { policyId, ...body } = checked("policies.setAutomaticUpdates", options);
        return this.#send(
          "policies.setAutomaticUpdates",
          requestOptions,
          "PUT",
          `${policyPath(policyId)}/automatic-updates`,
          { body },
        );
      },

      /** Deletes a policy that no project or upload preset uses. */
      delete: async (options: PolicyIdOptions, requestOptions?: RequestOptions): Promise<void> => {
        await this.#send(
          "policies.delete",
          requestOptions,
          "DELETE",
          policyPath(checked("policies.delete", options).policyId),
        );
      },

      /** The policy the project moderates with. */
      retrieveAssigned: async (
        requestOptions?: RequestOptions,
      ): Promise<CalmLensResponse<Policy>> =>
        this.#send(
          "policies.retrieveAssigned",
          requestOptions,
          "GET",
          `${this.#projectPath}/policy`,
        ),

      /** Chooses the policy the project moderates with. */
      assign: async (
        options: AssignPolicyOptions,
        requestOptions?: RequestOptions,
      ): Promise<CalmLensResponse<Policy>> =>
        this.#send("policies.assign", requestOptions, "PUT", `${this.#projectPath}/policy`, {
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
      list: (
        options: ListUploadPresetsOptions = {},
        requestOptions?: RequestOptions,
      ): ListPromise<UploadPresetPage> =>
        this.#paginate("uploadPresets.list", options, requestOptions, (query) =>
          this.#send(
            "uploadPresets.list",
            requestOptions,
            "GET",
            `${this.#projectPath}/upload-presets`,
            { query },
          ),
        ),

      /**
       * Creates each preset, or replaces it with the definition sent, by key. Every preset is
       * checked before any is saved. Returns the stored presets in the order sent.
       */
      ensure: async (
        options: EnsureUploadPresetsOptions,
        requestOptions?: RequestOptions,
      ): Promise<CalmLensResponse<EnsureUploadPresetsResponse>> =>
        this.#send(
          "uploadPresets.ensure",
          requestOptions,
          "PUT",
          `${this.#projectPath}/upload-presets`,
          {
            body: checked("uploadPresets.ensure", options),
          },
        ),

      /** Deletes an upload preset; assets already uploaded through it stay. */
      delete: async (
        options: UploadPresetIdOptions,
        requestOptions?: RequestOptions,
      ): Promise<void> => {
        const { uploadPresetId } = checked("uploadPresets.delete", options);
        await this.#send(
          "uploadPresets.delete",
          requestOptions,
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
      get: async (
        requestOptions?: RequestOptions,
      ): Promise<CalmLensResponse<ProjectSettingsResource>> =>
        this.#send("projectSettings.get", requestOptions, "GET", `${this.#projectPath}/settings`),

      update: async (
        options: UpdateProjectSettingsOptions,
        requestOptions?: RequestOptions,
      ): Promise<CalmLensResponse<ProjectSettingsResource>> =>
        this.#send(
          "projectSettings.update",
          requestOptions,
          "PUT",
          `${this.#projectPath}/settings`,
          {
            body: checked("projectSettings.update", options),
          },
        ),
    };
  }

  /**
   * The project's metadata fields. They share the project settings' `revision`; `ensure` creates
   * or replaces fields by ID and keeps the others.
   */
  get metadataFields() {
    return {
      list: async (
        requestOptions?: RequestOptions,
      ): Promise<CalmLensResponse<MetadataFieldsResource>> =>
        this.#send(
          "metadataFields.list",
          requestOptions,
          "GET",
          `${this.#projectPath}/metadata-fields`,
        ),

      ensure: async (
        options: EnsureMetadataFieldsOptions,
        requestOptions?: RequestOptions,
      ): Promise<CalmLensResponse<MetadataFieldsResource>> =>
        this.#send(
          "metadataFields.ensure",
          requestOptions,
          "PUT",
          `${this.#projectPath}/metadata-fields`,
          {
            body: checked("metadataFields.ensure", options),
          },
        ),

      /** Deletes a field definition; assets keep their values. */
      delete: async (
        options: DeleteMetadataFieldOptions,
        requestOptions?: RequestOptions,
      ): Promise<void> => {
        const { fieldId, ...query } = checked("metadataFields.delete", options);
        await this.#send(
          "metadataFields.delete",
          requestOptions,
          "DELETE",
          `${this.#projectPath}/metadata-fields/${requireId(fieldId, "Metadata field ID")}`,
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
      list: (
        options: ListLensesOptions = {},
        requestOptions?: RequestOptions,
      ): ListPromise<LensPage> =>
        this.#paginate("lenses.list", options, requestOptions, (query) =>
          this.#send("lenses.list", requestOptions, "GET", `${this.#projectPath}/lenses`, {
            query,
          }),
        ),

      /** Creates a lens; its identifier must be new to the project. */
      create: async (
        options: CreateLensOptions,
        requestOptions?: RequestOptions,
      ): Promise<CalmLensResponse<Lens>> => {
        const lens = await this.#send<Lens>(
          "lenses.create",
          requestOptions,
          "POST",
          `${this.#projectPath}/lenses`,
          {
            body: checked("lenses.create", options),
          },
        );
        forget((cached) => cached.identifier === lens.identifier);
        return lens;
      },

      retrieve: async (
        options: LensIdOptions,
        requestOptions?: RequestOptions,
      ): Promise<CalmLensResponse<Lens>> =>
        this.#send(
          "lenses.retrieve",
          requestOptions,
          "GET",
          lensPath(checked("lenses.retrieve", options).lensId),
        ),

      /** Changes a lens's name, description, type, transform or whether the CDN serves it. */
      update: async (
        options: UpdateLensOptions,
        requestOptions?: RequestOptions,
      ): Promise<CalmLensResponse<Lens>> => {
        const { lensId, ...body } = checked("lenses.update", options);
        const lens = await this.#send<Lens>(
          "lenses.update",
          requestOptions,
          "PATCH",
          lensPath(lensId),
          { body },
        );
        forget((cached) => cached.id === lens.id);
        return lens;
      },

      /** Deletes a lens; URLs that select it stop being served. */
      delete: async (options: LensIdOptions, requestOptions?: RequestOptions): Promise<void> => {
        const { lensId } = checked("lenses.delete", options);
        await this.#send("lenses.delete", requestOptions, "DELETE", lensPath(lensId));
        forget((cached) => cached.id === lensId);
      },
    };
  }

  /**
   * Creates a named lens, or changes it to this definition. Sending the same definition again
   * returns the lens unchanged, from the client's lens cache once it has seen it.
   */
  async ensureLens(options: EnsureLensOptions, requestOptions?: RequestOptions): Promise<Lens> {
    checked("ensureLens", options);
    if (!options?.identifier) throw invalidArgument("Lens identifier is required");
    const [lens] = await this.ensureLenses({ lenses: [options] }, requestOptions);
    return lens!;
  }

  /**
   * Create or update several named lenses. New definitions are sent in one API request, or in
   * consecutive requests of at most {@link ENSURE_LENSES_MAX_PER_REQUEST} definitions, in order.
   * Each lens is created or changed as ensureLens() does.
   */
  async ensureLenses(
    options: EnsureLensesOptions,
    requestOptions?: RequestOptions,
  ): Promise<Lens[]> {
    validateCallOptions(requestOptions);
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
        // A call that joins one already sending shares its request, and its request options.
        pending = this.#submitEnsureLenses(missingOptions, requestOptions);
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

  async #submitEnsureLenses(
    options: EnsureLensOptions[],
    requestOptions: RequestOptions | undefined,
  ): Promise<void> {
    // Chunks are sent in order; each chunk is cached before the next is sent.
    for (let start = 0; start < options.length; start += ENSURE_LENSES_MAX_PER_REQUEST) {
      await this.#submitEnsureLensesChunk(
        options.slice(start, start + ENSURE_LENSES_MAX_PER_REQUEST),
        requestOptions,
      );
    }
  }

  async #submitEnsureLensesChunk(
    options: EnsureLensOptions[],
    requestOptions: RequestOptions | undefined,
  ): Promise<void> {
    const result = await this.#send<{ lenses?: Lens[] }>(
      "ensureLenses",
      requestOptions,
      "PUT",
      `${this.#projectPath}/lenses`,
      { body: { lenses: options } },
    );
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
