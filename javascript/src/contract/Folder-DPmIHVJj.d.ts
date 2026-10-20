import * as zod from "zod";
//#region packages/shared/src/Folder.d.ts
declare const FOLDER_SCHEMA: zod.ZodObject<{
  id: zod.ZodString;
  projectId: zod.ZodString;
  parentId: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
  name: zod.ZodString;
  createdAt: zod.ZodNumber;
  updatedAt: zod.ZodOptional<zod.ZodNumber>;
}, zod.core.$strip>;
type Folder = zod.infer<typeof FOLDER_SCHEMA>;
//#endregion
export { Folder as t };