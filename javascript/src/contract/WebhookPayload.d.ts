import { i as EventFacts, o as EventType } from "./EventCatalog-s-bZ7p6b.js";
import { t as Event } from "./Event-kf1LI_8B.js";
import * as zod from "zod";
//#region packages/shared/src/WebhookPayload.d.ts
export declare const WEBHOOK_DELIVERY_HEADER = "x-calmlens-delivery";
export declare const WEBHOOK_TIMESTAMP_HEADER = "x-calmlens-timestamp";
export declare const WEBHOOK_SIGNATURE_HEADER = "x-calmlens-signature";
/** Receivers reject deliveries whose timestamp is further than this from their clock. */
export declare const WEBHOOK_SIGNATURE_TOLERANCE_SECONDS = 300;
declare const WEBHOOK_EVENT_DATA_SCHEMA: zod.ZodObject<{
  severity: zod.ZodEnum<{
    high: "high";
    low: "low";
  }>;
  title: zod.ZodString;
  description: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
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
}, zod.core.$strict>;
/** The webhook body, discriminated by `type`: `data.facts` is typed per event type. */
export declare const WEBHOOK_EVENT_PAYLOAD_SCHEMA: zod.ZodDiscriminatedUnion<[zod.ZodObject<{
  id: zod.ZodString;
  type: zod.ZodLiteral<"api-key.created" | "api-key.revoked" | "appeal.resolved" | "appeal.submitted" | "asset.approved" | "asset.content-removed" | "asset.deleted" | "asset.failed" | "asset.flagged" | "asset.rejected" | "asset.retried" | "asset.review-requested" | "asset.uploaded" | "connector.failing" | "project.invitation-sent" | "project.member-joined" | "project.member-removed" | "project.member-role-changed" | "upload-preset.daily-limit-reached" | "usage.limit-reached" | "usage.spend-limit-reached">;
  createdAt: zod.ZodNumber;
  projectId: zod.ZodString;
  data: zod.ZodObject<{
    severity: zod.ZodEnum<{
      high: "high";
      low: "low";
    }>;
    title: zod.ZodString;
    description: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
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
    facts: zod.ZodType<EventFacts<"api-key.created">, unknown, zod.core.$ZodTypeInternals<EventFacts<"api-key.created">, unknown>> | zod.ZodType<EventFacts<"api-key.revoked">, unknown, zod.core.$ZodTypeInternals<EventFacts<"api-key.revoked">, unknown>> | zod.ZodType<EventFacts<"appeal.resolved">, unknown, zod.core.$ZodTypeInternals<EventFacts<"appeal.resolved">, unknown>> | zod.ZodType<EventFacts<"appeal.submitted">, unknown, zod.core.$ZodTypeInternals<EventFacts<"appeal.submitted">, unknown>> | zod.ZodType<EventFacts<"asset.approved">, unknown, zod.core.$ZodTypeInternals<EventFacts<"asset.approved">, unknown>> | zod.ZodType<EventFacts<"asset.content-removed">, unknown, zod.core.$ZodTypeInternals<EventFacts<"asset.content-removed">, unknown>> | zod.ZodType<EventFacts<"asset.deleted">, unknown, zod.core.$ZodTypeInternals<EventFacts<"asset.deleted">, unknown>> | zod.ZodType<EventFacts<"asset.failed">, unknown, zod.core.$ZodTypeInternals<EventFacts<"asset.failed">, unknown>> | zod.ZodType<EventFacts<"asset.flagged">, unknown, zod.core.$ZodTypeInternals<EventFacts<"asset.flagged">, unknown>> | zod.ZodType<EventFacts<"asset.rejected">, unknown, zod.core.$ZodTypeInternals<EventFacts<"asset.rejected">, unknown>> | zod.ZodType<EventFacts<"asset.retried">, unknown, zod.core.$ZodTypeInternals<EventFacts<"asset.retried">, unknown>> | zod.ZodType<EventFacts<"asset.review-requested">, unknown, zod.core.$ZodTypeInternals<EventFacts<"asset.review-requested">, unknown>> | zod.ZodType<EventFacts<"asset.uploaded">, unknown, zod.core.$ZodTypeInternals<EventFacts<"asset.uploaded">, unknown>> | zod.ZodType<EventFacts<"connector.failing">, unknown, zod.core.$ZodTypeInternals<EventFacts<"connector.failing">, unknown>> | zod.ZodType<EventFacts<"project.invitation-sent">, unknown, zod.core.$ZodTypeInternals<EventFacts<"project.invitation-sent">, unknown>> | zod.ZodType<EventFacts<"project.member-joined">, unknown, zod.core.$ZodTypeInternals<EventFacts<"project.member-joined">, unknown>> | zod.ZodType<EventFacts<"project.member-removed">, unknown, zod.core.$ZodTypeInternals<EventFacts<"project.member-removed">, unknown>> | zod.ZodType<EventFacts<"project.member-role-changed">, unknown, zod.core.$ZodTypeInternals<EventFacts<"project.member-role-changed">, unknown>> | zod.ZodType<EventFacts<"upload-preset.daily-limit-reached">, unknown, zod.core.$ZodTypeInternals<EventFacts<"upload-preset.daily-limit-reached">, unknown>> | zod.ZodType<EventFacts<"usage.limit-reached">, unknown, zod.core.$ZodTypeInternals<EventFacts<"usage.limit-reached">, unknown>> | zod.ZodType<EventFacts<"usage.spend-limit-reached">, unknown, zod.core.$ZodTypeInternals<EventFacts<"usage.spend-limit-reached">, unknown>>;
  }, zod.core.$strict>;
}, zod.core.$strict>, ...zod.ZodObject<{
  id: zod.ZodString;
  type: zod.ZodLiteral<"api-key.created" | "api-key.revoked" | "appeal.resolved" | "appeal.submitted" | "asset.approved" | "asset.content-removed" | "asset.deleted" | "asset.failed" | "asset.flagged" | "asset.rejected" | "asset.retried" | "asset.review-requested" | "asset.uploaded" | "connector.failing" | "project.invitation-sent" | "project.member-joined" | "project.member-removed" | "project.member-role-changed" | "upload-preset.daily-limit-reached" | "usage.limit-reached" | "usage.spend-limit-reached">;
  createdAt: zod.ZodNumber;
  projectId: zod.ZodString;
  data: zod.ZodObject<{
    severity: zod.ZodEnum<{
      high: "high";
      low: "low";
    }>;
    title: zod.ZodString;
    description: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
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
    facts: zod.ZodType<EventFacts<"api-key.created">, unknown, zod.core.$ZodTypeInternals<EventFacts<"api-key.created">, unknown>> | zod.ZodType<EventFacts<"api-key.revoked">, unknown, zod.core.$ZodTypeInternals<EventFacts<"api-key.revoked">, unknown>> | zod.ZodType<EventFacts<"appeal.resolved">, unknown, zod.core.$ZodTypeInternals<EventFacts<"appeal.resolved">, unknown>> | zod.ZodType<EventFacts<"appeal.submitted">, unknown, zod.core.$ZodTypeInternals<EventFacts<"appeal.submitted">, unknown>> | zod.ZodType<EventFacts<"asset.approved">, unknown, zod.core.$ZodTypeInternals<EventFacts<"asset.approved">, unknown>> | zod.ZodType<EventFacts<"asset.content-removed">, unknown, zod.core.$ZodTypeInternals<EventFacts<"asset.content-removed">, unknown>> | zod.ZodType<EventFacts<"asset.deleted">, unknown, zod.core.$ZodTypeInternals<EventFacts<"asset.deleted">, unknown>> | zod.ZodType<EventFacts<"asset.failed">, unknown, zod.core.$ZodTypeInternals<EventFacts<"asset.failed">, unknown>> | zod.ZodType<EventFacts<"asset.flagged">, unknown, zod.core.$ZodTypeInternals<EventFacts<"asset.flagged">, unknown>> | zod.ZodType<EventFacts<"asset.rejected">, unknown, zod.core.$ZodTypeInternals<EventFacts<"asset.rejected">, unknown>> | zod.ZodType<EventFacts<"asset.retried">, unknown, zod.core.$ZodTypeInternals<EventFacts<"asset.retried">, unknown>> | zod.ZodType<EventFacts<"asset.review-requested">, unknown, zod.core.$ZodTypeInternals<EventFacts<"asset.review-requested">, unknown>> | zod.ZodType<EventFacts<"asset.uploaded">, unknown, zod.core.$ZodTypeInternals<EventFacts<"asset.uploaded">, unknown>> | zod.ZodType<EventFacts<"connector.failing">, unknown, zod.core.$ZodTypeInternals<EventFacts<"connector.failing">, unknown>> | zod.ZodType<EventFacts<"project.invitation-sent">, unknown, zod.core.$ZodTypeInternals<EventFacts<"project.invitation-sent">, unknown>> | zod.ZodType<EventFacts<"project.member-joined">, unknown, zod.core.$ZodTypeInternals<EventFacts<"project.member-joined">, unknown>> | zod.ZodType<EventFacts<"project.member-removed">, unknown, zod.core.$ZodTypeInternals<EventFacts<"project.member-removed">, unknown>> | zod.ZodType<EventFacts<"project.member-role-changed">, unknown, zod.core.$ZodTypeInternals<EventFacts<"project.member-role-changed">, unknown>> | zod.ZodType<EventFacts<"upload-preset.daily-limit-reached">, unknown, zod.core.$ZodTypeInternals<EventFacts<"upload-preset.daily-limit-reached">, unknown>> | zod.ZodType<EventFacts<"usage.limit-reached">, unknown, zod.core.$ZodTypeInternals<EventFacts<"usage.limit-reached">, unknown>> | zod.ZodType<EventFacts<"usage.spend-limit-reached">, unknown, zod.core.$ZodTypeInternals<EventFacts<"usage.spend-limit-reached">, unknown>>;
  }, zod.core.$strict>;
}, zod.core.$strict>[]], "type">;
/** A webhook body; narrow on `type` to get typed `data.facts`. */
type WebhookEventPayload = { [TType in EventType]: {
  id: string;
  type: TType;
  createdAt: number;
  projectId: string;
  data: Omit<zod.infer<typeof WEBHOOK_EVENT_DATA_SCHEMA>, "facts"> & {
    facts: EventFacts<TType>;
  };
}; }[EventType];
export declare const toWebhookEventPayload: (event: Event) => WebhookEventPayload;
/** Headers for one signed delivery of `body`. */
export declare const createWebhookHeaders: (options: {
  secret: string;
  body: string;
  deliveryId: string;
  timestampSeconds?: number;
}) => Promise<Record<string, string>>;
/** Consumer boundary: future event types, facts and fields must not break installed clients. */
declare const RECEIVED_WEBHOOK_EVENT_PAYLOAD_SCHEMA: zod.ZodObject<{
  id: zod.ZodString;
  type: zod.ZodString;
  projectId: zod.ZodString;
  createdAt: zod.ZodOptional<zod.ZodNumber>;
  data: zod.ZodObject<{
    severity: zod.ZodOptional<zod.ZodString>;
    title: zod.ZodOptional<zod.ZodString>;
    description: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
    assetId: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
    asset: zod.ZodOptional<zod.ZodNullable<zod.ZodObject<{
      id: zod.ZodString;
    }, zod.core.$loose>>>;
    facts: zod.ZodOptional<zod.ZodArray<zod.ZodObject<{
      key: zod.ZodString;
      value: zod.ZodUnknown;
      url: zod.ZodOptional<zod.ZodString>;
    }, zod.core.$loose>>>;
  }, zod.core.$loose>;
}, zod.core.$loose>;
type ReceivedWebhookEventPayload = zod.infer<typeof RECEIVED_WEBHOOK_EVENT_PAYLOAD_SCHEMA>;
//#endregion
export type { ReceivedWebhookEventPayload, WebhookEventPayload };