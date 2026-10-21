import {
  CalmLensConnection,
  expectUploadedAsset,
  prepareSubmitAssetOptions,
  resolveConnectionOptions,
} from "./CalmLensConnection";
import { invalidArgument, invalidConfig } from "./CalmLensError";
import type {
  CalmLensAppClientOptions,
  RetrieveAssetOptions,
  UploadAssetPartOptions,
  UploadedAsset,
  UploadPresetSubmitAssetOptions,
} from "./CalmLensTypes";
import { encodePathSegment, validateAppClientOptions } from "./CalmLensUtils";

const inspectSymbol = Symbol.for("nodejs.util.inspect.custom");

/**
 * The CalmLens client for browsers and React Native apps. It uploads through an upload preset,
 * with an upload token from your server when the preset requires one, and never holds an API
 * key. It can upload (`assets.create`, `assets.classify`, `assets.uploadPart`) and check its own
 * uploads (`assets.retrieve`). Every method throws `CalmLensError` on failure.
 */
export default class CalmLensAppClient {
  readonly #uploadPresetId: string;
  readonly #token: CalmLensAppClientOptions["token"];
  /** The token each upload started with, for its parts and status checks. */
  readonly #uploadTokens = new Map<string, string>();
  readonly #connection: CalmLensConnection;

  constructor(options: CalmLensAppClientOptions) {
    validateAppClientOptions(options);
    const { token, uploadPresetId, ...rest } = options;
    this.#uploadPresetId = uploadPresetId;
    this.#token = token;
    this.#connection = new CalmLensConnection(resolveConnectionOptions(rest));
  }

  /** Keeps tokens out of `console.log`, `util.inspect` and `JSON.stringify`. */
  [inspectSymbol](): string {
    return `CalmLensAppClient { uploadPresetId: ${JSON.stringify(this.#uploadPresetId)}, baseUrl: ${JSON.stringify(this.#connection.options.baseUrl)} }`;
  }

  toJSON(): { uploadPresetId: string; baseUrl: string } {
    return { uploadPresetId: this.#uploadPresetId, baseUrl: this.#connection.options.baseUrl };
  }

  private get uploadsPath(): string {
    return `/upload-presets/${encodeURIComponent(this.#uploadPresetId)}/assets`;
  }

  /** A fresh token for a new upload, when the client has one. */
  private async newUploadToken(): Promise<string | undefined> {
    const token = typeof this.#token === "function" ? await this.#token() : this.#token;
    if (token !== undefined && (typeof token !== "string" || !token)) {
      throw invalidConfig("token must return a non-empty string");
    }
    return token;
  }

  /** The `Authorization` header for an upload this client started. */
  private authHeaders(assetId: string): Record<string, string> {
    const token = this.#uploadTokens.get(assetId);
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  /** Uploads with a new token, kept for the upload's parts and status checks. */
  private async submit(
    options: UploadPresetSubmitAssetOptions,
    queue: boolean,
  ): Promise<UploadedAsset> {
    if (!options || typeof options !== "object") {
      throw invalidArgument("Upload options are required");
    }
    if (!("content" in options) && !("part" in options)) {
      throw invalidArgument("Uploads through an upload preset need content or a part");
    }
    prepareSubmitAssetOptions(options);
    const token = await this.newUploadToken();
    const data = await this.#connection.submitRawUpload(
      this.uploadsPath,
      options,
      queue,
      token ? { Authorization: `Bearer ${token}` } : {},
    );
    const uploaded = expectUploadedAsset(data);
    if (token) this.#uploadTokens.set(uploaded.id, token);
    return uploaded;
  }

  /** Uploads through the client's upload preset and checks those uploads. */
  get assets() {
    return {
      /** Uploads a file and queues it for moderation. */
      create: (options: UploadPresetSubmitAssetOptions): Promise<UploadedAsset> =>
        this.submit(options, true),

      /** Uploads a file and waits for its moderation decision. */
      classify: (options: UploadPresetSubmitAssetOptions): Promise<UploadedAsset> =>
        this.submit(options, false),

      /**
       * Uploads the next part of a multipart upload this client started. The upload's queue
       * mode, chosen when it started, applies when the final part arrives.
       */
      uploadPart: async ({
        assetId,
        ...options
      }: UploadAssetPartOptions): Promise<UploadedAsset> => {
        const encodedAssetId = encodePathSegment(assetId, "Asset ID");
        const data = await this.#connection.uploadPart(
          `${this.uploadsPath}/${encodedAssetId}/part`,
          options,
          this.authHeaders(assetId),
        );
        return expectUploadedAsset(data);
      },

      /** Checks an upload this client made. `status` is present when the preset shows decisions. */
      retrieve: async ({ assetId }: RetrieveAssetOptions): Promise<UploadedAsset> => {
        const encodedAssetId = encodePathSegment(assetId, "Asset ID");
        const data = await this.#connection.json<unknown>(
          "GET",
          `${this.uploadsPath}/${encodedAssetId}`,
          { headers: this.authHeaders(assetId) },
        );
        return expectUploadedAsset(data);
      },
    };
  }
}
