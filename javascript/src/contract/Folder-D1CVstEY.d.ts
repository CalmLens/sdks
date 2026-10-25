import * as zod from "zod";
declare const FOLDER_SCHEMA: zod.ZodObject<{
  id: zod.ZodString;
  projectId: zod.ZodString;
  parentId: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
  name: zod.ZodString;
  createdAt: zod.ZodNumber;
  updatedAt: zod.ZodOptional<zod.ZodNumber>;
}, zod.core.$strip>;
type Folder = zod.infer<typeof FOLDER_SCHEMA>;
export { Folder as t };