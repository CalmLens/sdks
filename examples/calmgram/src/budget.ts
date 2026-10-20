import type { Env } from "./data";

// The public demo moderates with one CalmLens API key for every visitor. Per-IP rate limits
// stop one visitor flooding it; this daily budget caps what everyone together can spend.

export const DEFAULT_DAILY_MODERATION_LIMIT = 2000;
const BUDGET_TTL_SECONDS = 2 * 24 * 60 * 60;

export class DailyLimitReached extends Error {
  constructor() {
    super("The daily moderation budget is used up");
  }
}

/** One counter per UTC day. */
export const budgetKey = (now: Date) => `budget:${now.toISOString().slice(0, 10)}`;

export const dailyModerationLimit = (env: Pick<Env, "CALMGRAM_DAILY_MODERATION_LIMIT">) => {
  const limit = Number(env.CALMGRAM_DAILY_MODERATION_LIMIT);
  return Number.isSafeInteger(limit) && limit > 0 ? limit : DEFAULT_DAILY_MODERATION_LIMIT;
};

/**
 * Counts `calls` CalmLens requests against today's budget, or throws `DailyLimitReached`.
 * KV is eventually consistent, so concurrent requests can overshoot slightly; use a Durable
 * Object if you need an exact count.
 */
export const spendModerationBudget = async (env: Env, calls = 1, now = new Date()) => {
  const key = budgetKey(now);
  const used = Number((await env.CALMGRAM.get(key)) ?? 0);
  if (used + calls > dailyModerationLimit(env)) throw new DailyLimitReached();
  // KV allows about one write per second per key; a lost increment only makes the cap looser.
  await env.CALMGRAM.put(key, String(used + calls), { expirationTtl: BUDGET_TTL_SECONDS }).catch(
    () => {},
  );
};
