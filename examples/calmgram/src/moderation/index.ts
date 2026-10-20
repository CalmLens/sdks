import type { Env } from "../data";
import { createCalmLensProvider } from "./calmlens";
import { createDemoProvider } from "./demo";
import type { ModerationProvider } from "./types";

/** CalmLens credentials are missing and demo mode wasn't asked for, so nothing is moderated. */
export class ModerationNotConfigured extends Error {
  constructor() {
    super(
      "Set CALMLENS_API_KEY and CALMLENS_PROJECT_ID, or set CALMLENS_DEMO=1 to simulate moderation locally.",
    );
  }
}

let cached: { key: string; provider: ModerationProvider } | undefined;

/** True when demo mode was asked for explicitly. Missing keys never switch it on by themselves. */
export const isDemoRequested = (env: Pick<Env, "CALMLENS_DEMO">) => env.CALMLENS_DEMO === "1";

/** Hostnames that only the developer's own machine can reach. */
export const isLoopbackHost = (hostname: string) =>
  hostname === "localhost" ||
  hostname.endsWith(".localhost") ||
  hostname === "[::1]" ||
  /^127(?:\.\d{1,3}){3}$/.test(hostname);

/**
 * The moderation provider for this deployment. Fails closed: without credentials it throws
 * `ModerationNotConfigured` unless `CALMLENS_DEMO=1`, so a misconfigured deployment never
 * publishes unmoderated content.
 */
export const getModeration = (env: Env): ModerationProvider => {
  const { CALMLENS_API_KEY: apiKey, CALMLENS_PROJECT_ID: projectId } = env;
  const key = `${apiKey}:${projectId}:${env.CALMLENS_UPLOAD_PRESET_ID ?? ""}:${env.CALMLENS_DEMO ?? ""}`;
  if (cached?.key === key) return cached.provider;
  let provider: ModerationProvider;
  if (apiKey && projectId) {
    provider = createCalmLensProvider({
      apiKey,
      projectId,
      webhookSecret: env.CALMLENS_WEBHOOK_SECRET,
      uploadPresetId: env.CALMLENS_UPLOAD_PRESET_ID || undefined,
      apiUrl: env.CALMLENS_API_URL,
      cdnUrl: env.CALMLENS_CDN_URL,
    });
  } else if (isDemoRequested(env)) {
    provider = createDemoProvider(env.CALMGRAM);
  } else {
    throw new ModerationNotConfigured();
  }
  cached = { key, provider };
  return provider;
};
