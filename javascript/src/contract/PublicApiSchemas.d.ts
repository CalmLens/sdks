import "./Asset-BqphUUaD.js";
import "./AssetPayload-CqMF2R4w.js";
import "./Folder-DPmIHVJj.js";
import "./EventCatalog-s-bZ7p6b.js";
import "./Page-Bpd8G-D0.js";
import { r as TypedEvent } from "./Event-_2sh6-Yk.js";
import "./Lens-yZlVGaQR.js";
import "./PublicErrorCodes-Cp74INbA.js";
import * as zod from "zod";
//#region packages/shared/src/PublicApiSchemas.d.ts
declare const GET_FOLDERS_QUERY_SCHEMA: zod.ZodObject<{
  parentId: zod.ZodOptional<zod.ZodString>;
  pageSize: zod.ZodDefault<zod.ZodCoercedNumber<unknown>>;
  sort: zod.ZodDefault<zod.ZodEnum<{
    createdAt: "createdAt";
    name: "name";
  }>>;
  direction: zod.ZodDefault<zod.ZodEnum<{
    ASC: "ASC";
    DESC: "DESC";
  }>>;
  pageIndex: zod.ZodDefault<zod.ZodCoercedNumber<unknown>>;
  search: zod.ZodOptional<zod.ZodString>;
  searchAll: zod.ZodPreprocess<zod.ZodOptional<zod.ZodCoercedBoolean<unknown>>, unknown>;
  ids: zod.ZodDefault<zod.ZodArray<zod.ZodString>>;
  resolveOnly: zod.ZodPreprocess<zod.ZodOptional<zod.ZodCoercedBoolean<unknown>>, unknown>;
}, zod.core.$strip>;
type GetFoldersQuery = Partial<zod.infer<typeof GET_FOLDERS_QUERY_SCHEMA>>;
declare const GET_FOLDERS_RESPONSE_SCHEMA: zod.ZodObject<{
  folders: zod.ZodArray<zod.ZodObject<{
    id: zod.ZodString;
    projectId: zod.ZodString;
    parentId: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
    name: zod.ZodString;
    createdAt: zod.ZodNumber;
    updatedAt: zod.ZodOptional<zod.ZodNumber>;
  }, zod.core.$strip>>;
  ancestors: zod.ZodArray<zod.ZodObject<{
    id: zod.ZodString;
    projectId: zod.ZodString;
    parentId: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
    name: zod.ZodString;
    createdAt: zod.ZodNumber;
    updatedAt: zod.ZodOptional<zod.ZodNumber>;
  }, zod.core.$strip>>;
  hasMore: zod.ZodBoolean;
}, zod.core.$strip>;
type GetFoldersResponse = zod.infer<typeof GET_FOLDERS_RESPONSE_SCHEMA>;
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
export type { GetAssetChildrenQuery, GetAssetsPageQuery, GetEventsQuery, GetEventsResponse, GetFoldersQuery, GetFoldersResponse, PatchAssetBody, PatchFolderBody, PostAssetSignedUrlResponse, PostFolderBody };