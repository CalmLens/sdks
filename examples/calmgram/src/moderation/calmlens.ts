import type { Asset, EnsureLensOptions } from "@calmlens/sdk";
import { CalmLensError, CalmLensServerClient, verifyWebhookSignature } from "@calmlens/sdk/server";
import type { ModerationOutcome, ModerationProvider, ModerationStatus } from "./types";

// Lenses are named, versioned CDN transformations (think "image presets"). Bump `version`
// whenever you change a lens definition so the CDN cache is invalidated.
const LENSES: EnsureLensOptions[] = [
  {
    identifier: "calmgram-feed",
    name: "Calmgram feed image",
    description: null,
    type: "image",
    active: true,
    version: 1,
    transforms: [
      { type: "imageTransform", options: { fit: "scale-down", width: 1080, format: "webp" } },
    ],
  },
  {
    identifier: "calmgram-thumb",
    name: "Calmgram profile grid thumbnail",
    description: null,
    type: "image",
    active: true,
    version: 1,
    transforms: [
      {
        type: "imageTransform",
        options: { fit: "cover", width: 400, height: 400, format: "webp" },
      },
    ],
  },
];

/**
 * CalmLens may add statuses in future. Anything this app doesn't know is treated as
 * "not decided yet", so it is never shown to other users. Failed processing is final.
 */
const DECIDED: ReadonlySet<string> = new Set<ModerationStatus>([
  "allowed",
  "limited",
  "age-restricted",
  "blocked",
  "purged",
]);

const toStatus = (asset: Asset): ModerationStatus => {
  if (asset.classification.status === "failed") return "error";
  const status = asset.classification.moderation.status;
  return DECIDED.has(status) ? (status as ModerationStatus) : "pending";
};

export const toOutcome = (asset: Asset): ModerationOutcome => {
  const findings = Object.entries(asset.classification.moderation?.categories ?? {})
    .flatMap(([category, result]) =>
      // `not-evaluated` means "unknown", not "safe" — never treat it as a zero score.
      result &&
      typeof result === "object" &&
      "status" in result &&
      (result.status === "evaluated" || result.status === "partial") &&
      "score" in result &&
      typeof result.score === "number"
        ? [{ category, score: result.score }]
        : [],
    )
    .sort((a, b) => b.score - a.score);

  return {
    assetId: asset.id,
    externalId: asset.externalId ?? null,
    uploadPresetId: asset.uploadPresetId ?? null,
    status: toStatus(asset),
    findings,
  };
};

