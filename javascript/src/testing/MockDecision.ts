import { invalidArgument } from "../client/CalmLensError";
import type { Asset, AssetModeration } from "../client/CalmLensTypes";
import { MOCK_CATEGORIES, MOCK_QUALIFIERS } from "./MockClassification";

/**
 * Where the mock's moderation leaves an upload: `pending` (still processing), `failed`
 * (processing failed, retryable), or a decision with that moderation status (`purged` also
 * removes the content).
 */
export type MockAssetOutcome =
  | "pending"
  | "failed"
  | "allowed"
  | "limited"
  | "age-restricted"
  | "blocked"
  | "purged";

const OUTCOMES: readonly MockAssetOutcome[] = [
  "pending",
  "failed",
  "allowed",
  "limited",
  "age-restricted",
  "blocked",
  "purged",
];

/** The policy action that gives each decided status. */
const STATUS_ACTION = {
  allowed: "allow",
  limited: "limit",
  "age-restricted": "age-restrict",
  blocked: "block",
  purged: "purge",
} as const;

type Category = (typeof MOCK_CATEGORIES)[number];

/** Why a decision waits for human review: `sampled`, or `uncertain` about some categories. */
export type MockPendingReviewReason = "sampled" | "uncertain";

/** The likelihood the API reports for a score (ClassificationCategories.ts, scoreToLikelihood). */
const scoreToLikelihood = (score: number) =>
  score >= 0.8
    ? "very-likely"
    : score >= 0.6
      ? "likely"
      : score >= 0.4
        ? "possible"
        : score >= 0.2
          ? "unlikely"
          : "very-unlikely";

const isScore = (score: unknown): score is number =>
  typeof score === "number" && Number.isFinite(score) && score >= 0 && score <= 1;

/**
 * A moderation decision for `mockOptions.moderate` or `completeProcessing`, built with
 * `mockDecision(status)`: flag the categories it found, with their scores and qualifiers, and
 * mark the categories it couldn't assess. Each call checks its names and scores and throws
 * `sdk/invalid-argument` for one CalmLens doesn't have.
 */
export class MockDecision {
  readonly status: MockAssetOutcome;
  readonly #flags = new Map<
    Category,
    { score: number; qualifiers: Array<[qualifier: string, score: number]> }
  >();
  readonly #notEvaluated = new Set<Category>();
  #pendingReview?: { reason: MockPendingReviewReason; uncertainCategories: Category[] };

  constructor(status: MockAssetOutcome) {
    if (!OUTCOMES.includes(status)) {
      throw invalidArgument(`status must be one of ${OUTCOMES.join(", ")}`);
    }
    this.status = status;
  }

  /**
   * Records findings in `category` with its `score` (0 to 1) and, optionally, scores for its
   * qualifiers, such as `{ "violence-threat": 0.9 }`. The policy acts on a category at 0.5 and
   * above, so `flaggedCategories` lists it there unless the status is `allowed`.
   */
  flag(category: Category, score: number, qualifiers: Record<string, number> = {}): this {
    this.#checkCategory(category);
    if (this.status === "pending" || this.status === "failed") {
      throw invalidArgument(`a ${this.status} decision has no findings`);
    }
    if (this.#flags.has(category) || this.#notEvaluated.has(category)) {
      throw invalidArgument(`${category} is already in this decision`);
    }
    if (!isScore(score)) throw invalidArgument(`${category}'s score must be from 0 to 1`);
    const known: readonly string[] = MOCK_QUALIFIERS[category];
    for (const [qualifier, qualifierScore] of Object.entries(qualifiers)) {
      if (!known.includes(qualifier)) {
        throw invalidArgument(`${qualifier} is not a qualifier of ${category}`);
      }
      if (!isScore(qualifierScore)) {
        throw invalidArgument(`${qualifier}'s score must be from 0 to 1`);
      }
    }
    this.#flags.set(category, { score, qualifiers: Object.entries(qualifiers) });
    return this;
  }

  /** Marks `category` as not assessed (`not-evaluated` for reason `not-supported`). */
  notEvaluated(category: Category): this {
    this.#checkCategory(category);
    if (this.status === "pending" || this.status === "failed") {
      throw invalidArgument(`a ${this.status} decision has no findings`);
    }
    if (this.#flags.has(category) || this.#notEvaluated.has(category)) {
      throw invalidArgument(`${category} is already in this decision`);
    }
    this.#notEvaluated.add(category);
    return this;
  }

  /**
   * Leaves the decision waiting for human review, as `classification.moderation.pendingReview`
   * reports: `sampled`, or `uncertain` with the `uncertainCategories` that made it so. The queue's
   * decision (`decide` on the mock) clears it; `assets.decide` doesn't, as with the API.
   */
  pendingReview(reason: MockPendingReviewReason, uncertainCategories: Category[] = []): this {
    if (this.status === "pending" || this.status === "failed") {
      throw invalidArgument(`a ${this.status} decision can't wait for review`);
    }
    if (reason !== "sampled" && reason !== "uncertain") {
      throw invalidArgument("reason must be sampled or uncertain");
    }
    if (reason === "sampled" && uncertainCategories.length) {
      throw invalidArgument("a sampled review has no uncertain categories");
    }
    for (const category of uncertainCategories) this.#checkCategory(category);
    this.#pendingReview = { reason, uncertainCategories: [...uncertainCategories] };
    return this;
  }

