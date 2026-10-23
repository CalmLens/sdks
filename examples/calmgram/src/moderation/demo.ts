import type { DemoAsset } from "../data";
import { decodePng, encodePng } from "../png";
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

// [pattern, category, score]. Scores ≥ 0.8 match the policy: sexual content is age-restricted,
// like the General community policy does, and everything else is blocked. Lower scores are allowed.
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
  const matched = hit && hit.score >= 0.8 ? hit.category.split(".")[0] : undefined;
  return {
    assetId,
    externalId,
    status: !matched ? "allowed" : matched === "sexual" ? "age-restricted" : "blocked",
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
  if (!asset) return { assetId, status: "error", findings: [] };
  if (Date.now() < asset.readyAt) return { assetId, status: "pending", findings: [] };
  return asset.outcome;
};

export const createDemoProvider = (kv: KVNamespace): ModerationProvider => ({
  mode: "demo",

  async moderateText({ text, externalId }) {
    const assetId = `demo-${crypto.randomUUID()}`;
    const trigger = await detectTestText(text, DEMO_TEST_INPUT_KEY);
    if (trigger) return outcomeFor(assetId, externalId, { category: trigger, score: 0.95 });
    const rule = TEXT_RULES.find(([pattern]) => pattern.test(text));
    return outcomeFor(assetId, externalId, rule && { category: rule[1], score: rule[2] });
  },

  async submitImage({ file, externalId }) {
    const assetId = `demo-${crypto.randomUUID()}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const image = decodePng(bytes);
    const category = image ? await detectTestImage(image, DEMO_TEST_INPUT_KEY) : undefined;
    await storeDemoImage(kv, assetId, bytes, {
      outcome: outcomeFor(assetId, externalId, category ? { category, score: 0.95 } : undefined),
      readyAt: Date.now() + IMAGE_DELAY_MS,
      mimeType: file.type,
    });
    return { assetId, externalId, status: "pending", findings: [] };
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

  imageUrl(assetId, variant, { ageRestricted = false } = {}) {
    // Mirrors the CalmLens CDN: age-restricted photos are served only with the explicit opt-in.
    return `/demo-media/${assetId}?variant=${variant}${ageRestricted ? "&ageRestricted=true" : ""}`;
  },

  placeholderUrl(assetId) {
    return `/demo-media/${assetId}/placeholder`;
  },

  async deleteAsset(assetId) {
    await Promise.all([kv.delete(`demo-image:${assetId}`), kv.delete(`demo-asset:${assetId}`)]);
  },

  async verifyWebhook() {
    return false;
  },
});

const isDemoAssetId = (assetId: string) => /^demo-[0-9a-f-]+$/.test(assetId);

/**
 * Serves allowed photos, and age-restricted ones only with `ageRestricted`, like the CalmLens
 * CDN's `?ageRestricted=true` opt-in.
 */
export const readDemoUpload = async (
  kv: KVNamespace,
  assetId: string,
  { ageRestricted = false }: { ageRestricted?: boolean } = {},
) => {
  if (!isDemoAssetId(assetId)) return null;
  const asset = await readDemoAsset(kv, assetId);
  if (!asset || Date.now() < asset.readyAt) return null;
  const status = asset.outcome.status;
  if (status !== "allowed" && !(status === "age-restricted" && ageRestricted)) return null;
  const bytes = await kv.get(`demo-image:${assetId}`, "arrayBuffer");
  return bytes ? { bytes, mimeType: asset.mimeType } : null;
};

const PLACEHOLDER_SIZE = 32;
const PLACEHOLDER_GRID = 4;

/**
 * Demo stand-in for CalmLens's ThumbHash placeholder: a tiny, heavily blurred PNG that keeps only
 * the photo's main colours. PNG uploads are averaged into a 4×4 grid and smoothly scaled up; other
 * formats, which the demo can't decode, get a neutral grey.
 */
export const blurredPlaceholder = (bytes: Uint8Array) => {
  const image = decodePng(bytes);
  const grid = new Float64Array(PLACEHOLDER_GRID * PLACEHOLDER_GRID * 3).fill(128);
  if (image && image.width > 0 && image.height > 0) {
    const counts = new Float64Array(PLACEHOLDER_GRID * PLACEHOLDER_GRID);
    grid.fill(0);
    for (let y = 0; y < image.height; y++) {
      for (let x = 0; x < image.width; x++) {
        const cell =
          Math.floor((y * PLACEHOLDER_GRID) / image.height) * PLACEHOLDER_GRID +
          Math.floor((x * PLACEHOLDER_GRID) / image.width);
        const pixel = (y * image.width + x) * 4;
        for (let channel = 0; channel < 3; channel++) {
          grid[cell * 3 + channel] += image.rgba[pixel + channel];
        }
        counts[cell]++;
      }
    }
    for (let cell = 0; cell < counts.length; cell++) {
      for (let channel = 0; channel < 3; channel++) grid[cell * 3 + channel] /= counts[cell] || 1;
    }
  }
  // Bilinear upscale of the grid, so the cells blend into each other.
  const rgba = new Uint8Array(PLACEHOLDER_SIZE * PLACEHOLDER_SIZE * 4);
  const sample = (gx: number, gy: number, channel: number) =>
    grid[(gy * PLACEHOLDER_GRID + gx) * 3 + channel];
  for (let y = 0; y < PLACEHOLDER_SIZE; y++) {
    for (let x = 0; x < PLACEHOLDER_SIZE; x++) {
      const fx = Math.max(0, ((x + 0.5) * PLACEHOLDER_GRID) / PLACEHOLDER_SIZE - 0.5);
      const fy = Math.max(0, ((y + 0.5) * PLACEHOLDER_GRID) / PLACEHOLDER_SIZE - 0.5);
      const x0 = Math.min(Math.floor(fx), PLACEHOLDER_GRID - 1);
      const y0 = Math.min(Math.floor(fy), PLACEHOLDER_GRID - 1);
      const x1 = Math.min(x0 + 1, PLACEHOLDER_GRID - 1);
      const y1 = Math.min(y0 + 1, PLACEHOLDER_GRID - 1);
      const tx = fx - x0;
      const ty = fy - y0;
      for (let channel = 0; channel < 3; channel++) {
        const top = sample(x0, y0, channel) * (1 - tx) + sample(x1, y0, channel) * tx;
        const bottom = sample(x0, y1, channel) * (1 - tx) + sample(x1, y1, channel) * tx;
        rgba[(y * PLACEHOLDER_SIZE + x) * 4 + channel] = Math.round(top * (1 - ty) + bottom * ty);
      }
      rgba[(y * PLACEHOLDER_SIZE + x) * 4 + 3] = 255;
    }
  }
  return encodePng(PLACEHOLDER_SIZE, PLACEHOLDER_SIZE, rgba);
};

/** The demo's `/placeholder` resource: served whatever the status, except for purged assets. */
export const readDemoPlaceholder = async (kv: KVNamespace, assetId: string) => {
  if (!isDemoAssetId(assetId)) return null;
  const asset = await readDemoAsset(kv, assetId);
  if (!asset || asset.outcome.status === "purged") return null;
  const bytes = await kv.get(`demo-image:${assetId}`, "arrayBuffer");
  return bytes ? blurredPlaceholder(new Uint8Array(bytes)) : null;
};
