import CalmLensAppClient from "../client/CalmLensAppClient";
import type { Asset, CalmLensAppClientOptions } from "../client/CalmLensTypes";
import { validateAppClientOptions } from "../client/CalmLensUtils";
import { createMockApiKey } from "./MockApiKey";
import type { MockAssetOutcome, MockEndpoints, MockUploadPreset } from "./MockCalmLensApi";
import {
  getMockApi,
  MockCalmLensServerClient,
  mockClientOptions,
} from "./MockCalmLensServerClient";

export type { MockUploadPreset } from "./MockCalmLensApi";

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

const MOCK_PROJECT_ID = "proj_0000000000000000c1a5";

/**
 * The real `CalmLensAppClient`, answered by the in-memory API of a `MockCalmLensServerClient`.
 * The API applies `mockOptions.preset` to this client's uploads like CalmLens applies an upload
 * preset: its token, content type and size rules with the API's error codes, and its visibility,
 * folder, content retention and decision display. The client can check and continue only the
 * uploads it made.
 */
export class MockCalmLensAppClient extends CalmLensAppClient {
  /** The mock project the uploads are stored in. */
  readonly server: MockCalmLensServerClient;
  readonly #uploadPresetId: string;

  constructor(options: MockCalmLensAppClientOptions) {
    validateAppClientOptions(options);
    const { mockOptions = {}, ...clientOptions } = options;
    const server =
      mockOptions.server ??
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
          queuedOutcome: mockOptions.queuedOutcome,
          analyzedOutcome: mockOptions.analyzedOutcome,
        },
      });
    let endpoints: MockEndpoints | undefined;
    const { cdnFetch: _cdnFetch, ...requestOptions } = mockClientOptions(
      getMockApi(server),
      () => endpoints!,
      { preset: mockOptions.preset ?? {}, uploads: new Set() },
    );
    super({ maxRetries: 0, ...clientOptions, ...requestOptions } as CalmLensAppClientOptions);
    endpoints = { baseUrl: this.toJSON().baseUrl, cdnBaseUrl: server.toJSON().cdnBaseUrl };
    this.server = server;
    this.#uploadPresetId = options.uploadPresetId;
  }

  /** Keeps tokens out of `console.log` and `util.inspect`. */
  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return `MockCalmLensAppClient { uploadPresetId: ${JSON.stringify(this.#uploadPresetId)} }`;
  }
}
