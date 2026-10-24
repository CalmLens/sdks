import { CalmLensError, invalidArgument, invalidConfig } from "../client/CalmLensError";
import {
  API_ERROR_CODES,
  API_ERROR_DEFINITIONS,
  type ApiErrorCode,
} from "../client/CalmLensErrorCodes";
import type {
  Asset,
  CalmLensAppClientOptions,
  RetrieveAssetOptions,
  UploadAssetPartOptions,
  UploadedAsset,
  UploadPresetSubmitAssetOptions,
} from "../client/CalmLensTypes";
import { encodePathSegment, validateAppClientOptions } from "../client/CalmLensUtils";
import { getAssetPayloadByteLength } from "../contract/AssetPayload.js";
import { isFileAccepted } from "../ui/UploadController";
import { createMockApiKey } from "./MockApiKey";
import { type MockAssetOutcome, MockCalmLensServerClient } from "./MockCalmLensServerClient";

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

export interface MockCalmLensAppClientOptions extends CalmLensAppClientOptions {
  mockOptions?: {
    /**
     * The mock project the uploads go into. Pass the `MockCalmLensServerClient` your server code
     * uses to see the uploads there and serve them from its CDN. Without one, the client creates
     * its own, available as `server`.
     */
    server?: MockCalmLensServerClient;
    preset?: MockUploadPreset;
    /** Where uploads end up when the client creates its own server. Defaults to `pending`. */
    queuedOutcome?: MockAssetOutcome | ((asset: Asset) => MockAssetOutcome);
    /** Where `assets.classify` uploads end up when the client creates its own server. */
    analyzedOutcome?: MockAssetOutcome | ((asset: Asset) => MockAssetOutcome);
  };
}

const MOCK_PROJECT_ID = "00000000-0000-4000-8000-00000000c1a5";

/**
 * An in-memory stand-in for `CalmLensAppClient` with the same methods and error codes. It applies
 * the upload preset settings in `mockOptions.preset` and stores uploads in a
 * `MockCalmLensServerClient`, so tests can check them from the server side too.
 */
export class MockCalmLensAppClient {
  /** The mock project the uploads are stored in. */
  readonly server: MockCalmLensServerClient;
  readonly #uploadPresetId: string;
  readonly #token: CalmLensAppClientOptions["token"];
  readonly #preset: MockUploadPreset;
  /** Uploads this client made, which are the only ones it can check. */
  readonly #uploads = new Set<string>();
  #requestCount = 0;

  constructor(options: MockCalmLensAppClientOptions) {
    validateAppClientOptions(options);
    this.#uploadPresetId = options.uploadPresetId;
    this.#token = options.token;
    this.#preset = options.mockOptions?.preset ?? {};
    this.server =
      options.mockOptions?.server ??
      new MockCalmLensServerClient({
        apiKey: createMockApiKey([
          {
            actions: ["assets:create", "assets:read", "assets:update"],
            folderId: null,
            includeSubfolders: true,
          },
        ]),
        projectId: MOCK_PROJECT_ID,
        mockOptions: {
          queuedOutcome: options.mockOptions?.queuedOutcome,
          analyzedOutcome: options.mockOptions?.analyzedOutcome,
        },
      });
  }

  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return `MockCalmLensAppClient { uploadPresetId: ${JSON.stringify(this.#uploadPresetId)} }`;
  }

  toJSON(): { uploadPresetId: string } {
    return { uploadPresetId: this.#uploadPresetId };
  }

  #apiError(code: ApiErrorCode): CalmLensError {
    const requestId = `mock-app-request-${++this.#requestCount}`;
    return new CalmLensError(code, {
      message: API_ERROR_DEFINITIONS[code].message,
      status: API_ERROR_DEFINITIONS[code].status,
      requestId,
      headers: new Headers({ "content-type": "application/json", "x-request-id": requestId }),
    });
  }

  #toUploaded(asset: Asset): UploadedAsset {
    return {
      id: asset.id,
      name: asset.name,
      uploadPresetId: this.#uploadPresetId,
      createdAt: asset.createdAt,
      ...(this.#preset.showDecisions !== false && {
        status: asset.classification.moderation.status,
      }),
    };
  }

  async #submit(options: UploadPresetSubmitAssetOptions, queue: boolean): Promise<UploadedAsset> {
    if (!options || typeof options !== "object") {
      throw invalidArgument("Upload options are required");
    }
    if (!("content" in options) && !("part" in options)) {
      throw invalidArgument("Uploads through an upload preset need content or a part");
    }
    const token = typeof this.#token === "function" ? await this.#token() : this.#token;
    if (token !== undefined && (typeof token !== "string" || !token)) {
      throw invalidConfig("token must return a non-empty string");
    }
    const preset = this.#preset;
    if (preset.requireToken && !token)
      throw this.#apiError(API_ERROR_CODES.UPLOAD_PRESET_TOKEN_REQUIRED);
    const payload = "content" in options ? options.content : options.part;
    const type = payload.type ?? "";
    if (
      preset.allowedContentTypes &&
      !isFileAccepted({ name: options.name, type }, preset.allowedContentTypes.join(","))
    ) {
      throw this.#apiError(API_ERROR_CODES.UPLOAD_PRESET_CONTENT_TYPE_NOT_ALLOWED);
    }
    const size =
      "totalSizeInBytes" in options && options.totalSizeInBytes !== undefined
        ? options.totalSizeInBytes
        : (payload.sizeInBytes ?? getAssetPayloadByteLength(payload));
    if (
      preset.maxFileSizeInBytes !== undefined &&
      size !== undefined &&
      size > preset.maxFileSizeInBytes
    ) {
      throw this.#apiError(API_ERROR_CODES.UPLOAD_PRESET_TOO_LARGE);
    }
    const shared = {
      visibility: preset.visibility ?? "public",
      folderId: preset.folderId ?? undefined,
      processingOptions: { keepContentAfterProcessing: preset.keepContentAfterProcessing ?? true },
    };
    const asset = await (queue ? this.server.assets.create : this.server.assets.classify)({
      ...options,
      ...shared,
    });
    this.#uploads.add(asset.id);
    return this.#toUploaded(asset);
  }

  #ownAssetId(assetId: string): string {
    encodePathSegment(assetId, "Asset ID");
    if (!this.#uploads.has(assetId)) throw this.#apiError(API_ERROR_CODES.ASSET_NOT_FOUND);
    return assetId;
  }

  /** Uploads through the client's upload preset and checks those uploads. */
  get assets() {
    return {
      /** Uploads a file and queues it for moderation. */
      create: (options: UploadPresetSubmitAssetOptions): Promise<UploadedAsset> =>
        this.#submit(options, true),

      /** Uploads a file and waits for its moderation decision. */
      classify: (options: UploadPresetSubmitAssetOptions): Promise<UploadedAsset> =>
        this.#submit(options, false),

      /** Uploads the next part of a multipart upload this client started. */
      uploadPart: async (options: UploadAssetPartOptions): Promise<UploadedAsset> =>
        this.#toUploaded(
          await this.server.assets.uploadPart({
            ...options,
            assetId: this.#ownAssetId(options.assetId),
          }),
        ),

      /** Checks an upload this client made. `status` is present when the preset shows decisions. */
      retrieve: async ({ assetId }: RetrieveAssetOptions): Promise<UploadedAsset> =>
        this.#toUploaded(await this.server.assets.retrieve({ assetId: this.#ownAssetId(assetId) })),
    };
  }
}
