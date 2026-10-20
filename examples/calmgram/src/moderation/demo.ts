import type { DemoAsset } from "../data";
import { decodePng } from "../png";
import { DEMO_TEST_INPUT_KEY, detectTestImage, detectTestText } from "../testInputs";
import type { CategoryFinding, ModerationOutcome, ModerationProvider } from "./types";

// Demo mode: a local stand-in for CalmLens so you can click around without an account.
// It is NOT a moderation model. It only recognises:
//   • CalmLens test-trigger images carrying DEMO_TEST_INPUT_KEY (public/test-images, made by
//     `npm run test-images`)
//   • CalmLens test-trigger text with that key, e.g. "<!calmlens-test 1a2b3c4d harassment>"
//   • a handful of obvious phrases, so typing an insult shows the flow
// Set CALMLENS_API_KEY and CALMLENS_PROJECT_ID to use real moderation.

const IMAGE_DELAY_MS = 2500;
// Matches the sandbox lifetime's KV backstop.
const DEMO_ASSET_TTL_SECONDS = 2 * 24 * 60 * 60;

// [pattern, category, score]. Scores ≥ 0.8 are rejected ("hide"); 0.5–0.8 are approved
// but flagged ("alert"), mirroring the two outcomes a real CalmLens policy can produce.
const TEXT_RULES: Array<[RegExp, string, number]> = [
  [/\b(i('| wi)ll|gonna) (kill|hurt) you\b/i, "violence", 0.93],
  [/\bkys\b|\bkill yourself\b/i, "harassment", 0.96],
  [/\b(idiot|loser|stupid|moron|pathetic)\b/i, "harassment", 0.66],
  [/\b(buy|selling) (drugs|meth|cocaine)\b/i, "criminal-activity", 0.88],
];

const CATEGORIES = ["sexual", "violence", "self-harm", "harassment", "hate", "criminal-activity"];

const outcomeFor = (
  assetId: string,
  externalId: string,
  hit?: { category: string; score: number },
) => {
  const findings: CategoryFinding[] = CATEGORIES.map((category) => ({
    category,
    score: hit && hit.category.split(".")[0] === category ? hit.score : 0.01,
  })).sort((a, b) => b.score - a.score);
  const score = hit?.score ?? 0;
  return {
    assetId,
    externalId,
    status: score >= 0.8 ? "rejected" : "approved",
    flagged: score >= 0.5,
    findings,
  } satisfies ModerationOutcome;
};

/** Stores an image and its simulated decision, standing in for CalmLens's storage. */
export const storeDemoImage = async (
  kv: KVNamespace,
  assetId: string,
  bytes: Uint8Array,
  asset: DemoAsset,
) => {
  const ttl = { expirationTtl: DEMO_ASSET_TTL_SECONDS };
  await Promise.all([
    kv.put(`demo-image:${assetId}`, bytes, ttl),
    kv.put(`demo-asset:${assetId}`, JSON.stringify(asset), ttl),
  ]);
};

const readDemoAsset = (kv: KVNamespace, assetId: string) =>
  kv.get<DemoAsset>(`demo-asset:${assetId}`, "json");

const demoOutcome = (assetId: string, asset: DemoAsset | null): ModerationOutcome => {
  if (!asset) return { assetId, status: "error", flagged: false, findings: [] };
  if (Date.now() < asset.readyAt)
    return { assetId, status: "pending", flagged: false, findings: [] };
  return asset.outcome;
};

export const createDemoProvider = (kv: KVNamespace): ModerationProvider => ({
  mode: "demo",

  async moderateText({ text, externalId }) {
    const assetId = `demo-${crypto.randomUUID()}`;
    const trigger = detectTestText(text, DEMO_TEST_INPUT_KEY);
    if (trigger) return outcomeFor(assetId, externalId, { category: trigger, score: 0.95 });
    const rule = TEXT_RULES.find(([pattern]) => pattern.test(text));
    return outcomeFor(assetId, externalId, rule && { category: rule[1], score: rule[2] });
  },

  async submitImage({ file, externalId }) {
    const assetId = `demo-${crypto.randomUUID()}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const image = decodePng(bytes);
    const category = image ? detectTestImage(image, DEMO_TEST_INPUT_KEY) : undefined;
    await storeDemoImage(kv, assetId, bytes, {
      outcome: outcomeFor(assetId, externalId, category ? { category, score: 0.95 } : undefined),
      readyAt: Date.now() + IMAGE_DELAY_MS,
      mimeType: file.type,
    });
    return { assetId, externalId, status: "pending", flagged: false, findings: [] };
  },

  // No upload preset: the browser posts photos to the Worker, which simulates the decision.
  uploadPresetId: null,

  async signUploadToken() {
    throw new Error("Demo mode has no upload preset");
  },

  async checkAsset(assetId) {
    return demoOutcome(assetId, await readDemoAsset(kv, assetId));
  },

  async waitForDecision(assetId, { timeoutMs, signal }) {
    // The simulator decides at a known time, so sleep until then (or the timeout).
    const asset = await readDemoAsset(kv, assetId);
    const wait = asset ? Math.min(asset.readyAt - Date.now(), timeoutMs) : 0;
    if (wait > 0) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, wait);
        const stop = () => {
          clearTimeout(timer);
          resolve();
        };
        signal?.addEventListener("abort", stop, { once: true });
      });
    }
    return demoOutcome(assetId, asset);
  },

  imageUrl(assetId, variant) {
    return `/demo-media/${assetId}?variant=${variant}`;
  },

  async deleteAsset(assetId) {
    await Promise.all([kv.delete(`demo-image:${assetId}`), kv.delete(`demo-asset:${assetId}`)]);
  },

  async verifyWebhook() {
    return false;
  },
});

export const readDemoUpload = async (kv: KVNamespace, assetId: string) => {
  if (!/^demo-[0-9a-f-]+$/.test(assetId)) return null;
  const asset = await readDemoAsset(kv, assetId);
  // Mirror CalmLens's CDN: only serve approved content.
  if (asset?.outcome.status !== "approved" || Date.now() < asset.readyAt) return null;
  const bytes = await kv.get(`demo-image:${assetId}`, "arrayBuffer");
  return bytes ? { bytes, mimeType: asset.mimeType } : null;
};
