import "./Asset-CL_A7uwL.js";
import { i as EventFacts, o as EventType } from "./EventCatalog-s-bZ7p6b.js";
import "./Page-Bpd8G-D0.js";
import * as zod from "zod";
//#region packages/shared/src/Event.d.ts
declare const EVENT_ASSET_SCHEMA: zod.ZodObject<{
  id: zod.ZodString;
  externalId: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
  processing: zod.ZodObject<{
    status: zod.ZodEnum<{
      done: "done";
      failed: "failed";
      processing: "processing";
      uploading: "uploading";
    }>;
  }, zod.core.$strip>;
  moderation: zod.ZodObject<{
    status: zod.ZodEnum<{
      approved: "approved";
      pending: "pending";
      rejected: "rejected";
    }>;
    action: zod.ZodNullable<zod.ZodEnum<{
      alert: "alert";
      hide: "hide";
      purge: "purge";
    }>>;
  }, zod.core.$strip>;
  content: zod.ZodObject<{
    status: zod.ZodEnum<{
      removed: "removed";
      stored: "stored";
      temporary: "temporary";
    }>;
  }, zod.core.$strip>;
}, zod.core.$strip>;
type EventAsset = zod.infer<typeof EVENT_ASSET_SCHEMA>;
declare const EVENT_SCHEMA: zod.ZodObject<{
  id: zod.ZodString;
  projectId: zod.ZodString;
  userId: zod.ZodOptional<zod.ZodNullable<zod.ZodPipe<zod.ZodString, zod.ZodTransform<string, string>>>>;
  type: zod.ZodEnum<{
    "api-key.created": "api-key.created";
    "api-key.revoked": "api-key.revoked";
    "appeal.resolved": "appeal.resolved";
    "appeal.submitted": "appeal.submitted";
    "asset.approved": "asset.approved";
    "asset.content-removed": "asset.content-removed";
    "asset.deleted": "asset.deleted";
    "asset.failed": "asset.failed";
    "asset.flagged": "asset.flagged";
    "asset.rejected": "asset.rejected";
    "asset.retried": "asset.retried";
    "asset.review-requested": "asset.review-requested";
    "asset.uploaded": "asset.uploaded";
    "connector.failing": "connector.failing";
    "project.invitation-sent": "project.invitation-sent";
    "project.member-joined": "project.member-joined";
    "project.member-removed": "project.member-removed";
    "project.member-role-changed": "project.member-role-changed";
    "upload-preset.daily-limit-reached": "upload-preset.daily-limit-reached";
    "usage.limit-reached": "usage.limit-reached";
    "usage.spend-limit-reached": "usage.spend-limit-reached";
  }>;
  severity: zod.ZodEnum<{
    high: "high";
    low: "low";
  }>;
  title: zod.ZodPipe<zod.ZodString, zod.ZodTransform<string, string>>;
  description: zod.ZodOptional<zod.ZodNullable<zod.ZodPipe<zod.ZodString, zod.ZodTransform<string, string>>>>;
  assetId: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
  asset: zod.ZodOptional<zod.ZodNullable<zod.ZodObject<{
    id: zod.ZodString;
    externalId: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
    processing: zod.ZodObject<{
      status: zod.ZodEnum<{
        done: "done";
        failed: "failed";
        processing: "processing";
        uploading: "uploading";
      }>;
    }, zod.core.$strip>;
    moderation: zod.ZodObject<{
      status: zod.ZodEnum<{
        approved: "approved";
        pending: "pending";
        rejected: "rejected";
      }>;
      action: zod.ZodNullable<zod.ZodEnum<{
        alert: "alert";
        hide: "hide";
        purge: "purge";
      }>>;
    }, zod.core.$strip>;
    content: zod.ZodObject<{
      status: zod.ZodEnum<{
        removed: "removed";
        stored: "stored";
        temporary: "temporary";
      }>;
    }, zod.core.$strip>;
  }, zod.core.$strip>>>;
  facts: zod.ZodArray<zod.ZodObject<{
    key: zod.ZodString;
    value: zod.ZodUnknown & zod.ZodType<{} | null, unknown, zod.core.$ZodTypeInternals<{} | null, unknown>>;
    url: zod.ZodOptional<zod.ZodString>;
  }, zod.core.$strict>>;
  notify: zod.ZodOptional<zod.ZodNullable<zod.ZodBoolean>>;
  createdAt: zod.ZodNumber;
  updatedAt: zod.ZodOptional<zod.ZodNumber>;
  readAt: zod.ZodOptional<zod.ZodNullable<zod.ZodNumber>>;
}, zod.core.$strict>;
type Event = zod.infer<typeof EVENT_SCHEMA>;
/** `Event` narrowed by `type`, with typed `facts`. */
type TypedEvent = { [TType in EventType]: Omit<Event, "type" | "facts"> & {
  type: TType;
  facts: EventFacts<TType>;
}; }[EventType];
//#endregion
export { EventAsset as n, TypedEvent as r, Event as t };