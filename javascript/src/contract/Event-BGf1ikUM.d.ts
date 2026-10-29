import "./Asset-DSK-5Da0.js";
import { i as EventFacts, o as EventType } from "./EventCatalog-pe_QYTei.js";
import "./Page-CHCx12S3.js";
import * as zod from "zod";
declare const EVENT_ASSET_SCHEMA: zod.ZodObject<{
  id: zod.ZodString;
  externalId: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
  uploadPresetId: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
  upload: zod.ZodObject<{
    status: zod.ZodEnum<{
      completed: "completed";
      uploading: "uploading";
    }>;
  }, zod.core.$strip>;
  classification: zod.ZodObject<{
    status: zod.ZodEnum<{
      completed: "completed";
      failed: "failed";
      pending: "pending";
      processing: "processing";
    }>;
    moderation: zod.ZodObject<{
      status: zod.ZodEnum<{
        "age-restricted": "age-restricted";
        allowed: "allowed";
        blocked: "blocked";
        limited: "limited";
        pending: "pending";
        purged: "purged";
      }>;
    }, zod.core.$strip>;
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
    "asset.age-restricted": "asset.age-restricted";
    "asset.allowed": "asset.allowed";
    "asset.blocked": "asset.blocked";
    "asset.classified": "asset.classified";
    "asset.content-removed": "asset.content-removed";
    "asset.deleted": "asset.deleted";
    "asset.failed": "asset.failed";
    "asset.hash-matched": "asset.hash-matched";
    "asset.limited": "asset.limited";
    "asset.purged": "asset.purged";
    "asset.region-restricted": "asset.region-restricted";
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
    uploadPresetId: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
    upload: zod.ZodObject<{
      status: zod.ZodEnum<{
        completed: "completed";
        uploading: "uploading";
      }>;
    }, zod.core.$strip>;
    classification: zod.ZodObject<{
      status: zod.ZodEnum<{
        completed: "completed";
        failed: "failed";
        pending: "pending";
        processing: "processing";
      }>;
      moderation: zod.ZodObject<{
        status: zod.ZodEnum<{
          "age-restricted": "age-restricted";
          allowed: "allowed";
          blocked: "blocked";
          limited: "limited";
          pending: "pending";
          purged: "purged";
        }>;
      }, zod.core.$strip>;
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
export { EventAsset as n, TypedEvent as r, Event as t };