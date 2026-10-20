import "./ModerationPolicyDimensions-CGuT-QNm.js";
import { l as FlaggedContentAction } from "./Classification-D9ZNv0MB.js";
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