import "./Asset-DWJlQPyb.js";
import "./AssetPayload-CqMF2R4w.js";
import "./Folder-DPmIHVJj.js";
import "./EventCatalog-s-bZ7p6b.js";
import "./Page-Bpd8G-D0.js";
import { r as TypedEvent } from "./Event-kf1LI_8B.js";
import "./Lens-yZlVGaQR.js";
import "./PublicErrorCodes-Cp74INbA.js";
import * as zod from "zod";
//#region packages/shared/src/PublicApiSchemas.d.ts
declare const POST_FOLDER_BODY_SCHEMA: zod.ZodObject<{
  name: zod.ZodString;
  parentId: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
}, zod.core.$strip>;
type PostFolderBody = zod.infer<typeof POST_FOLDER_BODY_SCHEMA>;
declare const PATCH_FOLDER_BODY_SCHEMA: zod.ZodObject<{
  name: zod.ZodOptional<zod.ZodString>;
}, zod.core.$strip>;
type PatchFolderBody = zod.infer<typeof PATCH_FOLDER_BODY_SCHEMA>;
declare const GET_ASSETS_PAGE_QUERY_SCHEMA: zod.ZodObject<{
  cursor: zod.ZodOptional<zod.ZodString>;
  pageSize: zod.ZodOptional<zod.ZodNumber>;
  ordering: zod.ZodOptional<zod.ZodArray<zod.ZodObject<{
    direction: zod.ZodEnum<{
      ASC: "ASC";
      DESC: "DESC";
    }>;
    field: zod.ZodEnum<{
      createdAt: "createdAt";
      id: "id";
    }>;
  }, zod.core.$strip>>>;
  filter: zod.ZodOptional<zod.ZodNullable<zod.ZodPipe<zod.ZodString, zod.ZodTransform<string, string>>>>;
  folderId: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
}, zod.core.$strict>;
type GetAssetsPageQuery = zod.infer<typeof GET_ASSETS_PAGE_QUERY_SCHEMA>;
declare const GET_ASSET_CHILDREN_QUERY_SCHEMA: zod.ZodObject<{
  cursor: zod.ZodOptional<zod.ZodString>;
  pageSize: zod.ZodOptional<zod.ZodNumber>;
  ordering: zod.ZodOptional<zod.ZodArray<zod.ZodObject<{
    direction: zod.ZodEnum<{
      ASC: "ASC";
      DESC: "DESC";
    }>;
    field: zod.ZodEnum<{
      createdAt: "createdAt";
      id: "id";
    }>;
  }, zod.core.$strip>>>;
}, zod.core.$strict>;
type GetAssetChildrenQuery = zod.infer<typeof GET_ASSET_CHILDREN_QUERY_SCHEMA>;
declare const POST_ASSET_SIGNED_URL_RESPONSE_SCHEMA: zod.ZodObject<{
  url: zod.ZodString;
  expiresAt: zod.ZodNumber;
}, zod.core.$strip>;
type PostAssetSignedUrlResponse = zod.infer<typeof POST_ASSET_SIGNED_URL_RESPONSE_SCHEMA>;
declare const PATCH_ASSET_BODY_SCHEMA: zod.ZodObject<{
  name: zod.ZodOptional<zod.ZodPipe<zod.ZodString, zod.ZodTransform<string, string>>>;
  description: zod.ZodOptional<zod.ZodOptional<zod.ZodNullable<zod.ZodPipe<zod.ZodString, zod.ZodTransform<string, string>>>>>;
  externalId: zod.ZodOptional<zod.ZodOptional<zod.ZodNullable<zod.ZodPipe<zod.ZodString, zod.ZodTransform<string, string>>>>>;
  externalUrl: zod.ZodOptional<zod.ZodOptional<zod.ZodNullable<zod.ZodString>>>;
  metadata: zod.ZodOptional<zod.ZodOptional<zod.ZodNullable<zod.ZodArray<zod.ZodObject<{
    id: zod.ZodPipe<zod.ZodString, zod.ZodTransform<string, string>>;
    value: zod.ZodJSONSchema;
  }, zod.core.$strip>>>>>;
  tags: zod.ZodOptional<zod.ZodOptional<zod.ZodNullable<zod.ZodArray<zod.ZodPipe<zod.ZodString, zod.ZodTransform<string, string>>>>>>;
  visibility: zod.ZodOptional<zod.ZodOptional<zod.ZodNullable<zod.ZodEnum<{
    private: "private";
    public: "public";
  }>>>>;
}, zod.core.$strip>;
type PatchAssetBody = zod.infer<typeof PATCH_ASSET_BODY_SCHEMA>;
declare const GET_EVENTS_QUERY_SCHEMA: zod.ZodObject<{
  after: zod.ZodOptional<zod.ZodString>;
  limit: zod.ZodDefault<zod.ZodNumber>;
}, zod.core.$strip>;
type GetEventsQuery = zod.input<typeof GET_EVENTS_QUERY_SCHEMA>;
type GetEventsResponse = {
  events: TypedEvent[];
  cursor: string;
  hasMore: boolean;
};
//#endregion
export type { GetAssetChildrenQuery, GetAssetsPageQuery, GetEventsQuery, GetEventsResponse, PatchAssetBody, PatchFolderBody, PostAssetSignedUrlResponse, PostFolderBody };