export const createCalmLensProvider = (options: {
  apiKey: string;
  projectId: string;
  webhookSecret?: string;
  /** The upload preset browsers upload photos through. It must require upload tokens. */
  uploadPresetId?: string;
  /** Overrides for running against a local CalmLens; leave unset for production. */
  apiUrl?: string;
  cdnUrl?: string;
}): ModerationProvider => {
  const client = new CalmLensServerClient({
    apiKey: options.apiKey,
    projectId: options.projectId,
    ...(options.apiUrl ? { baseUrl: options.apiUrl } : {}),
    ...(options.cdnUrl ? { cdnBaseUrl: options.cdnUrl } : {}),
  });

  // ensureLenses is idempotent and cached by the client, so it's safe to call lazily.
  let lensesReady: Promise<unknown> | undefined;
  const ensureLenses = () => {
    lensesReady ??= client.ensureLenses({ lenses: LENSES }).catch((error) => {
      lensesReady = undefined;
      throw error;
    });
    return lensesReady;
  };

  return {
    mode: "calmlens",

    async moderateText({ text, kind, externalId, username }) {
      // `text.classify` waits for the decision, which is fast for short text. CalmLens doesn't
      // keep the text after classifying it by default; our database has it. The SDK retries
      // network failures with an idempotency key, so a retry never creates a second asset.
      const asset = await client.text.classify({
        name: `${kind}-${externalId}`,
        externalId,
        metadata: [
          { id: "calmgram.kind", value: kind },
          { id: "calmgram.username", value: username },
        ],
        text,
      });
      return toOutcome(asset);
    },

    uploadPresetId: options.uploadPresetId ?? null,

    async signUploadToken({ externalId }) {
      if (!options.uploadPresetId) throw new Error("CALMLENS_UPLOAD_PRESET_ID is not set");
      await ensureLenses();
      // Signed locally with the API key; no request to CalmLens. The token uploads one photo
      // through the preset, and the asset gets our externalId, so the browser can't choose it.
      return client.uploadTokens.sign({
        uploadPresetId: options.uploadPresetId,
        externalId,
        expiresInSeconds: 10 * 60,
      });
    },

    // The no-JavaScript fallback: the browser posted the photo to us, so we forward it.
    async submitImage({ file, externalId, username }) {
      await ensureLenses();
      // `create` queues classification and returns immediately, before a decision.
      const asset = await client.assets.create({
        name: file.name || `${externalId}.${file.type.split("/")[1] ?? "img"}`,
        content: { data: file, type: file.type },
        externalId,
        // Public so allowed images can be served straight from the CDN. NOTE: the CDN
        // serves public assets while they're still pending, so we never hand the URL to
        // browsers until the asset is allowed or age-restricted (see README → "Things worth
        // copying"). With a preset,
        // its folder, visibility, file types and size limit apply to this upload too.
        ...(options.uploadPresetId
          ? { uploadPresetId: options.uploadPresetId }
          : { visibility: "public" as const }),
        metadata: [
          { id: "calmgram.kind", value: "post-image" },
          { id: "calmgram.username", value: username },
        ],
        processingOptions: {
          keepContentAfterProcessing: true,
          // Catch harmful text inside screenshots and memes.
          features: { ocr: { enabled: true } },
        },
      });
      return toOutcome(asset);
    },

    async checkAsset(assetId) {
      return toOutcome(await client.assets.retrieve({ assetId }));
    },

    async waitForDecision(assetId, { timeoutMs, signal }) {
      try {
        return toOutcome(await client.assets.waitForDecision({ assetId, timeoutMs, signal }));
      } catch (error) {
        // No decision yet: report it as still pending and let the caller ask again.
        if (CalmLensError.isCalmLensError(error) && error.code === "sdk/timeout") {
          return { assetId, status: "pending", findings: [] };
        }
        throw error;
      }
    },

    imageUrl(assetId, variant, { allowAgeRestricted = false } = {}) {
      // Use the unguessable asset ID, not our externalId (post IDs appear in app URLs).
      return client.cdn.getAssetUrl({
        assetIdentifier: assetId,
        lens: variant === "feed" ? "calmgram-feed" : "calmgram-thumb",
        // The CDN refuses an age-restricted asset's plain URL. `allowAgeRestricted=true` opts in,
        // so only build it for viewers this app has decided may see sensitive media.
        ...(allowAgeRestricted ? { allowAgeRestricted: true } : {}),
      });
    },

    placeholderUrl(assetId) {
      // A small blurred PNG rendered from the asset's ThumbHash. The CDN serves it for public
      // assets whatever their moderation status (but never for purged ones).
      const { cdnBaseUrl, projectId } = client.toJSON();
      return `${cdnBaseUrl}/assets/${encodeURIComponent(projectId)}/${encodeURIComponent(assetId)}/placeholder`;
    },

    async deleteAsset(assetId) {
      try {
        await client.assets.delete({ assetId });
      } catch (error) {
        // Already gone, for example deleted from the portal: nothing left to remove.
        if (CalmLensError.isCalmLensError(error) && error.isNotFound()) return;
        throw error;
      }
    },

    async verifyWebhook(rawBody, signature, timestamp) {
      if (!options.webhookSecret) return false;
      return verifyWebhookSignature({
        payload: rawBody, // the raw string, never a re-serialised object
        signature,
        timestamp,
        secret: options.webhookSecret,
      });
    },
  };
};

/** For server logs only: the code and request ID identify the failure for CalmLens support. */
export const describeCalmLensError = (error: unknown) =>
  CalmLensError.isCalmLensError(error)
    ? `${error.code}${error.requestId ? ` (request ${error.requestId})` : ""}: ${error.message}`
    : String(error);
