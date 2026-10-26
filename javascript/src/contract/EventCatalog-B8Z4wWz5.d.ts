import { n as PermissionAction } from "./Permissions-BfEFqPWR.js";
import * as zod from "zod";
declare const EVENT_SEVERITY_SCHEMA: zod.ZodEnum<{
  high: "high";
  low: "low";
}>;
type EventSeverity = zod.infer<typeof EVENT_SEVERITY_SCHEMA>;
declare const EVENT_CATEGORY_SCHEMA: zod.ZodEnum<{
  "api-keys": "api-keys";
  assets: "assets";
  connectors: "connectors";
  moderation: "moderation";
  team: "team";
  usage: "usage";
}>;
type EventCategory = zod.infer<typeof EVENT_CATEGORY_SCHEMA>;
/**
 * How a data field is shown in messages and docs:
 * - `text`: plain text
 * - `code`: an identifier, shown in monospace
 * - `enum`: a machine value such as `rejected`, shown humanized ("Rejected")
 * - `list`: an array of machine values, shown humanized and comma separated
 * - `number`: a count, shown with thousands separators
 */
declare const EVENT_FIELD_DISPLAY_SCHEMA: zod.ZodEnum<{
  code: "code";
  enum: "enum";
  list: "list";
  number: "number";
  text: "text";
}>;
type EventFieldDisplay = zod.infer<typeof EVENT_FIELD_DISPLAY_SCHEMA>;
interface EventFieldInfo {
  label: string;
  description: string;
  display: EventFieldDisplay;
  /** Kept in the data but left out of rendered messages (usually an ID shown by another field). */
  hidden?: boolean;
  /**
   * Personal or account-level data that stays in the portal. Webhook, Slack and email deliveries,
   * and the public events feed, leave the fact out and word the title and description without it.
   */
  inAppOnly?: boolean;
  /** Display names for `enum` and `list` values that don't read well humanized. */
  valueLabels?: Readonly<Record<string, string>>;
}
interface EventFieldDefinition<TSchema extends zod.ZodType = zod.ZodType> extends EventFieldInfo {
  schema: TSchema;
}
/** Every event type, in the order the portal and docs list them. */
declare const EVENT_TYPE_INFO: {
  readonly "asset.uploaded": {
    id: "asset.uploaded";
    name: string;
    description: string;
    category: EventCategory;
    severity: EventSeverity;
    /** Whether the in-app connector (notification bell) subscribes to the type by default. */
    notify: boolean;
    /**
     * The project-wide permission needed to see events of this type (portal feed, public events
     * feed) and to subscribe a connector to it.
     */
    permission: PermissionAction;
    /** Types of unreleased features are left out of the published contract until enabled. */
    enabled?: boolean;
    fields: {
      assetName: EventFieldDefinition<zod.ZodOptional<zod.ZodNullable<zod.ZodString>>>;
      assetType: EventFieldDefinition<zod.ZodOptional<zod.ZodNullable<zod.ZodEnum<{
        audio: "audio";
        file: "file";
        image: "image";
        "multimedia-document": "multimedia-document";
        "plaintext-document": "plaintext-document";
        video: "video";
        website: "website";
      }>>>>;
      fileFormat: EventFieldDefinition<zod.ZodOptional<zod.ZodNullable<zod.ZodString>>>;
    };
    /** Example data, used for synthetic test sends (`createSampleEvent`). */
    example: NoInfer<{
      assetName?: string | null | undefined;
      assetType?: "audio" | "file" | "image" | "multimedia-document" | "plaintext-document" | "video" | "website" | null | undefined;
      fileFormat?: string | null | undefined;
    }>;
    factInfo: {
      label: string;
      description: string;
      display: EventFieldDisplay;
      /** Kept in the data but left out of rendered messages (usually an ID shown by another field). */
      hidden?: boolean;
      /**
       * Personal or account-level data that stays in the portal. Webhook, Slack and email deliveries,
       * and the public events feed, leave the fact out and word the title and description without it.
       */
      inAppOnly?: boolean;
      /** Display names for `enum` and `list` values that don't read well humanized. */
      valueLabels?: Readonly<Record<string, string>>;
      schema: zod.ZodType<unknown, unknown, zod.core.$ZodTypeInternals<unknown, unknown>>;
      key: string;
    }[];
    values: zod.ZodObject<{
      assetName: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
      assetType: zod.ZodOptional<zod.ZodNullable<zod.ZodEnum<{
        audio: "audio";
        file: "file";
        image: "image";
        "multimedia-document": "multimedia-document";
        "plaintext-document": "plaintext-document";
        video: "video";
        website: "website";
      }>>>;
      fileFormat: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
    }, zod.core.$strip>;
  };
  readonly "asset.classified": {
    id: "asset.classified";
    name: string;
    description: string;
    category: EventCategory;
    severity: EventSeverity;
    /** Whether the in-app connector (notification bell) subscribes to the type by default. */
    notify: boolean;
    /**
     * The project-wide permission needed to see events of this type (portal feed, public events
     * feed) and to subscribe a connector to it.
     */
    permission: PermissionAction;
    /** Types of unreleased features are left out of the published contract until enabled. */
    enabled?: boolean;
    fields: {
      assetName: EventFieldDefinition<zod.ZodOptional<zod.ZodNullable<zod.ZodString>>>;
      assetType: EventFieldDefinition<zod.ZodOptional<zod.ZodNullable<zod.ZodEnum<{
        audio: "audio";
        file: "file";
        image: "image";
        "multimedia-document": "multimedia-document";
        "plaintext-document": "plaintext-document";
        video: "video";
        website: "website";
      }>>>>;
      flaggedCategories: EventFieldDefinition<zod.ZodArray<zod.ZodString>>;
      moderationStatus: EventFieldDefinition<zod.ZodEnum<{
        "age-restricted": "age-restricted";
        allowed: "allowed";
        blocked: "blocked";
        limited: "limited";
        pending: "pending";
        purged: "purged";
      }>>;
    };
    /** Example data, used for synthetic test sends (`createSampleEvent`). */
    example: NoInfer<{
      assetName?: string | null | undefined;
      assetType?: "audio" | "file" | "image" | "multimedia-document" | "plaintext-document" | "video" | "website" | null | undefined;
      flaggedCategories: string[];
      moderationStatus: "age-restricted" | "allowed" | "blocked" | "limited" | "pending" | "purged";
    }>;
    factInfo: {
      label: string;
      description: string;
      display: EventFieldDisplay;
      /** Kept in the data but left out of rendered messages (usually an ID shown by another field). */
      hidden?: boolean;
      /**
       * Personal or account-level data that stays in the portal. Webhook, Slack and email deliveries,
       * and the public events feed, leave the fact out and word the title and description without it.
       */
      inAppOnly?: boolean;
      /** Display names for `enum` and `list` values that don't read well humanized. */
      valueLabels?: Readonly<Record<string, string>>;
      schema: zod.ZodType<unknown, unknown, zod.core.$ZodTypeInternals<unknown, unknown>>;
      key: string;
    }[];
    values: zod.ZodObject<{
      assetName: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
      assetType: zod.ZodOptional<zod.ZodNullable<zod.ZodEnum<{
        audio: "audio";
        file: "file";
        image: "image";
        "multimedia-document": "multimedia-document";
        "plaintext-document": "plaintext-document";
        video: "video";
        website: "website";
      }>>>;
      flaggedCategories: zod.ZodArray<zod.ZodString>;
      moderationStatus: zod.ZodEnum<{
        "age-restricted": "age-restricted";
        allowed: "allowed";
        blocked: "blocked";
        limited: "limited";
        pending: "pending";
        purged: "purged";
      }>;
    }, zod.core.$strip>;
  };
  readonly "asset.allowed": {
    id: "asset.allowed";
    name: string;
    description: string;
    category: EventCategory;
    severity: EventSeverity;
    /** Whether the in-app connector (notification bell) subscribes to the type by default. */
    notify: boolean;
    /**
     * The project-wide permission needed to see events of this type (portal feed, public events
     * feed) and to subscribe a connector to it.
     */
    permission: PermissionAction;
    /** Types of unreleased features are left out of the published contract until enabled. */
    enabled?: boolean;
    fields: {
      assetName: EventFieldDefinition<zod.ZodOptional<zod.ZodNullable<zod.ZodString>>>;
      assetType: EventFieldDefinition<zod.ZodOptional<zod.ZodNullable<zod.ZodEnum<{
        audio: "audio";
        file: "file";
        image: "image";
        "multimedia-document": "multimedia-document";
        "plaintext-document": "plaintext-document";
        video: "video";
        website: "website";
      }>>>>;
      decidedBy: EventFieldDefinition<zod.ZodEnum<{
        automated: "automated";
        reviewer: "reviewer";
      }>>;
      flaggedCategories: EventFieldDefinition<zod.ZodOptional<zod.ZodArray<zod.ZodString>>>;
      reviewerUserId: EventFieldDefinition<zod.ZodOptional<zod.ZodNullable<zod.ZodString>>>;
      reviewerName: EventFieldDefinition<zod.ZodOptional<zod.ZodNullable<zod.ZodString>>>;
      note: EventFieldDefinition<zod.ZodOptional<zod.ZodNullable<zod.ZodString>>>;
    };
    /** Example data, used for synthetic test sends (`createSampleEvent`). */
    example: NoInfer<{
      assetName?: string | null | undefined;
      assetType?: "audio" | "file" | "image" | "multimedia-document" | "plaintext-document" | "video" | "website" | null | undefined;
      decidedBy: "automated" | "reviewer";
      flaggedCategories?: string[] | undefined;
      reviewerUserId?: string | null | undefined;
      reviewerName?: string | null | undefined;
      note?: string | null | undefined;
    }>;
    factInfo: {
      label: string;
      description: string;
      display: EventFieldDisplay;
      /** Kept in the data but left out of rendered messages (usually an ID shown by another field). */
      hidden?: boolean;
      /**
       * Personal or account-level data that stays in the portal. Webhook, Slack and email deliveries,
       * and the public events feed, leave the fact out and word the title and description without it.
       */
      inAppOnly?: boolean;
      /** Display names for `enum` and `list` values that don't read well humanized. */
      valueLabels?: Readonly<Record<string, string>>;
      schema: zod.ZodType<unknown, unknown, zod.core.$ZodTypeInternals<unknown, unknown>>;
      key: string;
    }[];
    values: zod.ZodObject<{
      assetName: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
      assetType: zod.ZodOptional<zod.ZodNullable<zod.ZodEnum<{
        audio: "audio";
        file: "file";
        image: "image";
        "multimedia-document": "multimedia-document";
        "plaintext-document": "plaintext-document";
        video: "video";
        website: "website";
      }>>>;
      decidedBy: zod.ZodEnum<{
        automated: "automated";
        reviewer: "reviewer";
      }>;
      flaggedCategories: zod.ZodOptional<zod.ZodArray<zod.ZodString>>;
      reviewerUserId: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
      reviewerName: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
      note: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
    }, zod.core.$strip>;
  };
  readonly "asset.limited": {
    id: "asset.limited";
    name: string;
    description: string;
    category: EventCategory;
    severity: EventSeverity;
    /** Whether the in-app connector (notification bell) subscribes to the type by default. */
    notify: boolean;
    /**
     * The project-wide permission needed to see events of this type (portal feed, public events
     * feed) and to subscribe a connector to it.
     */
    permission: PermissionAction;
    /** Types of unreleased features are left out of the published contract until enabled. */
    enabled?: boolean;
    fields: {
      assetName: EventFieldDefinition<zod.ZodOptional<zod.ZodNullable<zod.ZodString>>>;
      assetType: EventFieldDefinition<zod.ZodOptional<zod.ZodNullable<zod.ZodEnum<{
        audio: "audio";
        file: "file";
        image: "image";
        "multimedia-document": "multimedia-document";
        "plaintext-document": "plaintext-document";
        video: "video";
        website: "website";
      }>>>>;
      decidedBy: EventFieldDefinition<zod.ZodEnum<{
        automated: "automated";
        reviewer: "reviewer";
      }>>;
      flaggedCategories: EventFieldDefinition<zod.ZodOptional<zod.ZodArray<zod.ZodString>>>;
      reviewerUserId: EventFieldDefinition<zod.ZodOptional<zod.ZodNullable<zod.ZodString>>>;
      reviewerName: EventFieldDefinition<zod.ZodOptional<zod.ZodNullable<zod.ZodString>>>;
      note: EventFieldDefinition<zod.ZodOptional<zod.ZodNullable<zod.ZodString>>>;
    };
    /** Example data, used for synthetic test sends (`createSampleEvent`). */
    example: NoInfer<{
      assetName?: string | null | undefined;
      assetType?: "audio" | "file" | "image" | "multimedia-document" | "plaintext-document" | "video" | "website" | null | undefined;
      decidedBy: "automated" | "reviewer";
      flaggedCategories?: string[] | undefined;
      reviewerUserId?: string | null | undefined;
      reviewerName?: string | null | undefined;
      note?: string | null | undefined;
    }>;
    factInfo: {
      label: string;
      description: string;
      display: EventFieldDisplay;
      /** Kept in the data but left out of rendered messages (usually an ID shown by another field). */
      hidden?: boolean;
      /**
       * Personal or account-level data that stays in the portal. Webhook, Slack and email deliveries,
       * and the public events feed, leave the fact out and word the title and description without it.
       */
      inAppOnly?: boolean;
      /** Display names for `enum` and `list` values that don't read well humanized. */
      valueLabels?: Readonly<Record<string, string>>;
      schema: zod.ZodType<unknown, unknown, zod.core.$ZodTypeInternals<unknown, unknown>>;
      key: string;
    }[];
    values: zod.ZodObject<{
      assetName: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
      assetType: zod.ZodOptional<zod.ZodNullable<zod.ZodEnum<{
        audio: "audio";
        file: "file";
        image: "image";
        "multimedia-document": "multimedia-document";
        "plaintext-document": "plaintext-document";
        video: "video";
        website: "website";
      }>>>;
      decidedBy: zod.ZodEnum<{
        automated: "automated";
        reviewer: "reviewer";
      }>;
      flaggedCategories: zod.ZodOptional<zod.ZodArray<zod.ZodString>>;
      reviewerUserId: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
      reviewerName: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
      note: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
    }, zod.core.$strip>;
  };
  readonly "asset.age-restricted": {
    id: "asset.age-restricted";
    name: string;
    description: string;
    category: EventCategory;
    severity: EventSeverity;
    /** Whether the in-app connector (notification bell) subscribes to the type by default. */
    notify: boolean;
    /**
     * The project-wide permission needed to see events of this type (portal feed, public events
     * feed) and to subscribe a connector to it.
     */
    permission: PermissionAction;
    /** Types of unreleased features are left out of the published contract until enabled. */
    enabled?: boolean;
    fields: {
      assetName: EventFieldDefinition<zod.ZodOptional<zod.ZodNullable<zod.ZodString>>>;
      assetType: EventFieldDefinition<zod.ZodOptional<zod.ZodNullable<zod.ZodEnum<{
        audio: "audio";
        file: "file";
        image: "image";
        "multimedia-document": "multimedia-document";
        "plaintext-document": "plaintext-document";
        video: "video";
        website: "website";
      }>>>>;
      decidedBy: EventFieldDefinition<zod.ZodEnum<{
        automated: "automated";
        reviewer: "reviewer";
      }>>;
      flaggedCategories: EventFieldDefinition<zod.ZodOptional<zod.ZodArray<zod.ZodString>>>;
      reviewerUserId: EventFieldDefinition<zod.ZodOptional<zod.ZodNullable<zod.ZodString>>>;
      reviewerName: EventFieldDefinition<zod.ZodOptional<zod.ZodNullable<zod.ZodString>>>;
      note: EventFieldDefinition<zod.ZodOptional<zod.ZodNullable<zod.ZodString>>>;
    };
    /** Example data, used for synthetic test sends (`createSampleEvent`). */
    example: NoInfer<{
      assetName?: string | null | undefined;
      assetType?: "audio" | "file" | "image" | "multimedia-document" | "plaintext-document" | "video" | "website" | null | undefined;
      decidedBy: "automated" | "reviewer";
      flaggedCategories?: string[] | undefined;
      reviewerUserId?: string | null | undefined;
      reviewerName?: string | null | undefined;
      note?: string | null | undefined;
    }>;
    factInfo: {
      label: string;
      description: string;
      display: EventFieldDisplay;
      /** Kept in the data but left out of rendered messages (usually an ID shown by another field). */
      hidden?: boolean;
      /**
       * Personal or account-level data that stays in the portal. Webhook, Slack and email deliveries,
       * and the public events feed, leave the fact out and word the title and description without it.
       */
      inAppOnly?: boolean;
      /** Display names for `enum` and `list` values that don't read well humanized. */
      valueLabels?: Readonly<Record<string, string>>;
      schema: zod.ZodType<unknown, unknown, zod.core.$ZodTypeInternals<unknown, unknown>>;
      key: string;
    }[];
    values: zod.ZodObject<{
      assetName: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
      assetType: zod.ZodOptional<zod.ZodNullable<zod.ZodEnum<{
        audio: "audio";
        file: "file";
        image: "image";
        "multimedia-document": "multimedia-document";
        "plaintext-document": "plaintext-document";
        video: "video";
        website: "website";
      }>>>;
      decidedBy: zod.ZodEnum<{
        automated: "automated";
        reviewer: "reviewer";
      }>;
      flaggedCategories: zod.ZodOptional<zod.ZodArray<zod.ZodString>>;
      reviewerUserId: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
      reviewerName: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
      note: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
    }, zod.core.$strip>;
  };
  readonly "asset.blocked": {
    id: "asset.blocked";
    name: string;
    description: string;
    category: EventCategory;
    severity: EventSeverity;
    /** Whether the in-app connector (notification bell) subscribes to the type by default. */
    notify: boolean;
    /**
     * The project-wide permission needed to see events of this type (portal feed, public events
     * feed) and to subscribe a connector to it.
     */
    permission: PermissionAction;
    /** Types of unreleased features are left out of the published contract until enabled. */
    enabled?: boolean;
    fields: {
      assetName: EventFieldDefinition<zod.ZodOptional<zod.ZodNullable<zod.ZodString>>>;
      assetType: EventFieldDefinition<zod.ZodOptional<zod.ZodNullable<zod.ZodEnum<{
        audio: "audio";
        file: "file";
        image: "image";
        "multimedia-document": "multimedia-document";
        "plaintext-document": "plaintext-document";
        video: "video";
        website: "website";
      }>>>>;
      decidedBy: EventFieldDefinition<zod.ZodEnum<{
        automated: "automated";
        reviewer: "reviewer";
      }>>;
      flaggedCategories: EventFieldDefinition<zod.ZodOptional<zod.ZodArray<zod.ZodString>>>;
      reviewerUserId: EventFieldDefinition<zod.ZodOptional<zod.ZodNullable<zod.ZodString>>>;
      reviewerName: EventFieldDefinition<zod.ZodOptional<zod.ZodNullable<zod.ZodString>>>;
      note: EventFieldDefinition<zod.ZodOptional<zod.ZodNullable<zod.ZodString>>>;
    };
    /** Example data, used for synthetic test sends (`createSampleEvent`). */
    example: NoInfer<{
      assetName?: string | null | undefined;
      assetType?: "audio" | "file" | "image" | "multimedia-document" | "plaintext-document" | "video" | "website" | null | undefined;
      decidedBy: "automated" | "reviewer";
      flaggedCategories?: string[] | undefined;
      reviewerUserId?: string | null | undefined;
      reviewerName?: string | null | undefined;
      note?: string | null | undefined;
    }>;
    factInfo: {
      label: string;
      description: string;
      display: EventFieldDisplay;
      /** Kept in the data but left out of rendered messages (usually an ID shown by another field). */
      hidden?: boolean;
      /**
       * Personal or account-level data that stays in the portal. Webhook, Slack and email deliveries,
       * and the public events feed, leave the fact out and word the title and description without it.
       */
      inAppOnly?: boolean;
      /** Display names for `enum` and `list` values that don't read well humanized. */
      valueLabels?: Readonly<Record<string, string>>;
      schema: zod.ZodType<unknown, unknown, zod.core.$ZodTypeInternals<unknown, unknown>>;
      key: string;
    }[];
    values: zod.ZodObject<{
      assetName: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
      assetType: zod.ZodOptional<zod.ZodNullable<zod.ZodEnum<{
        audio: "audio";
        file: "file";
        image: "image";
        "multimedia-document": "multimedia-document";
        "plaintext-document": "plaintext-document";
        video: "video";
        website: "website";
      }>>>;
      decidedBy: zod.ZodEnum<{
        automated: "automated";
        reviewer: "reviewer";
      }>;
      flaggedCategories: zod.ZodOptional<zod.ZodArray<zod.ZodString>>;
      reviewerUserId: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
      reviewerName: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
      note: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
    }, zod.core.$strip>;
  };
  readonly "asset.purged": {
    id: "asset.purged";
    name: string;
    description: string;
    category: EventCategory;
    severity: EventSeverity;
    /** Whether the in-app connector (notification bell) subscribes to the type by default. */
    notify: boolean;
    /**
     * The project-wide permission needed to see events of this type (portal feed, public events
     * feed) and to subscribe a connector to it.
     */
    permission: PermissionAction;
    /** Types of unreleased features are left out of the published contract until enabled. */
    enabled?: boolean;
    fields: {
      assetName: EventFieldDefinition<zod.ZodOptional<zod.ZodNullable<zod.ZodString>>>;
      assetType: EventFieldDefinition<zod.ZodOptional<zod.ZodNullable<zod.ZodEnum<{
        audio: "audio";
        file: "file";
        image: "image";
        "multimedia-document": "multimedia-document";
        "plaintext-document": "plaintext-document";
        video: "video";
        website: "website";
      }>>>>;
      decidedBy: EventFieldDefinition<zod.ZodEnum<{
        automated: "automated";
        reviewer: "reviewer";
      }>>;
      flaggedCategories: EventFieldDefinition<zod.ZodOptional<zod.ZodArray<zod.ZodString>>>;
      reviewerUserId: EventFieldDefinition<zod.ZodOptional<zod.ZodNullable<zod.ZodString>>>;
      reviewerName: EventFieldDefinition<zod.ZodOptional<zod.ZodNullable<zod.ZodString>>>;
      note: EventFieldDefinition<zod.ZodOptional<zod.ZodNullable<zod.ZodString>>>;
    };
    /** Example data, used for synthetic test sends (`createSampleEvent`). */
    example: NoInfer<{
      assetName?: string | null | undefined;
      assetType?: "audio" | "file" | "image" | "multimedia-document" | "plaintext-document" | "video" | "website" | null | undefined;
      decidedBy: "automated" | "reviewer";
      flaggedCategories?: string[] | undefined;
      reviewerUserId?: string | null | undefined;
      reviewerName?: string | null | undefined;
      note?: string | null | undefined;
    }>;
    factInfo: {
      label: string;
      description: string;
      display: EventFieldDisplay;
      /** Kept in the data but left out of rendered messages (usually an ID shown by another field). */
      hidden?: boolean;
      /**
       * Personal or account-level data that stays in the portal. Webhook, Slack and email deliveries,
       * and the public events feed, leave the fact out and word the title and description without it.
       */
      inAppOnly?: boolean;
      /** Display names for `enum` and `list` values that don't read well humanized. */
      valueLabels?: Readonly<Record<string, string>>;
      schema: zod.ZodType<unknown, unknown, zod.core.$ZodTypeInternals<unknown, unknown>>;
      key: string;
    }[];
    values: zod.ZodObject<{
      assetName: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
      assetType: zod.ZodOptional<zod.ZodNullable<zod.ZodEnum<{
        audio: "audio";
        file: "file";
        image: "image";
        "multimedia-document": "multimedia-document";
        "plaintext-document": "plaintext-document";
        video: "video";
        website: "website";
      }>>>;
      decidedBy: zod.ZodEnum<{
        automated: "automated";
        reviewer: "reviewer";
      }>;
      flaggedCategories: zod.ZodOptional<zod.ZodArray<zod.ZodString>>;
      reviewerUserId: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
      reviewerName: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
      note: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
    }, zod.core.$strip>;
  };
  readonly "asset.failed": {
    id: "asset.failed";
    name: string;
    description: string;
    category: EventCategory;
    severity: EventSeverity;
    /** Whether the in-app connector (notification bell) subscribes to the type by default. */
    notify: boolean;
    /**
     * The project-wide permission needed to see events of this type (portal feed, public events
     * feed) and to subscribe a connector to it.
     */
    permission: PermissionAction;
    /** Types of unreleased features are left out of the published contract until enabled. */
    enabled?: boolean;
    fields: {
      assetName: EventFieldDefinition<zod.ZodOptional<zod.ZodNullable<zod.ZodString>>>;
      assetType: EventFieldDefinition<zod.ZodOptional<zod.ZodNullable<zod.ZodEnum<{
        audio: "audio";
        file: "file";
        image: "image";
        "multimedia-document": "multimedia-document";
        "plaintext-document": "plaintext-document";
        video: "video";
        website: "website";
      }>>>>;
      previousStatus: EventFieldDefinition<zod.ZodOptional<zod.ZodNullable<zod.ZodEnum<{
        completed: "completed";
        failed: "failed";
        pending: "pending";
        processing: "processing";
      }>>>>;
    };
    /** Example data, used for synthetic test sends (`createSampleEvent`). */
    example: NoInfer<{
      assetName?: string | null | undefined;
      assetType?: "audio" | "file" | "image" | "multimedia-document" | "plaintext-document" | "video" | "website" | null | undefined;
      previousStatus?: "completed" | "failed" | "pending" | "processing" | null | undefined;
    }>;
    factInfo: {
      label: string;
      description: string;
      display: EventFieldDisplay;
      /** Kept in the data but left out of rendered messages (usually an ID shown by another field). */
      hidden?: boolean;
      /**
       * Personal or account-level data that stays in the portal. Webhook, Slack and email deliveries,
       * and the public events feed, leave the fact out and word the title and description without it.
       */
      inAppOnly?: boolean;
      /** Display names for `enum` and `list` values that don't read well humanized. */
      valueLabels?: Readonly<Record<string, string>>;
      schema: zod.ZodType<unknown, unknown, zod.core.$ZodTypeInternals<unknown, unknown>>;
      key: string;
    }[];
    values: zod.ZodObject<{
      assetName: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
      assetType: zod.ZodOptional<zod.ZodNullable<zod.ZodEnum<{
        audio: "audio";
        file: "file";
        image: "image";
        "multimedia-document": "multimedia-document";
        "plaintext-document": "plaintext-document";
        video: "video";
        website: "website";
      }>>>;
      previousStatus: zod.ZodOptional<zod.ZodNullable<zod.ZodEnum<{
        completed: "completed";
        failed: "failed";
        pending: "pending";
        processing: "processing";
      }>>>;
    }, zod.core.$strip>;
  };
  readonly "asset.deleted": {
    id: "asset.deleted";
    name: string;
    description: string;
    category: EventCategory;
    severity: EventSeverity;
    /** Whether the in-app connector (notification bell) subscribes to the type by default. */
    notify: boolean;
    /**
     * The project-wide permission needed to see events of this type (portal feed, public events
     * feed) and to subscribe a connector to it.
     */
    permission: PermissionAction;
    /** Types of unreleased features are left out of the published contract until enabled. */
    enabled?: boolean;
    fields: {
      assetName: EventFieldDefinition<zod.ZodOptional<zod.ZodNullable<zod.ZodString>>>;
      assetType: EventFieldDefinition<zod.ZodOptional<zod.ZodNullable<zod.ZodEnum<{
        audio: "audio";
        file: "file";
        image: "image";
        "multimedia-document": "multimedia-document";
        "plaintext-document": "plaintext-document";
        video: "video";
        website: "website";
      }>>>>;
    };
    /** Example data, used for synthetic test sends (`createSampleEvent`). */
    example: NoInfer<{
      assetName?: string | null | undefined;
      assetType?: "audio" | "file" | "image" | "multimedia-document" | "plaintext-document" | "video" | "website" | null | undefined;
    }>;
    factInfo: {
      label: string;
      description: string;
      display: EventFieldDisplay;
      /** Kept in the data but left out of rendered messages (usually an ID shown by another field). */
      hidden?: boolean;
      /**
       * Personal or account-level data that stays in the portal. Webhook, Slack and email deliveries,
       * and the public events feed, leave the fact out and word the title and description without it.
       */
      inAppOnly?: boolean;
      /** Display names for `enum` and `list` values that don't read well humanized. */
      valueLabels?: Readonly<Record<string, string>>;
      schema: zod.ZodType<unknown, unknown, zod.core.$ZodTypeInternals<unknown, unknown>>;
      key: string;
    }[];
    values: zod.ZodObject<{
      assetName: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
      assetType: zod.ZodOptional<zod.ZodNullable<zod.ZodEnum<{
        audio: "audio";
        file: "file";
        image: "image";
        "multimedia-document": "multimedia-document";
        "plaintext-document": "plaintext-document";
        video: "video";
        website: "website";
      }>>>;
    }, zod.core.$strip>;
  };
  readonly "asset.content-removed": {
    id: "asset.content-removed";
    name: string;
    description: string;
    category: EventCategory;
    severity: EventSeverity;
    /** Whether the in-app connector (notification bell) subscribes to the type by default. */
    notify: boolean;
    /**
     * The project-wide permission needed to see events of this type (portal feed, public events
     * feed) and to subscribe a connector to it.
     */
    permission: PermissionAction;
    /** Types of unreleased features are left out of the published contract until enabled. */
    enabled?: boolean;
    fields: {
      assetName: EventFieldDefinition<zod.ZodOptional<zod.ZodNullable<zod.ZodString>>>;
      assetType: EventFieldDefinition<zod.ZodOptional<zod.ZodNullable<zod.ZodEnum<{
        audio: "audio";
        file: "file";
        image: "image";
        "multimedia-document": "multimedia-document";
        "plaintext-document": "plaintext-document";
        video: "video";
        website: "website";
      }>>>>;
    };
    /** Example data, used for synthetic test sends (`createSampleEvent`). */
    example: NoInfer<{
      assetName?: string | null | undefined;
      assetType?: "audio" | "file" | "image" | "multimedia-document" | "plaintext-document" | "video" | "website" | null | undefined;
    }>;
    factInfo: {
      label: string;
      description: string;
      display: EventFieldDisplay;
      /** Kept in the data but left out of rendered messages (usually an ID shown by another field). */
      hidden?: boolean;
      /**
       * Personal or account-level data that stays in the portal. Webhook, Slack and email deliveries,
       * and the public events feed, leave the fact out and word the title and description without it.
       */
      inAppOnly?: boolean;
      /** Display names for `enum` and `list` values that don't read well humanized. */
      valueLabels?: Readonly<Record<string, string>>;
      schema: zod.ZodType<unknown, unknown, zod.core.$ZodTypeInternals<unknown, unknown>>;
      key: string;
    }[];
    values: zod.ZodObject<{
      assetName: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
      assetType: zod.ZodOptional<zod.ZodNullable<zod.ZodEnum<{
        audio: "audio";
        file: "file";
        image: "image";
        "multimedia-document": "multimedia-document";
        "plaintext-document": "plaintext-document";
        video: "video";
        website: "website";
      }>>>;
    }, zod.core.$strip>;
  };
  readonly "asset.retried": {
    id: "asset.retried";
    name: string;
    description: string;
    category: EventCategory;
    severity: EventSeverity;
    /** Whether the in-app connector (notification bell) subscribes to the type by default. */
    notify: boolean;
    /**
     * The project-wide permission needed to see events of this type (portal feed, public events
     * feed) and to subscribe a connector to it.
     */
    permission: PermissionAction;
    /** Types of unreleased features are left out of the published contract until enabled. */
    enabled?: boolean;
    fields: {
      assetName: EventFieldDefinition<zod.ZodOptional<zod.ZodNullable<zod.ZodString>>>;
      assetType: EventFieldDefinition<zod.ZodOptional<zod.ZodNullable<zod.ZodEnum<{
        audio: "audio";
        file: "file";
        image: "image";
        "multimedia-document": "multimedia-document";
        "plaintext-document": "plaintext-document";
        video: "video";
        website: "website";
      }>>>>;
    };
    /** Example data, used for synthetic test sends (`createSampleEvent`). */
    example: NoInfer<{
      assetName?: string | null | undefined;
      assetType?: "audio" | "file" | "image" | "multimedia-document" | "plaintext-document" | "video" | "website" | null | undefined;
    }>;
    factInfo: {
      label: string;
      description: string;
      display: EventFieldDisplay;
      /** Kept in the data but left out of rendered messages (usually an ID shown by another field). */
      hidden?: boolean;
      /**
       * Personal or account-level data that stays in the portal. Webhook, Slack and email deliveries,
       * and the public events feed, leave the fact out and word the title and description without it.
       */
      inAppOnly?: boolean;
      /** Display names for `enum` and `list` values that don't read well humanized. */
      valueLabels?: Readonly<Record<string, string>>;
      schema: zod.ZodType<unknown, unknown, zod.core.$ZodTypeInternals<unknown, unknown>>;
      key: string;
    }[];
    values: zod.ZodObject<{
      assetName: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
      assetType: zod.ZodOptional<zod.ZodNullable<zod.ZodEnum<{
        audio: "audio";
        file: "file";
        image: "image";
        "multimedia-document": "multimedia-document";
        "plaintext-document": "plaintext-document";
        video: "video";
        website: "website";
      }>>>;
    }, zod.core.$strip>;
  };
  readonly "asset.review-requested": {
    id: "asset.review-requested";
    name: string;
    description: string;
    category: EventCategory;
    severity: EventSeverity;
    /** Whether the in-app connector (notification bell) subscribes to the type by default. */
    notify: boolean;
    /**
     * The project-wide permission needed to see events of this type (portal feed, public events
     * feed) and to subscribe a connector to it.
     */
    permission: PermissionAction;
    /** Types of unreleased features are left out of the published contract until enabled. */
    enabled?: boolean;
    fields: {
      assetName: EventFieldDefinition<zod.ZodOptional<zod.ZodNullable<zod.ZodString>>>;
      assetType: EventFieldDefinition<zod.ZodOptional<zod.ZodNullable<zod.ZodEnum<{
        audio: "audio";
        file: "file";
        image: "image";
        "multimedia-document": "multimedia-document";
        "plaintext-document": "plaintext-document";
        video: "video";
        website: "website";
      }>>>>;
      automatedOutcome: EventFieldDefinition<zod.ZodEnum<{
        "age-restricted": "age-restricted";
        allowed: "allowed";
        blocked: "blocked";
        limited: "limited";
        pending: "pending";
        purged: "purged";
      }>>;
    };
    /** Example data, used for synthetic test sends (`createSampleEvent`). */
    example: NoInfer<{
      assetName?: string | null | undefined;
      assetType?: "audio" | "file" | "image" | "multimedia-document" | "plaintext-document" | "video" | "website" | null | undefined;
      automatedOutcome: "age-restricted" | "allowed" | "blocked" | "limited" | "pending" | "purged";
    }>;
    factInfo: {
      label: string;
      description: string;
      display: EventFieldDisplay;
      /** Kept in the data but left out of rendered messages (usually an ID shown by another field). */
      hidden?: boolean;
      /**
       * Personal or account-level data that stays in the portal. Webhook, Slack and email deliveries,
       * and the public events feed, leave the fact out and word the title and description without it.
       */
      inAppOnly?: boolean;
      /** Display names for `enum` and `list` values that don't read well humanized. */
      valueLabels?: Readonly<Record<string, string>>;
      schema: zod.ZodType<unknown, unknown, zod.core.$ZodTypeInternals<unknown, unknown>>;
      key: string;
    }[];
    values: zod.ZodObject<{
      assetName: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
      assetType: zod.ZodOptional<zod.ZodNullable<zod.ZodEnum<{
        audio: "audio";
        file: "file";
        image: "image";
        "multimedia-document": "multimedia-document";
        "plaintext-document": "plaintext-document";
        video: "video";
        website: "website";
      }>>>;
      automatedOutcome: zod.ZodEnum<{
        "age-restricted": "age-restricted";
        allowed: "allowed";
        blocked: "blocked";
        limited: "limited";
        pending: "pending";
        purged: "purged";
      }>;
    }, zod.core.$strip>;
  };
  readonly "asset.hash-matched": {
    id: "asset.hash-matched";
    name: string;
    description: string;
    category: EventCategory;
    severity: EventSeverity;
    /** Whether the in-app connector (notification bell) subscribes to the type by default. */
    notify: boolean;
    /**
     * The project-wide permission needed to see events of this type (portal feed, public events
     * feed) and to subscribe a connector to it.
     */
    permission: PermissionAction;
    /** Types of unreleased features are left out of the published contract until enabled. */
    enabled?: boolean;
    fields: {
      assetName: EventFieldDefinition<zod.ZodOptional<zod.ZodNullable<zod.ZodString>>>;
      assetType: EventFieldDefinition<zod.ZodOptional<zod.ZodNullable<zod.ZodEnum<{
        audio: "audio";
        file: "file";
        image: "image";
        "multimedia-document": "multimedia-document";
        "plaintext-document": "plaintext-document";
        video: "video";
        website: "website";
      }>>>>;
      hashListId: EventFieldDefinition<zod.ZodString>;
      hashListName: EventFieldDefinition<zod.ZodString>;
      distance: EventFieldDefinition<zod.ZodNumber>;
      matchAction: EventFieldDefinition<zod.ZodEnum<{
        block: "block";
        flag: "flag";
      }>>;
    };
    /** Example data, used for synthetic test sends (`createSampleEvent`). */
    example: NoInfer<{
      assetName?: string | null | undefined;
      assetType?: "audio" | "file" | "image" | "multimedia-document" | "plaintext-document" | "video" | "website" | null | undefined;
      hashListId: string;
      hashListName: string;
      distance: number;
      matchAction: "block" | "flag";
    }>;
    factInfo: {
      label: string;
      description: string;
      display: EventFieldDisplay;
      /** Kept in the data but left out of rendered messages (usually an ID shown by another field). */
      hidden?: boolean;
      /**
       * Personal or account-level data that stays in the portal. Webhook, Slack and email deliveries,
       * and the public events feed, leave the fact out and word the title and description without it.
       */
      inAppOnly?: boolean;
      /** Display names for `enum` and `list` values that don't read well humanized. */
      valueLabels?: Readonly<Record<string, string>>;
      schema: zod.ZodType<unknown, unknown, zod.core.$ZodTypeInternals<unknown, unknown>>;
      key: string;
    }[];
    values: zod.ZodObject<{
      assetName: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
      assetType: zod.ZodOptional<zod.ZodNullable<zod.ZodEnum<{
        audio: "audio";
        file: "file";
        image: "image";
        "multimedia-document": "multimedia-document";
        "plaintext-document": "plaintext-document";
        video: "video";
        website: "website";
      }>>>;
      hashListId: zod.ZodString;
      hashListName: zod.ZodString;
      distance: zod.ZodNumber;
      matchAction: zod.ZodEnum<{
        block: "block";
        flag: "flag";
      }>;
    }, zod.core.$strip>;
  };
  readonly "usage.limit-reached": {
    id: "usage.limit-reached";
    name: string;
    description: string;
    category: EventCategory;
    severity: EventSeverity;
    /** Whether the in-app connector (notification bell) subscribes to the type by default. */
    notify: boolean;
    /**
     * The project-wide permission needed to see events of this type (portal feed, public events
     * feed) and to subscribe a connector to it.
     */
    permission: PermissionAction;
    /** Types of unreleased features are left out of the published contract until enabled. */
    enabled?: boolean;
    fields: {
      limit: EventFieldDefinition<zod.ZodNumber>;
      used: EventFieldDefinition<zod.ZodNumber>;
      organisationId: EventFieldDefinition<zod.ZodString>;
    };
    /** Example data, used for synthetic test sends (`createSampleEvent`). */
    example: NoInfer<{
      limit: number;
      used: number;
      organisationId: string;
    }>;
    factInfo: {
      label: string;
      description: string;
      display: EventFieldDisplay;
      /** Kept in the data but left out of rendered messages (usually an ID shown by another field). */
      hidden?: boolean;
      /**
       * Personal or account-level data that stays in the portal. Webhook, Slack and email deliveries,
       * and the public events feed, leave the fact out and word the title and description without it.
       */
      inAppOnly?: boolean;
      /** Display names for `enum` and `list` values that don't read well humanized. */
      valueLabels?: Readonly<Record<string, string>>;
      schema: zod.ZodType<unknown, unknown, zod.core.$ZodTypeInternals<unknown, unknown>>;
      key: string;
    }[];
    values: zod.ZodObject<{
      limit: zod.ZodNumber;
      used: zod.ZodNumber;
      organisationId: zod.ZodString;
    }, zod.core.$strip>;
  };
  readonly "usage.spend-limit-reached": {
    id: "usage.spend-limit-reached";
    name: string;
    description: string;
    category: EventCategory;
    severity: EventSeverity;
    /** Whether the in-app connector (notification bell) subscribes to the type by default. */
    notify: boolean;
    /**
     * The project-wide permission needed to see events of this type (portal feed, public events
     * feed) and to subscribe a connector to it.
     */
    permission: PermissionAction;
    /** Types of unreleased features are left out of the published contract until enabled. */
    enabled?: boolean;
    fields: {
      reason: EventFieldDefinition<zod.ZodEnum<{
        "payment-failed": "payment-failed";
        "project-budget": "project-budget";
        "spend-limit": "spend-limit";
        "usage-cap": "usage-cap";
      }>>;
      resumesOn: EventFieldDefinition<zod.ZodOptional<zod.ZodNullable<zod.ZodString>>>;
    };
    /** Example data, used for synthetic test sends (`createSampleEvent`). */
    example: NoInfer<{
      reason: "payment-failed" | "project-budget" | "spend-limit" | "usage-cap";
      resumesOn?: string | null | undefined;
    }>;
    factInfo: {
      label: string;
      description: string;
      display: EventFieldDisplay;
      /** Kept in the data but left out of rendered messages (usually an ID shown by another field). */
      hidden?: boolean;
      /**
       * Personal or account-level data that stays in the portal. Webhook, Slack and email deliveries,
       * and the public events feed, leave the fact out and word the title and description without it.
       */
      inAppOnly?: boolean;
      /** Display names for `enum` and `list` values that don't read well humanized. */
      valueLabels?: Readonly<Record<string, string>>;
      schema: zod.ZodType<unknown, unknown, zod.core.$ZodTypeInternals<unknown, unknown>>;
      key: string;
    }[];
    values: zod.ZodObject<{
      reason: zod.ZodEnum<{
        "payment-failed": "payment-failed";
        "project-budget": "project-budget";
        "spend-limit": "spend-limit";
        "usage-cap": "usage-cap";
      }>;
      resumesOn: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
    }, zod.core.$strip>;
  };
  readonly "upload-preset.daily-limit-reached": {
    id: "upload-preset.daily-limit-reached";
    name: string;
    description: string;
    category: EventCategory;
    severity: EventSeverity;
    /** Whether the in-app connector (notification bell) subscribes to the type by default. */
    notify: boolean;
    /**
     * The project-wide permission needed to see events of this type (portal feed, public events
     * feed) and to subscribe a connector to it.
     */
    permission: PermissionAction;
    /** Types of unreleased features are left out of the published contract until enabled. */
    enabled?: boolean;
    fields: {
      presetId: EventFieldDefinition<zod.ZodString>;
      presetName: EventFieldDefinition<zod.ZodString>;
      dailyLimit: EventFieldDefinition<zod.ZodNumber>;
    };
    /** Example data, used for synthetic test sends (`createSampleEvent`). */
    example: NoInfer<{
      presetId: string;
      presetName: string;
      dailyLimit: number;
    }>;
    factInfo: {
      label: string;
      description: string;
      display: EventFieldDisplay;
      /** Kept in the data but left out of rendered messages (usually an ID shown by another field). */
      hidden?: boolean;
      /**
       * Personal or account-level data that stays in the portal. Webhook, Slack and email deliveries,
       * and the public events feed, leave the fact out and word the title and description without it.
       */
      inAppOnly?: boolean;
      /** Display names for `enum` and `list` values that don't read well humanized. */
      valueLabels?: Readonly<Record<string, string>>;
      schema: zod.ZodType<unknown, unknown, zod.core.$ZodTypeInternals<unknown, unknown>>;
      key: string;
    }[];
    values: zod.ZodObject<{
      presetId: zod.ZodString;
      presetName: zod.ZodString;
      dailyLimit: zod.ZodNumber;
    }, zod.core.$strip>;
  };
  readonly "project.member-joined": {
    id: "project.member-joined";
    name: string;
    description: string;
    category: EventCategory;
    severity: EventSeverity;
    /** Whether the in-app connector (notification bell) subscribes to the type by default. */
    notify: boolean;
    /**
     * The project-wide permission needed to see events of this type (portal feed, public events
     * feed) and to subscribe a connector to it.
     */
    permission: PermissionAction;
    /** Types of unreleased features are left out of the published contract until enabled. */
    enabled?: boolean;
    fields: {
      memberUserId: EventFieldDefinition<zod.ZodString>;
      memberName: EventFieldDefinition<zod.ZodOptional<zod.ZodNullable<zod.ZodString>>>;
      role: EventFieldDefinition<zod.ZodEnum<{
        admin: "admin";
        custom: "custom";
        editor: "editor";
        viewer: "viewer";
      }>>;
      invitedByUserId: EventFieldDefinition<zod.ZodOptional<zod.ZodNullable<zod.ZodString>>>;
    };
    /** Example data, used for synthetic test sends (`createSampleEvent`). */
    example: NoInfer<{
      memberUserId: string;
      memberName?: string | null | undefined;
      role: "admin" | "custom" | "editor" | "viewer";
      invitedByUserId?: string | null | undefined;
    }>;
    factInfo: {
      label: string;
      description: string;
      display: EventFieldDisplay;
      /** Kept in the data but left out of rendered messages (usually an ID shown by another field). */
      hidden?: boolean;
      /**
       * Personal or account-level data that stays in the portal. Webhook, Slack and email deliveries,
       * and the public events feed, leave the fact out and word the title and description without it.
       */
      inAppOnly?: boolean;
      /** Display names for `enum` and `list` values that don't read well humanized. */
      valueLabels?: Readonly<Record<string, string>>;
      schema: zod.ZodType<unknown, unknown, zod.core.$ZodTypeInternals<unknown, unknown>>;
      key: string;
    }[];
    values: zod.ZodObject<{
      memberUserId: zod.ZodString;
      memberName: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
      role: zod.ZodEnum<{
        admin: "admin";
        custom: "custom";
        editor: "editor";
        viewer: "viewer";
      }>;
      invitedByUserId: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
    }, zod.core.$strip>;
  };
  readonly "project.member-removed": {
    id: "project.member-removed";
    name: string;
    description: string;
    category: EventCategory;
    severity: EventSeverity;
    /** Whether the in-app connector (notification bell) subscribes to the type by default. */
    notify: boolean;
    /**
     * The project-wide permission needed to see events of this type (portal feed, public events
     * feed) and to subscribe a connector to it.
     */
    permission: PermissionAction;
    /** Types of unreleased features are left out of the published contract until enabled. */
    enabled?: boolean;
    fields: {
      memberUserId: EventFieldDefinition<zod.ZodString>;
      memberName: EventFieldDefinition<zod.ZodOptional<zod.ZodNullable<zod.ZodString>>>;
      role: EventFieldDefinition<zod.ZodEnum<{
        admin: "admin";
        custom: "custom";
        editor: "editor";
        viewer: "viewer";
      }>>;
      left: EventFieldDefinition<zod.ZodBoolean>;
      removedByUserId: EventFieldDefinition<zod.ZodOptional<zod.ZodNullable<zod.ZodString>>>;
    };
    /** Example data, used for synthetic test sends (`createSampleEvent`). */
    example: NoInfer<{
      memberUserId: string;
      memberName?: string | null | undefined;
      role: "admin" | "custom" | "editor" | "viewer";
      left: boolean;
      removedByUserId?: string | null | undefined;
    }>;
    factInfo: {
      label: string;
      description: string;
      display: EventFieldDisplay;
      /** Kept in the data but left out of rendered messages (usually an ID shown by another field). */
      hidden?: boolean;
      /**
       * Personal or account-level data that stays in the portal. Webhook, Slack and email deliveries,
       * and the public events feed, leave the fact out and word the title and description without it.
       */
      inAppOnly?: boolean;
      /** Display names for `enum` and `list` values that don't read well humanized. */
      valueLabels?: Readonly<Record<string, string>>;
      schema: zod.ZodType<unknown, unknown, zod.core.$ZodTypeInternals<unknown, unknown>>;
      key: string;
    }[];
    values: zod.ZodObject<{
      memberUserId: zod.ZodString;
      memberName: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
      role: zod.ZodEnum<{
        admin: "admin";
        custom: "custom";
        editor: "editor";
        viewer: "viewer";
      }>;
      left: zod.ZodBoolean;
      removedByUserId: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
    }, zod.core.$strip>;
  };
  readonly "project.member-role-changed": {
    id: "project.member-role-changed";
    name: string;
    description: string;
    category: EventCategory;
    severity: EventSeverity;
    /** Whether the in-app connector (notification bell) subscribes to the type by default. */
    notify: boolean;
    /**
     * The project-wide permission needed to see events of this type (portal feed, public events
     * feed) and to subscribe a connector to it.
     */
    permission: PermissionAction;
    /** Types of unreleased features are left out of the published contract until enabled. */
    enabled?: boolean;
    fields: {
      memberUserId: EventFieldDefinition<zod.ZodString>;
      memberName: EventFieldDefinition<zod.ZodOptional<zod.ZodNullable<zod.ZodString>>>;
      previousRole: EventFieldDefinition<zod.ZodEnum<{
        admin: "admin";
        custom: "custom";
        editor: "editor";
        viewer: "viewer";
      }>>;
      role: EventFieldDefinition<zod.ZodEnum<{
        admin: "admin";
        custom: "custom";
        editor: "editor";
        viewer: "viewer";
      }>>;
      changedByUserId: EventFieldDefinition<zod.ZodOptional<zod.ZodNullable<zod.ZodString>>>;
    };
    /** Example data, used for synthetic test sends (`createSampleEvent`). */
    example: NoInfer<{
      memberUserId: string;
      memberName?: string | null | undefined;
      previousRole: "admin" | "custom" | "editor" | "viewer";
      role: "admin" | "custom" | "editor" | "viewer";
      changedByUserId?: string | null | undefined;
    }>;
    factInfo: {
      label: string;
      description: string;
      display: EventFieldDisplay;
      /** Kept in the data but left out of rendered messages (usually an ID shown by another field). */
      hidden?: boolean;
      /**
       * Personal or account-level data that stays in the portal. Webhook, Slack and email deliveries,
       * and the public events feed, leave the fact out and word the title and description without it.
       */
      inAppOnly?: boolean;
      /** Display names for `enum` and `list` values that don't read well humanized. */
      valueLabels?: Readonly<Record<string, string>>;
      schema: zod.ZodType<unknown, unknown, zod.core.$ZodTypeInternals<unknown, unknown>>;
      key: string;
    }[];
    values: zod.ZodObject<{
      memberUserId: zod.ZodString;
      memberName: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
      previousRole: zod.ZodEnum<{
        admin: "admin";
        custom: "custom";
        editor: "editor";
        viewer: "viewer";
      }>;
      role: zod.ZodEnum<{
        admin: "admin";
        custom: "custom";
        editor: "editor";
        viewer: "viewer";
      }>;
      changedByUserId: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
    }, zod.core.$strip>;
  };
  readonly "project.invitation-sent": {
    id: "project.invitation-sent";
    name: string;
    description: string;
    category: EventCategory;
    severity: EventSeverity;
    /** Whether the in-app connector (notification bell) subscribes to the type by default. */
    notify: boolean;
    /**
     * The project-wide permission needed to see events of this type (portal feed, public events
     * feed) and to subscribe a connector to it.
     */
    permission: PermissionAction;
    /** Types of unreleased features are left out of the published contract until enabled. */
    enabled?: boolean;
    fields: {
      inviteeEmail: EventFieldDefinition<zod.ZodString>;
      role: EventFieldDefinition<zod.ZodEnum<{
        admin: "admin";
        custom: "custom";
        editor: "editor";
        viewer: "viewer";
      }>>;
      invitedByUserId: EventFieldDefinition<zod.ZodOptional<zod.ZodNullable<zod.ZodString>>>;
    };
    /** Example data, used for synthetic test sends (`createSampleEvent`). */
    example: NoInfer<{
      inviteeEmail: string;
      role: "admin" | "custom" | "editor" | "viewer";
      invitedByUserId?: string | null | undefined;
    }>;
    factInfo: {
      label: string;
      description: string;
      display: EventFieldDisplay;
      /** Kept in the data but left out of rendered messages (usually an ID shown by another field). */
      hidden?: boolean;
      /**
       * Personal or account-level data that stays in the portal. Webhook, Slack and email deliveries,
       * and the public events feed, leave the fact out and word the title and description without it.
       */
      inAppOnly?: boolean;
      /** Display names for `enum` and `list` values that don't read well humanized. */
      valueLabels?: Readonly<Record<string, string>>;
      schema: zod.ZodType<unknown, unknown, zod.core.$ZodTypeInternals<unknown, unknown>>;
      key: string;
    }[];
    values: zod.ZodObject<{
      inviteeEmail: zod.ZodString;
      role: zod.ZodEnum<{
        admin: "admin";
        custom: "custom";
        editor: "editor";
        viewer: "viewer";
      }>;
      invitedByUserId: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
    }, zod.core.$strip>;
  };
  readonly "api-key.created": {
    id: "api-key.created";
    name: string;
    description: string;
    category: EventCategory;
    severity: EventSeverity;
    /** Whether the in-app connector (notification bell) subscribes to the type by default. */
    notify: boolean;
    /**
     * The project-wide permission needed to see events of this type (portal feed, public events
     * feed) and to subscribe a connector to it.
     */
    permission: PermissionAction;
    /** Types of unreleased features are left out of the published contract until enabled. */
    enabled?: boolean;
    fields: {
      keyId: EventFieldDefinition<zod.ZodString>;
      keyName: EventFieldDefinition<zod.ZodOptional<zod.ZodNullable<zod.ZodString>>>;
      role: EventFieldDefinition<zod.ZodEnum<{
        admin: "admin";
        custom: "custom";
        editor: "editor";
        viewer: "viewer";
      }>>;
      createdByUserId: EventFieldDefinition<zod.ZodOptional<zod.ZodNullable<zod.ZodString>>>;
      createdByName: EventFieldDefinition<zod.ZodOptional<zod.ZodNullable<zod.ZodString>>>;
    };
    /** Example data, used for synthetic test sends (`createSampleEvent`). */
    example: NoInfer<{
      keyId: string;
      keyName?: string | null | undefined;
      role: "admin" | "custom" | "editor" | "viewer";
      createdByUserId?: string | null | undefined;
      createdByName?: string | null | undefined;
    }>;
    factInfo: {
      label: string;
      description: string;
      display: EventFieldDisplay;
      /** Kept in the data but left out of rendered messages (usually an ID shown by another field). */
      hidden?: boolean;
      /**
       * Personal or account-level data that stays in the portal. Webhook, Slack and email deliveries,
       * and the public events feed, leave the fact out and word the title and description without it.
       */
      inAppOnly?: boolean;
      /** Display names for `enum` and `list` values that don't read well humanized. */
      valueLabels?: Readonly<Record<string, string>>;
      schema: zod.ZodType<unknown, unknown, zod.core.$ZodTypeInternals<unknown, unknown>>;
      key: string;
    }[];
    values: zod.ZodObject<{
      keyId: zod.ZodString;
      keyName: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
      role: zod.ZodEnum<{
        admin: "admin";
        custom: "custom";
        editor: "editor";
        viewer: "viewer";
      }>;
      createdByUserId: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
      createdByName: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
    }, zod.core.$strip>;
  };
  readonly "api-key.revoked": {
    id: "api-key.revoked";
    name: string;
    description: string;
    category: EventCategory;
    severity: EventSeverity;
    /** Whether the in-app connector (notification bell) subscribes to the type by default. */
    notify: boolean;
    /**
     * The project-wide permission needed to see events of this type (portal feed, public events
     * feed) and to subscribe a connector to it.
     */
    permission: PermissionAction;
    /** Types of unreleased features are left out of the published contract until enabled. */
    enabled?: boolean;
    fields: {
      keyId: EventFieldDefinition<zod.ZodString>;
      keyName: EventFieldDefinition<zod.ZodOptional<zod.ZodNullable<zod.ZodString>>>;
      action: EventFieldDefinition<zod.ZodEnum<{
        deleted: "deleted";
        revoked: "revoked";
      }>>;
      revokedByUserId: EventFieldDefinition<zod.ZodOptional<zod.ZodNullable<zod.ZodString>>>;
      revokedByName: EventFieldDefinition<zod.ZodOptional<zod.ZodNullable<zod.ZodString>>>;
    };
    /** Example data, used for synthetic test sends (`createSampleEvent`). */
    example: NoInfer<{
      keyId: string;
      keyName?: string | null | undefined;
      action: "deleted" | "revoked";
      revokedByUserId?: string | null | undefined;
      revokedByName?: string | null | undefined;
    }>;
    factInfo: {
      label: string;
      description: string;
      display: EventFieldDisplay;
      /** Kept in the data but left out of rendered messages (usually an ID shown by another field). */
      hidden?: boolean;
      /**
       * Personal or account-level data that stays in the portal. Webhook, Slack and email deliveries,
       * and the public events feed, leave the fact out and word the title and description without it.
       */
      inAppOnly?: boolean;
      /** Display names for `enum` and `list` values that don't read well humanized. */
      valueLabels?: Readonly<Record<string, string>>;
      schema: zod.ZodType<unknown, unknown, zod.core.$ZodTypeInternals<unknown, unknown>>;
      key: string;
    }[];
    values: zod.ZodObject<{
      keyId: zod.ZodString;
      keyName: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
      action: zod.ZodEnum<{
        deleted: "deleted";
        revoked: "revoked";
      }>;
      revokedByUserId: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
      revokedByName: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
    }, zod.core.$strip>;
  };
  readonly "connector.failing": {
    id: "connector.failing";
    name: string;
    description: string;
    category: EventCategory;
    severity: EventSeverity;
    /** Whether the in-app connector (notification bell) subscribes to the type by default. */
    notify: boolean;
    /**
     * The project-wide permission needed to see events of this type (portal feed, public events
     * feed) and to subscribe a connector to it.
     */
    permission: PermissionAction;
    /** Types of unreleased features are left out of the published contract until enabled. */
    enabled?: boolean;
    fields: {
      connectorId: EventFieldDefinition<zod.ZodString>;
      connectorName: EventFieldDefinition<zod.ZodString>;
      connectorType: EventFieldDefinition<zod.ZodString>;
      consecutiveFailures: EventFieldDefinition<zod.ZodNumber>;
      lastError: EventFieldDefinition<zod.ZodOptional<zod.ZodNullable<zod.ZodString>>>;
    };
    /** Example data, used for synthetic test sends (`createSampleEvent`). */
    example: NoInfer<{
      connectorId: string;
      connectorName: string;
      connectorType: string;
      consecutiveFailures: number;
      lastError?: string | null | undefined;
    }>;
    factInfo: {
      label: string;
      description: string;
      display: EventFieldDisplay;
      /** Kept in the data but left out of rendered messages (usually an ID shown by another field). */
      hidden?: boolean;
      /**
       * Personal or account-level data that stays in the portal. Webhook, Slack and email deliveries,
       * and the public events feed, leave the fact out and word the title and description without it.
       */
      inAppOnly?: boolean;
      /** Display names for `enum` and `list` values that don't read well humanized. */
      valueLabels?: Readonly<Record<string, string>>;
      schema: zod.ZodType<unknown, unknown, zod.core.$ZodTypeInternals<unknown, unknown>>;
      key: string;
    }[];
    values: zod.ZodObject<{
      connectorId: zod.ZodString;
      connectorName: zod.ZodString;
      connectorType: zod.ZodString;
      consecutiveFailures: zod.ZodNumber;
      lastError: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
    }, zod.core.$strip>;
  };
  readonly "appeal.submitted": {
    id: "appeal.submitted";
    name: string;
    description: string;
    category: EventCategory;
    severity: EventSeverity;
    /** Whether the in-app connector (notification bell) subscribes to the type by default. */
    notify: boolean;
    /**
     * The project-wide permission needed to see events of this type (portal feed, public events
     * feed) and to subscribe a connector to it.
     */
    permission: PermissionAction;
    /** Types of unreleased features are left out of the published contract until enabled. */
    enabled?: boolean;
    fields: {
      appealId: EventFieldDefinition<zod.ZodString>;
      subjectType: EventFieldDefinition<zod.ZodEnum<{
        post: "post";
        "reported-post": "reported-post";
        "reported-user": "reported-user";
        user: "user";
      }>>;
      subjectId: EventFieldDefinition<zod.ZodString>;
    };
    /** Example data, used for synthetic test sends (`createSampleEvent`). */
    example: NoInfer<{
      appealId: string;
      subjectType: "post" | "reported-post" | "reported-user" | "user";
      subjectId: string;
    }>;
    factInfo: {
      label: string;
      description: string;
      display: EventFieldDisplay;
      /** Kept in the data but left out of rendered messages (usually an ID shown by another field). */
      hidden?: boolean;
      /**
       * Personal or account-level data that stays in the portal. Webhook, Slack and email deliveries,
       * and the public events feed, leave the fact out and word the title and description without it.
       */
      inAppOnly?: boolean;
      /** Display names for `enum` and `list` values that don't read well humanized. */
      valueLabels?: Readonly<Record<string, string>>;
      schema: zod.ZodType<unknown, unknown, zod.core.$ZodTypeInternals<unknown, unknown>>;
      key: string;
    }[];
    values: zod.ZodObject<{
      appealId: zod.ZodString;
      subjectType: zod.ZodEnum<{
        post: "post";
        "reported-post": "reported-post";
        "reported-user": "reported-user";
        user: "user";
      }>;
      subjectId: zod.ZodString;
    }, zod.core.$strip>;
  };
  readonly "appeal.resolved": {
    id: "appeal.resolved";
    name: string;
    description: string;
    category: EventCategory;
    severity: EventSeverity;
    /** Whether the in-app connector (notification bell) subscribes to the type by default. */
    notify: boolean;
    /**
     * The project-wide permission needed to see events of this type (portal feed, public events
     * feed) and to subscribe a connector to it.
     */
    permission: PermissionAction;
    /** Types of unreleased features are left out of the published contract until enabled. */
    enabled?: boolean;
    fields: {
      appealId: EventFieldDefinition<zod.ZodString>;
      subjectType: EventFieldDefinition<zod.ZodEnum<{
        post: "post";
        "reported-post": "reported-post";
        "reported-user": "reported-user";
        user: "user";
      }>>;
      subjectId: EventFieldDefinition<zod.ZodString>;
      decision: EventFieldDefinition<zod.ZodEnum<{
        overturned: "overturned";
        upheld: "upheld";
      }>>;
      action: EventFieldDefinition<zod.ZodString>;
      appliedToAsset: EventFieldDefinition<zod.ZodBoolean>;
    };
    /** Example data, used for synthetic test sends (`createSampleEvent`). */
    example: NoInfer<{
      appealId: string;
      subjectType: "post" | "reported-post" | "reported-user" | "user";
      subjectId: string;
      decision: "overturned" | "upheld";
      action: string;
      appliedToAsset: boolean;
    }>;
    factInfo: {
      label: string;
      description: string;
      display: EventFieldDisplay;
      /** Kept in the data but left out of rendered messages (usually an ID shown by another field). */
      hidden?: boolean;
      /**
       * Personal or account-level data that stays in the portal. Webhook, Slack and email deliveries,
       * and the public events feed, leave the fact out and word the title and description without it.
       */
      inAppOnly?: boolean;
      /** Display names for `enum` and `list` values that don't read well humanized. */
      valueLabels?: Readonly<Record<string, string>>;
      schema: zod.ZodType<unknown, unknown, zod.core.$ZodTypeInternals<unknown, unknown>>;
      key: string;
    }[];
    values: zod.ZodObject<{
      appealId: zod.ZodString;
      subjectType: zod.ZodEnum<{
        post: "post";
        "reported-post": "reported-post";
        "reported-user": "reported-user";
        user: "user";
      }>;
      subjectId: zod.ZodString;
      decision: zod.ZodEnum<{
        overturned: "overturned";
        upheld: "upheld";
      }>;
      action: zod.ZodString;
      appliedToAsset: zod.ZodBoolean;
    }, zod.core.$strip>;
  };
};
type EventType = keyof typeof EVENT_TYPE_INFO;
type EventTypeInfo<TType extends EventType = EventType> = (typeof EVENT_TYPE_INFO)[TType];
declare const EVENT_FACT_VALUE_SCHEMAS: { [TType in EventType]: EventTypeInfo<TType>["values"]; };
/** Named values used internally to produce event copy. */
type EventFactValues<TType extends EventType = EventType> = zod.infer<(typeof EVENT_FACT_VALUE_SCHEMAS)[TType]>;
type KebabCase<S extends string> = S extends `${infer First}${infer Rest}` ? `${First extends Lowercase<First> ? First : `-${Lowercase<First>}`}${KebabCase<Rest>}` : S;
type EventFact<TType extends EventType = EventType> = TType extends EventType ? { [Key in keyof EventFactValues<TType> & string]: {
  key: KebabCase<Key>;
  value: Exclude<EventFactValues<TType>[Key], undefined>;
  url?: string;
}; }[keyof EventFactValues<TType> & string] | {
  key: "test";
  value: boolean;
  url?: string;
} : never;
type EventFacts<TType extends EventType = EventType> = EventFact<TType>[];
export { EventSeverity as a, EventFacts as i, EventFact as n, EventType as o, EventFactValues as r, EventCategory as t };