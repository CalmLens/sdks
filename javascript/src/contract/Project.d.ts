import "./ModerationPolicyDimensions-BgVixz6W.js";
import { c as FlaggedContentAction } from "./Classification-Ca7Zfa8G.js";
import * as zod from "zod";
//#region packages/shared/src/Project.d.ts
declare const FLAGGED_CONTENT_POLICY_SCHEMA: zod.ZodObject<{
  action: zod.ZodEnum<{
    alert: "alert";
    hide: "hide";
    ignore: "ignore";
    purge: "purge";
  }>;
}, zod.core.$strip>;
type FlaggedContentPolicy = zod.infer<typeof FLAGGED_CONTENT_POLICY_SCHEMA>;
//#endregion
export type { FlaggedContentAction, FlaggedContentPolicy };