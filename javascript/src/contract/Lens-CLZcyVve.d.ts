import * as zod from "zod";
declare const LENS_TYPE_SCHEMA: zod.ZodEnum<{
  audio: "audio";
  document: "document";
  image: "image";
  video: "video";
  website: "website";
}>;
type LensType = zod.infer<typeof LENS_TYPE_SCHEMA>;
/**
 * A lens as the public API returns it: without the account that created it, which only the portal
 * shows, and without its version, which the CDN keeps for itself.
 */
declare const PUBLIC_LENS_SCHEMA: zod.ZodObject<{
  id: zod.ZodString;
  projectId: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
  identifier: zod.ZodString;
  name: zod.ZodPipe<zod.ZodString, zod.ZodTransform<string, string>>;
  description: zod.ZodOptional<zod.ZodNullable<zod.ZodPipe<zod.ZodString, zod.ZodTransform<string, string>>>>;
  type: zod.ZodEnum<{
    audio: "audio";
    document: "document";
    image: "image";
    video: "video";
    website: "website";
  }>;
  active: zod.ZodBoolean;
  transform: zod.ZodOptional<zod.ZodNullable<zod.ZodRecord<zod.ZodString, zod.ZodUnknown>>>;
  createdAt: zod.ZodNumber;
  updatedAt: zod.ZodOptional<zod.ZodNumber>;
}, zod.core.$strip>;
export { PUBLIC_LENS_SCHEMA as n, LensType as t };