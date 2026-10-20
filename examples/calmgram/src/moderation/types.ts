// The app's own view of a moderation decision. Keeping this separate from CalmLens's
// Asset type means the rest of the app doesn't care whether it's running against the
// real API or the local demo simulator.

export type ModerationStatus = "pending" | "approved" | "rejected" | "error";

export type ContentKind = "post-image" | "caption" | "comment" | "bio";

export interface CategoryFinding {
  /** CalmLens category ID, e.g. "harassment". */
  category: string;
  /** 0–1 score from the moderation report. */
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
   * `approved` → show it. `rejected` → the project policy chose hide/purge; don't show it.
   * `pending` → still being classified. `error` → classification failed; treat as not shown.
   */
  status: ModerationStatus;
  /** `true` on an approved item means the policy chose "alert": publish, but queue for review. */
  flagged: boolean;
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
  /** Only call this for approved assets — see the README section on CDN delivery. */
  imageUrl(assetId: string, variant: "feed" | "thumb"): string;
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
