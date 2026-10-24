import * as zod from "zod";
//#region packages/shared/src/AssetModerationDecision.d.ts
/**
 * What moderation decided for an asset, which also decides how it is delivered: served to anyone
 * with access (`allowed`), only through signed URLs, server keys or `allowAgeRestricted=true` (`age-restricted`), not served
 * (`blocked`), or not served with its stored content deleted (`purged`).
 */
declare const ASSET_MODERATION_DECISION_SCHEMA: zod.ZodEnum<{
  "age-restricted": "age-restricted";
  allowed: "allowed";
  blocked: "blocked";
  purged: "purged";
}>;
type AssetModerationDecision = zod.infer<typeof ASSET_MODERATION_DECISION_SCHEMA>;
//#endregion
export { AssetModerationDecision as t };