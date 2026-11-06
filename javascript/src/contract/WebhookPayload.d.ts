import { i as Actor, n as EventAsset, r as TypedEvent, t as Event } from "./Event-BiNGUk0n.js";
import { i as EventFacts } from "./EventCatalog-CuR4E_kx.js";
import * as zod from "zod";
export declare const WEBHOOK_DELIVERY_HEADER = "x-calmlens-delivery";
export declare const WEBHOOK_TIMESTAMP_HEADER = "x-calmlens-timestamp";
export declare const WEBHOOK_SIGNATURE_HEADER = "x-calmlens-signature";
/** Receivers reject deliveries whose timestamp is further than this from their clock. */
export declare const WEBHOOK_SIGNATURE_TOLERANCE_SECONDS = 300;
/** The webhook body: the event, exactly as `GET /events` lists it, with `facts` typed by `type`. */
export declare const WEBHOOK_EVENT_PAYLOAD_SCHEMA: zod.ZodDiscriminatedUnion<[zod.ZodObject<{
  id: zod.ZodString;
  projectId: zod.ZodString;
  actor: zod.ZodObject<{
    type: zod.ZodEnum<{
      "api-key": "api-key";
      automated: "automated";
      system: "system";
      user: "user";
    }>;
    id: zod.ZodNullable<zod.ZodString>;
  }, zod.core.$strict>;
  severity: zod.ZodEnum<{
    high: "high";
    low: "low";
  }>;
  title: zod.ZodPipe<zod.ZodString, zod.ZodTransform<string, string>>;
  description: zod.ZodOptional<zod.ZodNullable<zod.ZodPipe<zod.ZodString, zod.ZodTransform<string, string>>>>;
  assetId: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
  assetSequence: zod.ZodOptional<zod.ZodNullable<zod.ZodNumber>>;
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
        processing: "processing";
        queued: "queued";
      }>;
      testInput: zod.ZodBoolean;
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
  createdAt: zod.ZodNumber;
  type: zod.ZodLiteral<"api-key.created" | "api-key.deleted" | "api-key.revoked" | "appeal.resolved" | "appeal.submitted" | "asset.age-restricted" | "asset.allowed" | "asset.blocked" | "asset.classified" | "asset.content-removed" | "asset.deleted" | "asset.failed" | "asset.hash-matched" | "asset.limited" | "asset.link-flagged" | "asset.progress-updated" | "asset.purged" | "asset.region-restricted" | "asset.retried" | "asset.review-requested" | "asset.uploaded" | "connector.disabled" | "project.invitation-sent" | "project.member-joined" | "project.member-left" | "project.member-removed" | "project.member-role-changed" | "project.transferred" | "upload-preset.daily-limit-reached" | "usage.free-uploads-exhausted" | "usage.uploads-paused">;
  facts: zod.ZodType<EventFacts<"api-key.created">, unknown, zod.core.$ZodTypeInternals<EventFacts<"api-key.created">, unknown>> | zod.ZodType<EventFacts<"api-key.deleted">, unknown, zod.core.$ZodTypeInternals<EventFacts<"api-key.deleted">, unknown>> | zod.ZodType<EventFacts<"api-key.revoked">, unknown, zod.core.$ZodTypeInternals<EventFacts<"api-key.revoked">, unknown>> | zod.ZodType<EventFacts<"appeal.resolved">, unknown, zod.core.$ZodTypeInternals<EventFacts<"appeal.resolved">, unknown>> | zod.ZodType<EventFacts<"appeal.submitted">, unknown, zod.core.$ZodTypeInternals<EventFacts<"appeal.submitted">, unknown>> | zod.ZodType<EventFacts<"asset.age-restricted">, unknown, zod.core.$ZodTypeInternals<EventFacts<"asset.age-restricted">, unknown>> | zod.ZodType<EventFacts<"asset.allowed">, unknown, zod.core.$ZodTypeInternals<EventFacts<"asset.allowed">, unknown>> | zod.ZodType<EventFacts<"asset.blocked">, unknown, zod.core.$ZodTypeInternals<EventFacts<"asset.blocked">, unknown>> | zod.ZodType<EventFacts<"asset.classified">, unknown, zod.core.$ZodTypeInternals<EventFacts<"asset.classified">, unknown>> | zod.ZodType<EventFacts<"asset.content-removed">, unknown, zod.core.$ZodTypeInternals<EventFacts<"asset.content-removed">, unknown>> | zod.ZodType<EventFacts<"asset.deleted">, unknown, zod.core.$ZodTypeInternals<EventFacts<"asset.deleted">, unknown>> | zod.ZodType<EventFacts<"asset.failed">, unknown, zod.core.$ZodTypeInternals<EventFacts<"asset.failed">, unknown>> | zod.ZodType<EventFacts<"asset.hash-matched">, unknown, zod.core.$ZodTypeInternals<EventFacts<"asset.hash-matched">, unknown>> | zod.ZodType<EventFacts<"asset.limited">, unknown, zod.core.$ZodTypeInternals<EventFacts<"asset.limited">, unknown>> | zod.ZodType<EventFacts<"asset.link-flagged">, unknown, zod.core.$ZodTypeInternals<EventFacts<"asset.link-flagged">, unknown>> | zod.ZodType<EventFacts<"asset.progress-updated">, unknown, zod.core.$ZodTypeInternals<EventFacts<"asset.progress-updated">, unknown>> | zod.ZodType<EventFacts<"asset.purged">, unknown, zod.core.$ZodTypeInternals<EventFacts<"asset.purged">, unknown>> | zod.ZodType<EventFacts<"asset.region-restricted">, unknown, zod.core.$ZodTypeInternals<EventFacts<"asset.region-restricted">, unknown>> | zod.ZodType<EventFacts<"asset.retried">, unknown, zod.core.$ZodTypeInternals<EventFacts<"asset.retried">, unknown>> | zod.ZodType<EventFacts<"asset.review-requested">, unknown, zod.core.$ZodTypeInternals<EventFacts<"asset.review-requested">, unknown>> | zod.ZodType<EventFacts<"asset.uploaded">, unknown, zod.core.$ZodTypeInternals<EventFacts<"asset.uploaded">, unknown>> | zod.ZodType<EventFacts<"connector.disabled">, unknown, zod.core.$ZodTypeInternals<EventFacts<"connector.disabled">, unknown>> | zod.ZodType<EventFacts<"project.invitation-sent">, unknown, zod.core.$ZodTypeInternals<EventFacts<"project.invitation-sent">, unknown>> | zod.ZodType<EventFacts<"project.member-joined">, unknown, zod.core.$ZodTypeInternals<EventFacts<"project.member-joined">, unknown>> | zod.ZodType<EventFacts<"project.member-left">, unknown, zod.core.$ZodTypeInternals<EventFacts<"project.member-left">, unknown>> | zod.ZodType<EventFacts<"project.member-removed">, unknown, zod.core.$ZodTypeInternals<EventFacts<"project.member-removed">, unknown>> | zod.ZodType<EventFacts<"project.member-role-changed">, unknown, zod.core.$ZodTypeInternals<EventFacts<"project.member-role-changed">, unknown>> | zod.ZodType<EventFacts<"project.transferred">, unknown, zod.core.$ZodTypeInternals<EventFacts<"project.transferred">, unknown>> | zod.ZodType<EventFacts<"upload-preset.daily-limit-reached">, unknown, zod.core.$ZodTypeInternals<EventFacts<"upload-preset.daily-limit-reached">, unknown>> | zod.ZodType<EventFacts<"usage.free-uploads-exhausted">, unknown, zod.core.$ZodTypeInternals<EventFacts<"usage.free-uploads-exhausted">, unknown>> | zod.ZodType<EventFacts<"usage.uploads-paused">, unknown, zod.core.$ZodTypeInternals<EventFacts<"usage.uploads-paused">, unknown>>;
}, zod.core.$strict>, ...zod.ZodObject<{
  id: zod.ZodString;
  projectId: zod.ZodString;
  actor: zod.ZodObject<{
    type: zod.ZodEnum<{
      "api-key": "api-key";
      automated: "automated";
      system: "system";
      user: "user";
    }>;
    id: zod.ZodNullable<zod.ZodString>;
  }, zod.core.$strict>;
  severity: zod.ZodEnum<{
    high: "high";
    low: "low";
  }>;
  title: zod.ZodPipe<zod.ZodString, zod.ZodTransform<string, string>>;
  description: zod.ZodOptional<zod.ZodNullable<zod.ZodPipe<zod.ZodString, zod.ZodTransform<string, string>>>>;
  assetId: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
  assetSequence: zod.ZodOptional<zod.ZodNullable<zod.ZodNumber>>;
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
        processing: "processing";
        queued: "queued";
      }>;
      testInput: zod.ZodBoolean;
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
  createdAt: zod.ZodNumber;
  type: zod.ZodLiteral<"api-key.created" | "api-key.deleted" | "api-key.revoked" | "appeal.resolved" | "appeal.submitted" | "asset.age-restricted" | "asset.allowed" | "asset.blocked" | "asset.classified" | "asset.content-removed" | "asset.deleted" | "asset.failed" | "asset.hash-matched" | "asset.limited" | "asset.link-flagged" | "asset.progress-updated" | "asset.purged" | "asset.region-restricted" | "asset.retried" | "asset.review-requested" | "asset.uploaded" | "connector.disabled" | "project.invitation-sent" | "project.member-joined" | "project.member-left" | "project.member-removed" | "project.member-role-changed" | "project.transferred" | "upload-preset.daily-limit-reached" | "usage.free-uploads-exhausted" | "usage.uploads-paused">;
  facts: zod.ZodType<EventFacts<"api-key.created">, unknown, zod.core.$ZodTypeInternals<EventFacts<"api-key.created">, unknown>> | zod.ZodType<EventFacts<"api-key.deleted">, unknown, zod.core.$ZodTypeInternals<EventFacts<"api-key.deleted">, unknown>> | zod.ZodType<EventFacts<"api-key.revoked">, unknown, zod.core.$ZodTypeInternals<EventFacts<"api-key.revoked">, unknown>> | zod.ZodType<EventFacts<"appeal.resolved">, unknown, zod.core.$ZodTypeInternals<EventFacts<"appeal.resolved">, unknown>> | zod.ZodType<EventFacts<"appeal.submitted">, unknown, zod.core.$ZodTypeInternals<EventFacts<"appeal.submitted">, unknown>> | zod.ZodType<EventFacts<"asset.age-restricted">, unknown, zod.core.$ZodTypeInternals<EventFacts<"asset.age-restricted">, unknown>> | zod.ZodType<EventFacts<"asset.allowed">, unknown, zod.core.$ZodTypeInternals<EventFacts<"asset.allowed">, unknown>> | zod.ZodType<EventFacts<"asset.blocked">, unknown, zod.core.$ZodTypeInternals<EventFacts<"asset.blocked">, unknown>> | zod.ZodType<EventFacts<"asset.classified">, unknown, zod.core.$ZodTypeInternals<EventFacts<"asset.classified">, unknown>> | zod.ZodType<EventFacts<"asset.content-removed">, unknown, zod.core.$ZodTypeInternals<EventFacts<"asset.content-removed">, unknown>> | zod.ZodType<EventFacts<"asset.deleted">, unknown, zod.core.$ZodTypeInternals<EventFacts<"asset.deleted">, unknown>> | zod.ZodType<EventFacts<"asset.failed">, unknown, zod.core.$ZodTypeInternals<EventFacts<"asset.failed">, unknown>> | zod.ZodType<EventFacts<"asset.hash-matched">, unknown, zod.core.$ZodTypeInternals<EventFacts<"asset.hash-matched">, unknown>> | zod.ZodType<EventFacts<"asset.limited">, unknown, zod.core.$ZodTypeInternals<EventFacts<"asset.limited">, unknown>> | zod.ZodType<EventFacts<"asset.link-flagged">, unknown, zod.core.$ZodTypeInternals<EventFacts<"asset.link-flagged">, unknown>> | zod.ZodType<EventFacts<"asset.progress-updated">, unknown, zod.core.$ZodTypeInternals<EventFacts<"asset.progress-updated">, unknown>> | zod.ZodType<EventFacts<"asset.purged">, unknown, zod.core.$ZodTypeInternals<EventFacts<"asset.purged">, unknown>> | zod.ZodType<EventFacts<"asset.region-restricted">, unknown, zod.core.$ZodTypeInternals<EventFacts<"asset.region-restricted">, unknown>> | zod.ZodType<EventFacts<"asset.retried">, unknown, zod.core.$ZodTypeInternals<EventFacts<"asset.retried">, unknown>> | zod.ZodType<EventFacts<"asset.review-requested">, unknown, zod.core.$ZodTypeInternals<EventFacts<"asset.review-requested">, unknown>> | zod.ZodType<EventFacts<"asset.uploaded">, unknown, zod.core.$ZodTypeInternals<EventFacts<"asset.uploaded">, unknown>> | zod.ZodType<EventFacts<"connector.disabled">, unknown, zod.core.$ZodTypeInternals<EventFacts<"connector.disabled">, unknown>> | zod.ZodType<EventFacts<"project.invitation-sent">, unknown, zod.core.$ZodTypeInternals<EventFacts<"project.invitation-sent">, unknown>> | zod.ZodType<EventFacts<"project.member-joined">, unknown, zod.core.$ZodTypeInternals<EventFacts<"project.member-joined">, unknown>> | zod.ZodType<EventFacts<"project.member-left">, unknown, zod.core.$ZodTypeInternals<EventFacts<"project.member-left">, unknown>> | zod.ZodType<EventFacts<"project.member-removed">, unknown, zod.core.$ZodTypeInternals<EventFacts<"project.member-removed">, unknown>> | zod.ZodType<EventFacts<"project.member-role-changed">, unknown, zod.core.$ZodTypeInternals<EventFacts<"project.member-role-changed">, unknown>> | zod.ZodType<EventFacts<"project.transferred">, unknown, zod.core.$ZodTypeInternals<EventFacts<"project.transferred">, unknown>> | zod.ZodType<EventFacts<"upload-preset.daily-limit-reached">, unknown, zod.core.$ZodTypeInternals<EventFacts<"upload-preset.daily-limit-reached">, unknown>> | zod.ZodType<EventFacts<"usage.free-uploads-exhausted">, unknown, zod.core.$ZodTypeInternals<EventFacts<"usage.free-uploads-exhausted">, unknown>> | zod.ZodType<EventFacts<"usage.uploads-paused">, unknown, zod.core.$ZodTypeInternals<EventFacts<"usage.uploads-paused">, unknown>>;
}, zod.core.$strict>[]], "type">;
/** A webhook body; narrow on `type` to get typed `facts`. */
type WebhookEventPayload = TypedEvent;
/** The body CalmLens sends for an event (its public fields; see `toPublicEvent`). */
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
  createdAt: zod.ZodNumber;
  severity: zod.ZodOptional<zod.ZodString>;
  title: zod.ZodOptional<zod.ZodString>;
  description: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
  actor: zod.ZodOptional<zod.ZodObject<{
    type: zod.ZodString;
    id: zod.ZodNullable<zod.ZodString>;
  }, zod.core.$loose>>;
  assetId: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
  assetSequence: zod.ZodOptional<zod.ZodNullable<zod.ZodNumber>>;
  asset: zod.ZodOptional<zod.ZodNullable<zod.ZodObject<{
    id: zod.ZodString;
  }, zod.core.$loose>>>;
  facts: zod.ZodOptional<zod.ZodArray<zod.ZodObject<{
    key: zod.ZodString;
    value: zod.ZodUnknown;
    url: zod.ZodOptional<zod.ZodString>;
  }, zod.core.$loose>>>;
}, zod.core.$loose>;
type ReceivedFact = zod.infer<typeof RECEIVED_WEBHOOK_EVENT_PAYLOAD_SCHEMA>["facts"];
/**
 * The schema only requires what parsing needs, so future fields still parse. The type describes
 * the payload CalmLens sends today, including the asset snapshot; fields added later arrive too,
 * untyped.
 */
interface ReceivedWebhookEventPayload {
  id: string;
  type: string;
  projectId: string;
  createdAt: number;
  severity?: string;
  title?: string;
  description?: string | null;
  /** Who caused the event; `type` may take values added later. */
  actor?: {
    type: Actor["type"] | (string & {});
    id: string | null;
  };
  assetId?: string | null;
  assetSequence?: number | null;
  asset?: (EventAsset & Record<string, unknown>) | null;
  facts?: ReceivedFact;
  [key: string]: unknown;
}
export type { ReceivedWebhookEventPayload, WebhookEventPayload };