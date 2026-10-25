import { MOCK_HOOKS, type MockHooks } from "../client/CalmLensConnection";
import { invalidConfig } from "../client/CalmLensError";
import CalmLensServerClient from "../client/CalmLensServerClient";
import { sleep } from "../client/CalmLensTransport";
import type { Asset, CalmLensServerClientOptions } from "../client/CalmLensTypes";
import { validateServerClientOptions } from "../client/CalmLensUtils";
import type { TypedEvent } from "../contract/Event.js";
import type { PermissionGrant } from "../contract/Permissions.js";
import { createMockApiKey, getMockApiKeyGrants } from "./MockApiKey";
import {
  createMonotonicClock,
  type MockAppSession,
  type MockAssetOutcome,
  MockCalmLensApi,
  type MockCalmLensCall,
  type MockCalmLensOperation,
  type MockEndpoints,
  type MockEventInput,
  type MockRequestFailure,
  type MockReviewDecision,
} from "./MockCalmLensApi";
import {
  InMemoryMockDatabaseStorage,
  InMemoryMockImageStorage,
  type MockDatabaseStorage,
  type MockImageStorage,
} from "./MockStorage";

export type {
  MockAssetOutcome,
  MockCalmLensCall,
  MockCalmLensOperation,
  MockEventInput,
  MockRequestFailure,
  MockReviewDecision,
} from "./MockCalmLensApi";

export interface MockCalmLensServerClientOptions extends CalmLensServerClientOptions {
  mockOptions?: {
    databaseStorage?: MockDatabaseStorage;
    imageStorage?: MockImageStorage;
    createId?: () => string;
    /**
     * The clock, in epoch milliseconds. The default is the system clock, moved on by at least a
     * millisecond per reading, so assets created in a row have increasing `createdAt` values and
     * orderings by `createdAt` don't depend on IDs.
     */
    now?: () => number;
    /**
     * Outcome of `assets.create` (and queued multipart uploads). Defaults to `pending`. Pass a
     * function to choose per upload, for example from `asset.name`.
     */
    queuedOutcome?: MockAssetOutcome | ((asset: Asset) => MockAssetOutcome);
    /** Outcome of `assets.classify` and `text.classify`. Defaults to `allowed`. */
    analyzedOutcome?: MockAssetOutcome | ((asset: Asset) => MockAssetOutcome);
    signedUrlBaseUrl?: string;
  };
}

const apis = new WeakMap<object, MockCalmLensApi>();

/** The in-memory API a mock server client runs against, for `MockCalmLensAppClient`. */
export const getMockApi = (client: MockCalmLensServerClient): MockCalmLensApi => {
  const api = apis.get(client);
  if (!api) throw invalidConfig("mockOptions.server must be a MockCalmLensServerClient");
  return api;
};

/**
 * Options that make a real client send its requests to `api`: waits only move the mock's clock,
 * multipart size checks are the in-memory API's, and nothing is retried unless the options say so.
 */
export const mockClientOptions = (
  api: MockCalmLensApi,
  endpoints: () => MockEndpoints,
  session?: MockAppSession,
) => {
  const fetch = api.createFetch(endpoints, session);
  const hooks: MockHooks = {
    sleep: async (ms, signal) => {
      // Yield, so other tasks (such as a `decide`) run, then move the clock on instead of waiting.
      await sleep(0, signal);
      api.waitedMs += ms;
    },
    now: () => api.waitedMs,
    uploadTokenTime: () => ({ now: api.now(), nonce: api.createId() }),
    deferUploadChecks: true,
    defaultCdnBaseUrl: "mock://calmlens/v1",
  };
  return { fetch, uploadFetch: fetch, cdnFetch: fetch, [MOCK_HOOKS]: hooks };
};

/**
 * The real `CalmLensServerClient`, answered by an in-memory CalmLens API and CDN instead of the
 * network: every method runs the real client's code, and the in-memory API answers its requests
 * with the API's statuses, bodies, error bodies and headers. Mock helpers decide assets, add
 * events, change the API key's grants, fail requests and list the requests sent.
 */
export class MockCalmLensServerClient extends CalmLensServerClient {
  readonly databaseStorage: MockDatabaseStorage;
  readonly imageStorage: MockImageStorage;
  readonly #api: MockCalmLensApi;
  readonly #projectId: string;

