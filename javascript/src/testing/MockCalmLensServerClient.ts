import { MOCK_HOOKS, type MockHooks } from "../client/CalmLensConnection";
import { invalidConfig } from "../client/CalmLensError";
import CalmLensServerClient from "../client/CalmLensServerClient";
import { sleep } from "../client/CalmLensTransport";
import type { Asset, CalmLensServerClientOptions } from "../client/CalmLensTypes";
import { randomUuid, validateServerClientOptions } from "../client/CalmLensUtils";
import type { TypedEvent } from "../contract/Event.js";
import { type IdPrefix, newId } from "../contract/Ids.js";
import type { PermissionGrant } from "../contract/Permissions.js";
import { createMockApiKey, getMockApiKeyGrants } from "./MockApiKey";
import {
  createMonotonicClock,
  type MockAppSession,
  MockCalmLensApi,
  type MockCalmLensCall,
  type MockCalmLensOperation,
  type MockEndpoints,
  type MockEventInput,
  type MockFailureOptions,
  type MockRequestFailure,
  type MockReviewDecision,
} from "./MockCalmLensApi";
import {
  defaultModerate,
  type MockAssetOutcome,
  type MockDecision,
  type MockModerate,
} from "./MockDecision";
import {
  InMemoryMockDatabaseStorage,
  InMemoryMockImageStorage,
  type MockDatabaseStorage,
  type MockImageStorage,
} from "./MockStorage";

export type {
  MockCalmLensCall,
  MockCalmLensOperation,
  MockEventInput,
  MockFailureOptions,
  MockRequestFailure,
  MockReviewDecision,
} from "./MockCalmLensApi";

export interface MockCalmLensServerClientOptions
  extends Omit<CalmLensServerClientOptions, "projectId"> {
  /** Defaults to `project-1`. */
  projectId?: string;
  mockOptions?: {
    /** Use normal timer delays for polling and retry backoff, including under fake timers. */
    useTimers?: boolean;
    databaseStorage?: MockDatabaseStorage;
    imageStorage?: MockImageStorage;
    /**
     * Returns a new ID for an object of the kind `prefix` names (`asset`, `fldr`, `hl`, `hle`,
     * `lens`, `evt` or `rev`). The default is like the API's: the prefix, `_` and 20 random
     * base62 characters, such as `asset_5Gm2Rk8XqT3wLp9VbN4c`.
     */
    createId?: (prefix: IdPrefix) => string;
    /**
     * The clock, in epoch milliseconds. The default is the system clock, moved on by at least a
     * millisecond per reading, so assets created in a row have increasing `createdAt` values and
     * orderings by `createdAt` don't depend on IDs.
     */
    now?: () => number;
    /**
     * Decides each asset the mock moderates, from the stored asset, its content (bytes, and the
     * text of a plain-text upload) and why it is moderated (`upload`, `retry`, `rerun` or
     * `complete`). Return a status or a `mockDecision(...)`, whose report fills the asset's
     * categories and policy. Without it, queued uploads, retries and reruns stay `pending` until
     * `completeProcessing`, and everything else is `allowed`.
     */
    moderate?: MockModerate;
  };
}

/** The project a mock uses without a `projectId`. */
export const MOCK_PROJECT_ID = "project-1";

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
  const { useTimers } = api;
  const fetch = api.createFetch(endpoints, session);
  const hooks: MockHooks = {
    sleep: useTimers
      ? sleep
      : async (ms, signal) => {
          // Yield, so other tasks (such as a `decide`) run, then move the clock on instead of waiting.
          await sleep(0, signal);
          api.waitedMs += ms;
        },
    now: useTimers ? () => Date.now() : () => api.waitedMs,
    uploadTokenTime: () => ({ now: api.now(), nonce: randomUuid() }),
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
  readonly #fetch: typeof fetch;
  readonly #projectId: string;

  /**
   * Accepts the same options as `CalmLensServerClient` (validated the same way), plus
   * `mockOptions`. `maxRetries` defaults to 0, so a failed request fails once; retry backoff and
   * `assets.waitForDecision` take no real time.
   */
  constructor(input: MockCalmLensServerClientOptions) {
    const options = { ...input, projectId: input.projectId ?? MOCK_PROJECT_ID };
    validateServerClientOptions(options);
    const { mockOptions = {}, ...clientOptions } = options;
    const api = new MockCalmLensApi({
      projectId: options.projectId,
      apiKey: options.apiKey,
      grants: getMockApiKeyGrants(options.apiKey),
      databaseStorage: mockOptions.databaseStorage ?? new InMemoryMockDatabaseStorage(),
      imageStorage: mockOptions.imageStorage ?? new InMemoryMockImageStorage(),
      createId: mockOptions.createId ?? newId,
      now: mockOptions.now ?? createMonotonicClock(),
      moderate: mockOptions.moderate ?? defaultModerate,
    });
    api.useTimers = mockOptions.useTimers ?? false;
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
    this.#fetch = api.createFetch(() => endpoints!);
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
   * Fetches a URL of the mock's CDN as a browser would, without the API key: a signed asset URL
   * from `cdn.signAssetUrl` (with a resource appended), or a public one from `cdn.getAssetUrl`.
   * The request is recorded like any other.
   */
  fetchCdn(url: string, init?: RequestInit): Promise<Response> {
    return this.#fetch(url, init);
  }

  /** Forgets the requests recorded so far, so `calls` lists only later ones. */
  clearCalls(): void {
    this.#api.calls.length = 0;
  }

  /**
   * Makes the next request (or the next one `operation` sends) fail instead of reaching the
   * in-memory API. Each queued failure fails one request, so a retry takes the next queued
   * failure or reaches the API. An API error code answers with that error and its HTTP status,
   * with `details` and a `Retry-After` of `retryAfter` seconds when given.
   */
  failNextRequest(
    failure: MockRequestFailure = "transport-error",
    options: MockFailureOptions = {},
  ): void {
    this.#api.failNextRequest(failure, options);
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
  enqueueEvent(input: MockEventInput): Promise<TypedEvent> {
    return this.#api.enqueueEvent(input);
  }

  /**
   * Applies a reviewer's decision to a stored asset, as the portal or API would: the moderation
   * status changes (`purged` also removes the content, with reason `requested` and an
   * `asset.content-removed` event), the review joins `manualReviews`, and an `asset.<decision>`
   * event whose `actor` is a `user` joins the events feed. Rejects with
   * `asset/not-found` for an unknown asset. It sends no request.
   */
  decide(assetId: string, decision: MockReviewDecision): Promise<Asset> {
    return this.#api.decide(assetId, decision);
  }

  /**
   * Finishes processing a pending asset as the moderation pipeline would: with `decision`, or
   * else what `mockOptions.moderate` returns for the `complete` trigger (`allowed` by default).
   * The asset gets the decision's report, and `asset.classified` and the automated
   * `asset.<status>` (or `asset.failed`) join the events feed. No review is recorded, so the
   * asset can still be moderated again. A decided asset whose re-run (`assets.explain` with
   * `rerun: true`) is still pending gets the decision in place of its old one, unless it is
   * `pending` or `failed`. Rejects with `asset/not-found` for an unknown asset and
   * `sdk/invalid-argument` for one that isn't processing or awaiting a pending re-run. It sends
   * no request.
   */
  completeProcessing(assetId: string, decision?: MockAssetOutcome | MockDecision): Promise<Asset> {
    return this.#api.completeProcessing(assetId, decision);
  }
}
