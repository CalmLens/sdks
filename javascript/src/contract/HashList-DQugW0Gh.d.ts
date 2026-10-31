import * as zod from "zod";
declare const HASH_LIST_SCHEMA: zod.ZodObject<{
  id: zod.ZodString;
  projectId: zod.ZodString;
  name: zod.ZodPipe<zod.ZodString, zod.ZodTransform<string, string>>;
  description: zod.ZodOptional<zod.ZodNullable<zod.ZodPipe<zod.ZodString, zod.ZodTransform<string, string>>>>;
  action: zod.ZodEnum<{
    block: "block";
    flag: "flag";
  }>;
  createdAt: zod.ZodNumber;
  updatedAt: zod.ZodOptional<zod.ZodNumber>;
}, zod.core.$strip>;
type HashList = zod.infer<typeof HASH_LIST_SCHEMA>;
declare const HASH_LIST_ENTRY_SCHEMA: zod.ZodObject<{
  id: zod.ZodString;
  projectId: zod.ZodString;
  hashListId: zod.ZodString;
  hash: zod.ZodString;
  quality: zod.ZodNullable<zod.ZodNumber>;
  label: zod.ZodOptional<zod.ZodNullable<zod.ZodPipe<zod.ZodString, zod.ZodTransform<string, string>>>>;
  sourceAssetId: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
  createdAt: zod.ZodNumber;
}, zod.core.$strip>;
type HashListEntry = zod.infer<typeof HASH_LIST_ENTRY_SCHEMA>;
export { HashListEntry as n, HashList as t };