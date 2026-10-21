import "./ModerationPolicyDimensions-D01RYT2o.js";
import { c as FlaggedContentAction } from "./Classification-tCsNzELJ.js";
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