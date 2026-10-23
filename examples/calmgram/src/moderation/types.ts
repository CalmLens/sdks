// The app's own view of a moderation decision. Keeping this separate from CalmLens's
// Asset type means the rest of the app doesn't care whether it's running against the
// real API or the local demo simulator.

/**
 * CalmLens's moderation status, plus `error` when processing failed. `allowed` photos are shown
 * to everyone. `age-restricted` photos are published too, but shown only to viewers who turned on
 * "Show sensitive media"; everyone else sees a blurred placeholder. Text has no sensitive view,
 * so text that isn't `allowed` is never saved.
 */
export type ModerationStatus =
  | "pending"
  | "allowed"
  | "age-restricted"
  | "blocked"
  | "purged"
  | "error";

export type ContentKind = "post-image" | "caption" | "comment" | "bio";

export interface CategoryFinding {
  /** CalmLens category ID, e.g. "harassment". */
  category: string;
  /** 0–1 score from the classification results. */
  score: number;
}

export interface ModerationOutcome {
  assetId: string;
  /**
   * The ID we gave the asset in our app (`post-…`, `comment-…`). Checked against our own
   * record before applying a decision, so a webhook or poll can only update the item it was
   * created for. Undefined when the provider doesn't know it.
   */
  externalId?: string | null;
  /** The upload preset the asset was uploaded through, when the provider knows it. */
  uploadPresetId?: string | null;
  /**
   * `allowed` → show it. `age-restricted` → show photos only to viewers who opted in, and a
   * placeholder to everyone else. `blocked` or `purged` → don't show it. `pending` → still being
   * classified. `error` → classification failed; treat as not shown.
   */
  status: ModerationStatus;
  /** Evaluated categories, highest score first. */
  findings: CategoryFinding[];
}

export interface ModerationProvider {
  mode: "calmlens" | "demo";
  /** Text is quick to classify, so it's checked synchronously before we save anything. */
  moderateText(input: {
    text: string;
    kind: ContentKind;
    externalId: string;
    username: string;
  }): Promise<ModerationOutcome>;
  /** Images are queued; the result arrives by webhook or by polling `checkAsset`. */
  submitImage(input: {
    file: File;
    externalId: string;
    username: string;
  }): Promise<ModerationOutcome>;
  /**
   * The upload preset browsers upload photos through, or null when photos are posted to this
   * server and forwarded instead (demo mode, or no preset configured).
   */
  uploadPresetId: string | null;
  /** Signs a single-use token that lets one browser upload one photo through `uploadPresetId`. */
  signUploadToken(input: { externalId: string }): Promise<{ token: string; expiresAt: number }>;
  checkAsset(assetId: string): Promise<ModerationOutcome>;
  /**
   * Waits up to `timeoutMs` for the asset's decision. Returns a `pending` outcome if there is
   * none by then, so callers can simply ask again.
   */
  waitForDecision(
    assetId: string,
    options: { timeoutMs: number; signal?: AbortSignal },
  ): Promise<ModerationOutcome>;
  /**
   * Only call this for allowed assets, or with `ageRestricted` for age-restricted assets the
   * viewer may see — see the README section on CDN delivery.
   */
  imageUrl(
    assetId: string,
    variant: "feed" | "thumb",
    options?: { ageRestricted?: boolean },
  ): string;
  /** The asset's small blurred placeholder image, served whatever its moderation status. */
  placeholderUrl(assetId: string): string;
  deleteAsset(assetId: string): Promise<void>;
  verifyWebhook(rawBody: string, signature: string, timestamp: string): Promise<boolean>;
}

export const CATEGORY_LABELS: Record<string, string> = {
  sexual: "sexual content",
  violence: "violence",
  "self-harm": "self-harm",
  harassment: "harassment",
  hate: "hate speech",
  "criminal-activity": "criminal activity",
};

export const describeFindings = (findings: CategoryFinding[], minimumScore = 0.5) => {
  const labels = findings
    .filter((finding) => finding.score >= minimumScore)
    .map((finding) => CATEGORY_LABELS[finding.category] ?? finding.category);
  if (labels.length === 0) return "our community guidelines";
  if (labels.length === 1) return labels[0];
  return `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
};
