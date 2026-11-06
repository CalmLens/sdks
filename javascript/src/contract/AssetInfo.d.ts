import "./Classification-Q5zGpR8l.js";
import "./Asset-9P59rDu0.js";
import * as zod from "zod";
/**
 * What the CDN's `/info` resource returns: an allowlist of the public `Asset`, with its field names
 * and nesting, plus the viewer's `availability`. It is a pick, so fields added to `Asset` never
 * reach it: no moderation, metadata, names, tags or extracted text. A website's `externalUrl` is
 * its page, which the viewer links to; `content.format` tells a spreadsheet from other documents.
 */
declare const ASSET_INFO_SCHEMA: zod.ZodObject<{
  id: zod.ZodString;
  projectId: zod.ZodString;
  externalUrl: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
  type: zod.ZodEnum<{
    audio: "audio";
    file: "file";
    image: "image";
    "multimedia-document": "multimedia-document";
    "plaintext-document": "plaintext-document";
    video: "video";
    website: "website";
  }>;
  content: zod.ZodObject<{
    format: zod.ZodNullable<zod.ZodString>;
    width: zod.ZodNullable<zod.ZodNumber>;
    height: zod.ZodNullable<zod.ZodNumber>;
    durationSeconds: zod.ZodNullable<zod.ZodNumber>;
    pageCount: zod.ZodNullable<zod.ZodNumber>;
    rendered: zod.ZodNullable<zod.ZodObject<{
      kind: zod.ZodEnum<{
        audio: "audio";
        image: "image";
        pdf: "pdf";
        video: "video";
      }>;
      format: zod.ZodString;
      width: zod.ZodNullable<zod.ZodNumber>;
      height: zod.ZodNullable<zod.ZodNumber>;
      peaks: zod.ZodOptional<zod.ZodArray<zod.ZodNumber>>;
    }, zod.core.$strip>>;
    hls: zod.ZodNullable<zod.ZodObject<{
      renditions: zod.ZodArray<zod.ZodObject<{
        kind: zod.ZodEnum<{
          audio: "audio";
          video: "video";
        }>;
        width: zod.ZodNullable<zod.ZodNumber>;
        height: zod.ZodNullable<zod.ZodNumber>;
        bandwidth: zod.ZodNumber;
        codecs: zod.ZodString;
      }, zod.core.$strip>>;
    }, zod.core.$strip>>;
    preview: zod.ZodNullable<zod.ZodObject<{
      width: zod.ZodNullable<zod.ZodNumber>;
      height: zod.ZodNullable<zod.ZodNumber>;
      thumbhash: zod.ZodNullable<zod.ZodPipe<zod.ZodString, zod.ZodTransform<string, string>>>;
      averageColor: zod.ZodNullable<zod.ZodPipe<zod.ZodString, zod.ZodTransform<string, string>>>;
    }, zod.core.$strip>>;
  }, zod.core.$strip>;
  availability: zod.ZodEnum<{
    "age-restricted": "age-restricted";
    available: "available";
    unavailable: "unavailable";
  }>;
}, zod.core.$strip>;
type AssetInfo = zod.infer<typeof ASSET_INFO_SCHEMA>;
export type { AssetInfo };