  #checkCategory(category: string): asserts category is Category {
    if (!(MOCK_CATEGORIES as readonly string[]).includes(category)) {
      throw invalidArgument(`${category} is not a CalmLens category`);
    }
  }

  /**
   * The report a decided asset gets, as the API sends it: every category (unflagged ones
   * evaluated with score 0), policy-adjusted results and the automated status and
   * `flaggedCategories`. `requestedAt` is when a pending review joined the queue. `undefined` for
   * `pending` and `failed`.
   */
  report(requestedAt = 0): Omit<AssetModeration, "status" | "manualReviews"> | undefined {
    const status = this.status;
    if (status === "pending" || status === "failed") return undefined;
    const action = (score: number) =>
      status !== "allowed" && score >= 0.5 ? STATUS_ACTION[status] : "allow";
    const evaluated = MOCK_CATEGORIES.filter((category) => !this.#notEvaluated.has(category)).map(
      (category) => [category, this.#flags.get(category)?.score ?? 0] as const,
    );
    const categories = Object.fromEntries(
      MOCK_CATEGORIES.map((category) => {
        if (this.#notEvaluated.has(category)) {
          return [category, { status: "not-evaluated", reason: "not-supported" }];
        }
        const flag = this.#flags.get(category);
        const score = flag?.score ?? 0;
        return [
          category,
          {
            status: "evaluated",
            likelihood: scoreToLikelihood(score),
            score,
            ...(flag?.qualifiers.length && {
              qualifiers: Object.fromEntries(
                flag.qualifiers.map(([qualifier, someScore]) => [
                  qualifier,
                  { status: "evaluated", someScore, likelihood: scoreToLikelihood(someScore) },
                ]),
              ),
            }),
          },
        ];
      }),
    );
    return {
      categories: Object.fromEntries(
        evaluated.map(([category, score]) => [
          category,
          {
            score,
            action: action(score),
            source: { kind: score >= 0.5 ? ("default" as const) : ("below-threshold" as const) },
            // The mock keeps no policies: the category's setting is the decision's own action.
            settings: {
              action: status === "allowed" ? ("allow" as const) : STATUS_ACTION[status],
              allowances: [],
              restrictions: [],
            },
          },
        ]),
      ),
      explanationComplete: true,
      // The mock keeps no policies, so no policy is named.
      policy: null,
      pendingReview: this.#pendingReview ? { requestedAt, ...this.#pendingReview } : null,
      source: "policy",
      rule: null,
      automatedStatus: status,
      regions: [],
      linkSafety: null,
      // The mock analyses no audio or video, so a decision has no findings timeline.
      timeline: null,
      flaggedCategories: evaluated
        .filter(([, score]) => action(score) !== "allow")
        .map(([category]) => category),
      raw: {
        categories: categories as NonNullable<AssetModeration["raw"]>["categories"],
        hashMatches: [],
      },
    };
  }
}

/** Starts a moderation decision with this status; see `MockDecision`. */
export const mockDecision = (status: MockAssetOutcome): MockDecision => new MockDecision(status);

/** Why the mock is moderating an asset, for `mockOptions.moderate`. */
export type MockModerationTrigger =
  /** An upload completed: `assets.create`, `assets.classify`, `text.classify` or a final part. */
  | "upload"
  /** `assets.retry` queued a failed asset again. */
  | "retry"
  /** `assets.explain` with `rerun: true` queued the asset again. */
  | "rerun"
  /** `completeProcessing(assetId)` finished processing without a decision of its own. */
  | "complete";

/** What `mockOptions.moderate` receives for each asset the mock moderates. */
export interface MockModerationInput {
  /** The asset as stored, still processing. */
  asset: Asset;
  /** The uploaded bytes (`null` without stored content, such as a website), and the text of a plain-text upload. */
  content: { bytes: Uint8Array | null; text: string | null };
  trigger: MockModerationTrigger;
  /**
   * `true` when the API would queue the work rather than answer with the decision: queued
   * uploads, retries, reruns and `completeProcessing`.
   */
  queued: boolean;
}

/**
 * Decides an asset the mock moderates: a status or a `mockDecision(...)`, or a promise of one.
 * Without it, queued uploads, retries and reruns stay `pending` and everything else is `allowed`.
 */
export type MockModerate = (
  input: MockModerationInput,
) => MockAssetOutcome | MockDecision | Promise<MockAssetOutcome | MockDecision>;

/** The default `moderate`: queued work stays pending until `completeProcessing`, which allows it. */
export const defaultModerate: MockModerate = ({ trigger, queued }) =>
  queued && trigger !== "complete" ? "pending" : "allowed";
