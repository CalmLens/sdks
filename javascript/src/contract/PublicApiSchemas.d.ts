import "./Asset-DjACmrnx.js";
import "./AssetPayload-BpPkhqVM.js";
import { n as HashListEntry, t as HashList } from "./HashList-CKW9itTf.js";
import { t as Folder } from "./Folder-D1CVstEY.js";
import "./EventCatalog-DAVzR6RB.js";
import { t as CursorPage } from "./Page-DNdKkX2B.js";
import { r as TypedEvent } from "./Event-C-AqH_iD.js";
import "./Lens-DM7EOzP8.js";
import "./PublicErrorCodes-DWjlxEgq.js";
import * as zod from "zod";
declare const GET_FOLDERS_QUERY_SCHEMA: zod.ZodObject<{
  parentId: zod.ZodOptional<zod.ZodString>;
  cursor: zod.ZodOptional<zod.ZodString>;
  pageSize: zod.ZodDefault<zod.ZodNumber>;
  ordering: zod.ZodOptional<zod.ZodArray<zod.ZodObject<{
    direction: zod.ZodEnum<{
      asc: "asc";
      desc: "desc";
    }>;
    field: zod.ZodEnum<{
      createdAt: "createdAt";
      name: "name";
    }>;
  }, zod.core.$strip>>>;
  search: zod.ZodOptional<zod.ZodString>;
}, zod.core.$strip>;
type GetFoldersQuery = Partial<zod.input<typeof GET_FOLDERS_QUERY_SCHEMA>>;
type GetFoldersResponse = CursorPage<Folder> & {
  ancestors: Folder[];
};
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
      asc: "asc";
      desc: "desc";
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
      asc: "asc";
      desc: "desc";
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
/** A reviewer's decision on an asset: the status to set, why, and confirmation before purging. */
declare const POST_ASSET_DECISION_BODY_SCHEMA: zod.ZodDiscriminatedUnion<[zod.ZodObject<{
  decision: zod.ZodEnum<{
    "age-restricted": "age-restricted";
    allowed: "allowed";
    blocked: "blocked";
    limited: "limited";
  }>;
  note: zod.ZodString;
}, zod.core.$strip>, zod.ZodObject<{
  decision: zod.ZodLiteral<"purged">;
  note: zod.ZodString;
  confirmPurge: zod.ZodLiteral<true>;
}, zod.core.$strip>], "decision">;
type PostAssetDecisionBody = zod.infer<typeof POST_ASSET_DECISION_BODY_SCHEMA>;
declare const ASSET_BATCH_OPERATIONS: readonly ["delete", "remove-content"];
type AssetBatchOperation = (typeof ASSET_BATCH_OPERATIONS)[number];
declare const POST_ASSET_BATCH_OPERATION_RESPONSE_SCHEMA: zod.ZodObject<{
  queued: zod.ZodLiteral<true>;
}, zod.core.$strip>;
type PostAssetBatchOperationResponse = zod.infer<typeof POST_ASSET_BATCH_OPERATION_RESPONSE_SCHEMA>;
declare const GET_EVENTS_QUERY_SCHEMA: zod.ZodObject<{
  cursor: zod.ZodOptional<zod.ZodString>;
  pageSize: zod.ZodDefault<zod.ZodNumber>;
}, zod.core.$strip>;
type GetEventsQuery = zod.input<typeof GET_EVENTS_QUERY_SCHEMA>;
type GetEventsResponse = {
  items: TypedEvent[];
  nextCursor: string;
  hasMore: boolean;
};
type GetHashListsResponse = CursorPage<HashList>;
declare const POST_HASH_LIST_BODY_SCHEMA: zod.ZodObject<{
  name: zod.ZodPipe<zod.ZodString, zod.ZodTransform<string, string>>;
  description: zod.ZodOptional<zod.ZodNullable<zod.ZodPipe<zod.ZodString, zod.ZodTransform<string, string>>>>;
  action: zod.ZodEnum<{
    block: "block";
    flag: "flag";
  }>;
}, zod.core.$strip>;
type PostHashListBody = zod.infer<typeof POST_HASH_LIST_BODY_SCHEMA>;
declare const PATCH_HASH_LIST_BODY_SCHEMA: zod.ZodObject<{
  name: zod.ZodOptional<zod.ZodPipe<zod.ZodString, zod.ZodTransform<string, string>>>;
  description: zod.ZodOptional<zod.ZodOptional<zod.ZodNullable<zod.ZodPipe<zod.ZodString, zod.ZodTransform<string, string>>>>>;
  action: zod.ZodOptional<zod.ZodEnum<{
    block: "block";
    flag: "flag";
  }>>;
}, zod.core.$strip>;
type PatchHashListBody = zod.infer<typeof PATCH_HASH_LIST_BODY_SCHEMA>;
type GetHashListEntriesResponse = CursorPage<HashListEntry>;
declare const POST_HASH_LIST_ENTRY_BODY_SCHEMA: zod.ZodObject<{
  hash: zod.ZodOptional<zod.ZodString>;
  quality: zod.ZodOptional<zod.ZodNullable<zod.ZodNumber>>;
  assetId: zod.ZodOptional<zod.ZodString>;
  label: zod.ZodOptional<zod.ZodNullable<zod.ZodPipe<zod.ZodString, zod.ZodTransform<string, string>>>>;
}, zod.core.$strip>;
type PostHashListEntryBody = zod.infer<typeof POST_HASH_LIST_ENTRY_BODY_SCHEMA>;
export type { AssetBatchOperation, GetAssetChildrenQuery, GetAssetsPageQuery, GetEventsQuery, GetEventsResponse, GetFoldersQuery, GetFoldersResponse, GetHashListEntriesResponse, GetHashListsResponse, PatchAssetBody, PatchFolderBody, PatchHashListBody, PostAssetBatchOperationResponse, PostAssetDecisionBody, PostAssetSignedUrlResponse, PostFolderBody, PostHashListBody, PostHashListEntryBody };