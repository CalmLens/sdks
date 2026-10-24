import "./AssetModerationDecision-BzFBTVPm.js";
import { c as FlaggedContentAction } from "./Classification-BcKXRyhj.js";
import * as zod from "zod";
//#region packages/shared/src/Project.d.ts
declare const FLAGGED_CONTENT_POLICY_SCHEMA: zod.ZodObject<{
  action: zod.ZodEnum<{
    "age-restrict": "age-restrict";
    allow: "allow";
    block: "block";
    purge: "purge";
  }>;
}, zod.core.$strip>;
type FlaggedContentPolicy = zod.infer<typeof FLAGGED_CONTENT_POLICY_SCHEMA>;
//#endregion
export type { FlaggedContentAction, FlaggedContentPolicy };