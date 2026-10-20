import type { CategoryFinding, ModerationOutcome, ModerationStatus } from "./moderation/types";

// The demo is a private sandbox per visitor: everything a visitor creates lives in one KV value
// keyed by their session cookie, so nobody sees anyone else's uploads. In your app this would
// be your real database; the moderation fields on Post/Comment are the part worth copying.

export interface Env {
  CALMGRAM: KVNamespace;
  ASSETS: Fetcher;
  /** Limits form submissions per visitor IP (Workers Rate Limiting). */
  WRITE_LIMITER?: RateLimit;
  /** Set to "1" to simulate moderation locally. Without it, missing keys stop the app. */
  CALMLENS_DEMO?: string;
  /** Set to "1" to allow demo mode on a non-localhost hostname. */
  CALMLENS_DEMO_ALLOW_REMOTE?: string;
  /** CalmLens calls allowed per UTC day across all visitors. Defaults to 2000. */
  CALMGRAM_DAILY_MODERATION_LIMIT?: string;
  CALMLENS_API_KEY?: string;
  CALMLENS_PROJECT_ID?: string;
  /**
   * The project's secret test input key (Assets → Try test inputs in the CalmLens portal), shown in
   * the New post page's test code. Test images in public/test-images must be made with it too.
   */
  CALMLENS_TEST_INPUT_KEY?: string;
  CALMLENS_WEBHOOK_SECRET?: string;
  /** Upload preset (requiring tokens) that browsers upload photos through. */
  CALMLENS_UPLOAD_PRESET_ID?: string;
  CALMLENS_API_URL?: string;
  CALMLENS_CDN_URL?: string;
  /** Turnstile widget keys. With both set, visitors pass a Turnstile check before any page. */
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
}

export interface ModerationFields {
  /** CalmLens asset ID — the key webhooks and the portal use. */
  assetId: string;
  status: ModerationStatus;
  flagged: boolean;
  findings: CategoryFinding[];
  /** Last time we asked CalmLens for the status (polling fallback for missed webhooks). */
  checkedAt: number;
}

export interface Post extends ModerationFields {
  id: string;
  author: string;
  caption: string;
  createdAt: number;
  /** A curated display example, with no corresponding CalmLens asset. */
  exampleId?: string;
}

export interface Comment extends ModerationFields {
  id: string;
  postId: string;
  author: string;
  text: string;
  createdAt: number;
}

export interface Flash {
  error?: string;
  notice?: string;
  /** Text to put back in the form after a rejection, so the author can edit it. */
  draft?: string;
}

export interface Sandbox {
  id: string;
  username: string;
  bio: string;
  createdAt: number;
  lastActiveAt: number;
  posts: Post[];
  comments: Comment[];
  likes: Record<string, string[]>;
  /** Posts whose photo the browser was given an upload token for, but hasn't submitted yet. */
  uploads?: UploadDraft[];
  flash?: Flash;
}

export interface UploadDraft {
  postId: string;
  startedAt: number;
}

export interface DemoAsset {
  outcome: ModerationOutcome;
  readyAt: number;
  mimeType: string;
}

export const newId = () => crypto.randomUUID();

export const applyOutcome = (target: ModerationFields, outcome: ModerationOutcome) => {
  target.status = outcome.status;
  target.flagged = outcome.flagged;
  target.findings = outcome.findings;
  target.checkedAt = Date.now();
};
