import * as zod from "zod";
/**
 * What moderation decided for an asset, which also decides how it is delivered: served to anyone
 * with access (`allowed`), served the same way but marked for reduced reach (`limited`), only
 * through signed URLs, server keys or `allowAgeRestricted=true` (`age-restricted`), not served
 * (`blocked`), or not served with its stored content deleted (`purged`).
 */
declare const ASSET_MODERATION_DECISION_SCHEMA: zod.ZodEnum<{
  "age-restricted": "age-restricted";
  allowed: "allowed";
  blocked: "blocked";
  limited: "limited";
  purged: "purged";
}>;
type AssetModerationDecision = zod.infer<typeof ASSET_MODERATION_DECISION_SCHEMA>;
export { AssetModerationDecision as t };