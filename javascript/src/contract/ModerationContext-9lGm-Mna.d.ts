import "./ModerationContextLimits-_Tkg4UIV.js";
import * as zod from "zod";
/** The context a request may send: up to 20 earlier posts, oldest first. */
declare const MODERATION_CONTEXT_SCHEMA: zod.ZodObject<{
  items: zod.ZodArray<zod.ZodObject<{
    text: zod.ZodString;
    authorId: zod.ZodOptional<zod.ZodString>;
  }, zod.core.$strict>>;
}, zod.core.$strict>;
type ModerationContext = zod.infer<typeof MODERATION_CONTEXT_SCHEMA>;
export { ModerationContext as t };