  /**
   * Accepts the same options as `CalmLensServerClient` (validated the same way), plus
   * `mockOptions`. `maxRetries` defaults to 0, so a failed request fails once; retry backoff and
   * `assets.waitForDecision` take no real time.
   */
  constructor(options: MockCalmLensServerClientOptions) {
    validateServerClientOptions(options);
    const { mockOptions = {}, ...clientOptions } = options;
    const api = new MockCalmLensApi({
      projectId: options.projectId,
      apiKey: options.apiKey,
      grants: getMockApiKeyGrants(options.apiKey),
      databaseStorage: mockOptions.databaseStorage ?? new InMemoryMockDatabaseStorage(),
      imageStorage: mockOptions.imageStorage ?? new InMemoryMockImageStorage(),
      createId: mockOptions.createId ?? crypto.randomUUID.bind(crypto),
      now: mockOptions.now ?? createMonotonicClock(),
      queuedOutcome: mockOptions.queuedOutcome ?? "pending",
      analyzedOutcome: mockOptions.analyzedOutcome ?? "allowed",
      signedUrlBaseUrl: mockOptions.signedUrlBaseUrl ?? "mock://calmlens",
    });
    let endpoints: MockEndpoints | undefined;
    super({
      maxRetries: 0,
      ...clientOptions,
      dangerouslyAllowBrowser: true,
      ...mockClientOptions(api, () => endpoints!),
    } as CalmLensServerClientOptions);
    const { baseUrl, cdnBaseUrl } = this.toJSON();
    endpoints = { baseUrl, cdnBaseUrl };
    this.#api = api;
    this.#projectId = options.projectId;
    this.databaseStorage = api.databaseStorage;
    this.imageStorage = api.imageStorage;
    apis.set(this, api);
  }

  /** Keeps the API key out of `console.log` and `util.inspect`. */
  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return `MockCalmLensServerClient { projectId: ${JSON.stringify(this.#projectId)} }`;
  }

  /**
   * Every request sent to the mock's API and CDN, oldest first, by this client and the
   * `MockCalmLensAppClient`s that use it, each with the client method that sent it.
   */
  get calls(): MockCalmLensCall[] {
    return this.#api.calls.map(({ call }) => call);
  }

  /**
   * Requests `operation` sends, oldest first. A request several methods send matches each of
   * them: `callsTo("text.classify")` also lists `assets.classify` text uploads, and
   * `callsTo("assets.waitForDecision")` the `assets.retrieve` requests it polls with.
   */
  callsTo(operation: MockCalmLensOperation): MockCalmLensCall[] {
    return this.#api.calls
      .filter(({ operations }) => operations.includes(operation))
      .map(({ call }) => call);
  }

  /**
   * Makes the next request (or the next one `operation` sends) fail instead of reaching the
   * in-memory API, as if it never completed. Queue several to fail several requests in a row.
   */
  failNextRequest(
    failure: MockRequestFailure = "transport-error",
    { operation }: { operation?: MockCalmLensOperation } = {},
  ): void {
    this.#api.failNextRequest(failure, operation);
  }

  /**
   * Changes the grants of the mock's API key, as editing the key in the portal would: later
   * requests, such as `cdn.serve`, use them. The key itself stays the same, so idempotency keys
   * it used still replay.
   */
  setApiKeyGrants(grants: PermissionGrant[]): void {
    this.#api.grants = getMockApiKeyGrants(createMockApiKey(grants));
  }

  /**
   * Adds an event to the feed `events.list` reads, as if CalmLens had recorded it. Returns the
   * stored event; pass it to `toWebhookEventPayload` to build a matching webhook body.
   */
  enqueueEvent(input: MockEventInput): TypedEvent {
    return this.#api.enqueueEvent(input);
  }

  /**
   * Applies a reviewer's decision to a stored asset, as the portal or API would: the moderation
   * status changes (`purged` also removes the content, with reason `requested` and an
   * `asset.content-removed` event), the review joins `manualReviews`, and an `asset.<decision>`
   * event with a `decided-by: reviewer` fact joins the events feed. Rejects with
   * `asset/not-found` for an unknown asset. It sends no request.
   */
  decide(assetId: string, decision: MockReviewDecision): Promise<Asset> {
    return this.#api.decide(assetId, decision);
  }
}
