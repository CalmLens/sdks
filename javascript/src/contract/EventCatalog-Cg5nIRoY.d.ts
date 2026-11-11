import { n as PermissionAction } from "./Permissions-DhtiFwEc.js";
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
 * - `date`: a time in milliseconds since the Unix epoch, shown as its UTC date
 */
declare const EVENT_FIELD_DISPLAY_SCHEMA: zod.ZodEnum<{
  code: "code";
  date: "date";
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
  /**
   * A person's name: `actor` names the event's `actor`, `member` the member in the `member-user-id`
   * fact. Deleting their account removes it from the events that name them.
   */
  names?: "actor" | "member";
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
      /**
       * A person's name: `actor` names the event's `actor`, `member` the member in the `member-user-id`
       * fact. Deleting their account removes it from the events that name them.
       */
      names?: "actor" | "member";
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
      parentAsset: EventFieldDefinition<zod.ZodOptional<zod.ZodString>>;
      flaggedCategories: EventFieldDefinition<zod.ZodArray<zod.ZodEnum<{
        "criminal-activity": "criminal-activity";
        harassment: "harassment";
        hate: "hate";
        "personal-information": "personal-information";
        profanity: "profanity";
        "self-harm": "self-harm";
        sexual: "sexual";
        violence: "violence";
      }>>>;
      moderationStatus: EventFieldDefinition<zod.ZodEnum<{
        "age-restricted": "age-restricted";
        allowed: "allowed";
        blocked: "blocked";
        limited: "limited";
        pending: "pending";
        purged: "purged";
      }>>;
      automatedStatus: EventFieldDefinition<zod.ZodOptional<zod.ZodEnum<{
        "age-restricted": "age-restricted";
        allowed: "allowed";
        blocked: "blocked";
        limited: "limited";
        purged: "purged";
      }>>>;
    };
    /** Example data, used for synthetic test sends (`createSampleEvent`). */
    example: NoInfer<{
      assetName?: string | null | undefined;
      assetType?: "audio" | "file" | "image" | "multimedia-document" | "plaintext-document" | "video" | "website" | null | undefined;
      parentAsset?: string | undefined;
      flaggedCategories: ("criminal-activity" | "harassment" | "hate" | "personal-information" | "profanity" | "self-harm" | "sexual" | "violence")[];
      moderationStatus: "age-restricted" | "allowed" | "blocked" | "limited" | "pending" | "purged";
      automatedStatus?: "age-restricted" | "allowed" | "blocked" | "limited" | "purged" | undefined;
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
      /**
       * A person's name: `actor` names the event's `actor`, `member` the member in the `member-user-id`
       * fact. Deleting their account removes it from the events that name them.
       */
      names?: "actor" | "member";
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
      parentAsset: zod.ZodOptional<zod.ZodString>;
      flaggedCategories: zod.ZodArray<zod.ZodEnum<{
        "criminal-activity": "criminal-activity";
        harassment: "harassment";
        hate: "hate";
        "personal-information": "personal-information";
        profanity: "profanity";
        "self-harm": "self-harm";
        sexual: "sexual";
        violence: "violence";
      }>>;
      moderationStatus: zod.ZodEnum<{
        "age-restricted": "age-restricted";
        allowed: "allowed";
        blocked: "blocked";
        limited: "limited";
        pending: "pending";
        purged: "purged";
      }>;
      automatedStatus: zod.ZodOptional<zod.ZodEnum<{
        "age-restricted": "age-restricted";
        allowed: "allowed";
        blocked: "blocked";
        limited: "limited";
        purged: "purged";
      }>>;
    }, zod.core.$strip>;
  };
  readonly "asset.region-restricted": {
    id: "asset.region-restricted";
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
      parentAsset: EventFieldDefinition<zod.ZodOptional<zod.ZodString>>;
      region: EventFieldDefinition<zod.ZodEnum<{
        AT: "AT";
        AU: "AU";
        BR: "BR";
        DE: "DE";
        EU: "EU";
        FR: "FR";
        GB: "GB";
      }>>;
      rule: EventFieldDefinition<zod.ZodString>;
      status: EventFieldDefinition<zod.ZodEnum<{
        "age-restricted": "age-restricted";
        blocked: "blocked";
        limited: "limited";
        purged: "purged";
      }>>;
    };
    /** Example data, used for synthetic test sends (`createSampleEvent`). */
    example: NoInfer<{
      assetName?: string | null | undefined;
      assetType?: "audio" | "file" | "image" | "multimedia-document" | "plaintext-document" | "video" | "website" | null | undefined;
      parentAsset?: string | undefined;
      region: "AT" | "AU" | "BR" | "DE" | "EU" | "FR" | "GB";
      rule: string;
      status: "age-restricted" | "blocked" | "limited" | "purged";
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
      /**
       * A person's name: `actor` names the event's `actor`, `member` the member in the `member-user-id`
       * fact. Deleting their account removes it from the events that name them.
       */
      names?: "actor" | "member";
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
      parentAsset: zod.ZodOptional<zod.ZodString>;
      region: zod.ZodEnum<{
        AT: "AT";
        AU: "AU";
        BR: "BR";
        DE: "DE";
        EU: "EU";
        FR: "FR";
        GB: "GB";
      }>;
      rule: zod.ZodString;
      status: zod.ZodEnum<{
        "age-restricted": "age-restricted";
        blocked: "blocked";
        limited: "limited";
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
      parentAsset: EventFieldDefinition<zod.ZodOptional<zod.ZodString>>;
      flaggedCategories: EventFieldDefinition<zod.ZodOptional<zod.ZodArray<zod.ZodEnum<{
        "criminal-activity": "criminal-activity";
        harassment: "harassment";
        hate: "hate";
        "personal-information": "personal-information";
        profanity: "profanity";
        "self-harm": "self-harm";
        sexual: "sexual";
        violence: "violence";
      }>>>>;
      reviewerName: EventFieldDefinition<zod.ZodOptional<zod.ZodNullable<zod.ZodString>>>;
      note: EventFieldDefinition<zod.ZodOptional<zod.ZodNullable<zod.ZodString>>>;
      childAsset: EventFieldDefinition<zod.ZodOptional<zod.ZodString>>;
      childStatus: EventFieldDefinition<zod.ZodOptional<zod.ZodEnum<{
        "age-restricted": "age-restricted";
        allowed: "allowed";
        blocked: "blocked";
        limited: "limited";
        purged: "purged";
      }>>>;
    };
    /** Example data, used for synthetic test sends (`createSampleEvent`). */
    example: NoInfer<{
      assetName?: string | null | undefined;
      assetType?: "audio" | "file" | "image" | "multimedia-document" | "plaintext-document" | "video" | "website" | null | undefined;
      parentAsset?: string | undefined;
      flaggedCategories?: ("criminal-activity" | "harassment" | "hate" | "personal-information" | "profanity" | "self-harm" | "sexual" | "violence")[] | undefined;
      reviewerName?: string | null | undefined;
      note?: string | null | undefined;
      childAsset?: string | undefined;
      childStatus?: "age-restricted" | "allowed" | "blocked" | "limited" | "purged" | undefined;
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
      /**
       * A person's name: `actor` names the event's `actor`, `member` the member in the `member-user-id`
       * fact. Deleting their account removes it from the events that name them.
       */
      names?: "actor" | "member";
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
      parentAsset: zod.ZodOptional<zod.ZodString>;
      flaggedCategories: zod.ZodOptional<zod.ZodArray<zod.ZodEnum<{
        "criminal-activity": "criminal-activity";
        harassment: "harassment";
        hate: "hate";
        "personal-information": "personal-information";
        profanity: "profanity";
        "self-harm": "self-harm";
        sexual: "sexual";
        violence: "violence";
      }>>>;
      reviewerName: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
      note: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
      childAsset: zod.ZodOptional<zod.ZodString>;
      childStatus: zod.ZodOptional<zod.ZodEnum<{
        "age-restricted": "age-restricted";
        allowed: "allowed";
        blocked: "blocked";
        limited: "limited";
        purged: "purged";
      }>>;
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
      parentAsset: EventFieldDefinition<zod.ZodOptional<zod.ZodString>>;
      flaggedCategories: EventFieldDefinition<zod.ZodOptional<zod.ZodArray<zod.ZodEnum<{
        "criminal-activity": "criminal-activity";
        harassment: "harassment";
        hate: "hate";
        "personal-information": "personal-information";
        profanity: "profanity";
        "self-harm": "self-harm";
        sexual: "sexual";
        violence: "violence";
      }>>>>;
      reviewerName: EventFieldDefinition<zod.ZodOptional<zod.ZodNullable<zod.ZodString>>>;
      note: EventFieldDefinition<zod.ZodOptional<zod.ZodNullable<zod.ZodString>>>;
      childAsset: EventFieldDefinition<zod.ZodOptional<zod.ZodString>>;
      childStatus: EventFieldDefinition<zod.ZodOptional<zod.ZodEnum<{
        "age-restricted": "age-restricted";
        allowed: "allowed";
        blocked: "blocked";
        limited: "limited";
        purged: "purged";
      }>>>;
    };
    /** Example data, used for synthetic test sends (`createSampleEvent`). */
    example: NoInfer<{
      assetName?: string | null | undefined;
      assetType?: "audio" | "file" | "image" | "multimedia-document" | "plaintext-document" | "video" | "website" | null | undefined;
      parentAsset?: string | undefined;
      flaggedCategories?: ("criminal-activity" | "harassment" | "hate" | "personal-information" | "profanity" | "self-harm" | "sexual" | "violence")[] | undefined;
      reviewerName?: string | null | undefined;
      note?: string | null | undefined;
      childAsset?: string | undefined;
      childStatus?: "age-restricted" | "allowed" | "blocked" | "limited" | "purged" | undefined;
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
      /**
       * A person's name: `actor` names the event's `actor`, `member` the member in the `member-user-id`
       * fact. Deleting their account removes it from the events that name them.
       */
      names?: "actor" | "member";
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
      parentAsset: zod.ZodOptional<zod.ZodString>;
      flaggedCategories: zod.ZodOptional<zod.ZodArray<zod.ZodEnum<{
        "criminal-activity": "criminal-activity";
        harassment: "harassment";
        hate: "hate";
        "personal-information": "personal-information";
        profanity: "profanity";
        "self-harm": "self-harm";
        sexual: "sexual";
        violence: "violence";
      }>>>;
      reviewerName: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
      note: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
      childAsset: zod.ZodOptional<zod.ZodString>;
      childStatus: zod.ZodOptional<zod.ZodEnum<{
        "age-restricted": "age-restricted";
        allowed: "allowed";
        blocked: "blocked";
        limited: "limited";
        purged: "purged";
      }>>;
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
      parentAsset: EventFieldDefinition<zod.ZodOptional<zod.ZodString>>;
      flaggedCategories: EventFieldDefinition<zod.ZodOptional<zod.ZodArray<zod.ZodEnum<{
        "criminal-activity": "criminal-activity";
        harassment: "harassment";
        hate: "hate";
        "personal-information": "personal-information";
        profanity: "profanity";
        "self-harm": "self-harm";
        sexual: "sexual";
        violence: "violence";
      }>>>>;
      reviewerName: EventFieldDefinition<zod.ZodOptional<zod.ZodNullable<zod.ZodString>>>;
      note: EventFieldDefinition<zod.ZodOptional<zod.ZodNullable<zod.ZodString>>>;
      childAsset: EventFieldDefinition<zod.ZodOptional<zod.ZodString>>;
      childStatus: EventFieldDefinition<zod.ZodOptional<zod.ZodEnum<{
        "age-restricted": "age-restricted";
        allowed: "allowed";
        blocked: "blocked";
        limited: "limited";
        purged: "purged";
      }>>>;
    };
    /** Example data, used for synthetic test sends (`createSampleEvent`). */
    example: NoInfer<{
      assetName?: string | null | undefined;
      assetType?: "audio" | "file" | "image" | "multimedia-document" | "plaintext-document" | "video" | "website" | null | undefined;
      parentAsset?: string | undefined;
      flaggedCategories?: ("criminal-activity" | "harassment" | "hate" | "personal-information" | "profanity" | "self-harm" | "sexual" | "violence")[] | undefined;
      reviewerName?: string | null | undefined;
      note?: string | null | undefined;
      childAsset?: string | undefined;
      childStatus?: "age-restricted" | "allowed" | "blocked" | "limited" | "purged" | undefined;
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
      /**
       * A person's name: `actor` names the event's `actor`, `member` the member in the `member-user-id`
       * fact. Deleting their account removes it from the events that name them.
       */
      names?: "actor" | "member";
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
      parentAsset: zod.ZodOptional<zod.ZodString>;
      flaggedCategories: zod.ZodOptional<zod.ZodArray<zod.ZodEnum<{
        "criminal-activity": "criminal-activity";
        harassment: "harassment";
        hate: "hate";
        "personal-information": "personal-information";
        profanity: "profanity";
        "self-harm": "self-harm";
        sexual: "sexual";
        violence: "violence";
      }>>>;
      reviewerName: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
      note: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
      childAsset: zod.ZodOptional<zod.ZodString>;
      childStatus: zod.ZodOptional<zod.ZodEnum<{
        "age-restricted": "age-restricted";
        allowed: "allowed";
        blocked: "blocked";
        limited: "limited";
        purged: "purged";
      }>>;
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
      parentAsset: EventFieldDefinition<zod.ZodOptional<zod.ZodString>>;
      flaggedCategories: EventFieldDefinition<zod.ZodOptional<zod.ZodArray<zod.ZodEnum<{
        "criminal-activity": "criminal-activity";
        harassment: "harassment";
        hate: "hate";
        "personal-information": "personal-information";
        profanity: "profanity";
        "self-harm": "self-harm";
        sexual: "sexual";
        violence: "violence";
      }>>>>;
      reviewerName: EventFieldDefinition<zod.ZodOptional<zod.ZodNullable<zod.ZodString>>>;
      note: EventFieldDefinition<zod.ZodOptional<zod.ZodNullable<zod.ZodString>>>;
      childAsset: EventFieldDefinition<zod.ZodOptional<zod.ZodString>>;
      childStatus: EventFieldDefinition<zod.ZodOptional<zod.ZodEnum<{
        "age-restricted": "age-restricted";
        allowed: "allowed";
        blocked: "blocked";
        limited: "limited";
        purged: "purged";
      }>>>;
    };
    /** Example data, used for synthetic test sends (`createSampleEvent`). */
    example: NoInfer<{
      assetName?: string | null | undefined;
      assetType?: "audio" | "file" | "image" | "multimedia-document" | "plaintext-document" | "video" | "website" | null | undefined;
      parentAsset?: string | undefined;
      flaggedCategories?: ("criminal-activity" | "harassment" | "hate" | "personal-information" | "profanity" | "self-harm" | "sexual" | "violence")[] | undefined;
      reviewerName?: string | null | undefined;
      note?: string | null | undefined;
      childAsset?: string | undefined;
      childStatus?: "age-restricted" | "allowed" | "blocked" | "limited" | "purged" | undefined;
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
      /**
       * A person's name: `actor` names the event's `actor`, `member` the member in the `member-user-id`
       * fact. Deleting their account removes it from the events that name them.
       */
      names?: "actor" | "member";
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
      parentAsset: zod.ZodOptional<zod.ZodString>;
      flaggedCategories: zod.ZodOptional<zod.ZodArray<zod.ZodEnum<{
        "criminal-activity": "criminal-activity";
        harassment: "harassment";
        hate: "hate";
        "personal-information": "personal-information";
        profanity: "profanity";
        "self-harm": "self-harm";
        sexual: "sexual";
        violence: "violence";
      }>>>;
      reviewerName: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
      note: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
      childAsset: zod.ZodOptional<zod.ZodString>;
      childStatus: zod.ZodOptional<zod.ZodEnum<{
        "age-restricted": "age-restricted";
        allowed: "allowed";
        blocked: "blocked";
        limited: "limited";
        purged: "purged";
      }>>;
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
      parentAsset: EventFieldDefinition<zod.ZodOptional<zod.ZodString>>;
      flaggedCategories: EventFieldDefinition<zod.ZodOptional<zod.ZodArray<zod.ZodEnum<{
        "criminal-activity": "criminal-activity";
        harassment: "harassment";
        hate: "hate";
        "personal-information": "personal-information";
        profanity: "profanity";
        "self-harm": "self-harm";
        sexual: "sexual";
        violence: "violence";
      }>>>>;
      reviewerName: EventFieldDefinition<zod.ZodOptional<zod.ZodNullable<zod.ZodString>>>;
      note: EventFieldDefinition<zod.ZodOptional<zod.ZodNullable<zod.ZodString>>>;
      childAsset: EventFieldDefinition<zod.ZodOptional<zod.ZodString>>;
      childStatus: EventFieldDefinition<zod.ZodOptional<zod.ZodEnum<{
        "age-restricted": "age-restricted";
        allowed: "allowed";
        blocked: "blocked";
        limited: "limited";
        purged: "purged";
      }>>>;
    };
    /** Example data, used for synthetic test sends (`createSampleEvent`). */
    example: NoInfer<{
      assetName?: string | null | undefined;
      assetType?: "audio" | "file" | "image" | "multimedia-document" | "plaintext-document" | "video" | "website" | null | undefined;
      parentAsset?: string | undefined;
      flaggedCategories?: ("criminal-activity" | "harassment" | "hate" | "personal-information" | "profanity" | "self-harm" | "sexual" | "violence")[] | undefined;
      reviewerName?: string | null | undefined;
      note?: string | null | undefined;
      childAsset?: string | undefined;
      childStatus?: "age-restricted" | "allowed" | "blocked" | "limited" | "purged" | undefined;
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
      /**
       * A person's name: `actor` names the event's `actor`, `member` the member in the `member-user-id`
       * fact. Deleting their account removes it from the events that name them.
       */
      names?: "actor" | "member";
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
      parentAsset: zod.ZodOptional<zod.ZodString>;
      flaggedCategories: zod.ZodOptional<zod.ZodArray<zod.ZodEnum<{
        "criminal-activity": "criminal-activity";
        harassment: "harassment";
        hate: "hate";
        "personal-information": "personal-information";
        profanity: "profanity";
        "self-harm": "self-harm";
        sexual: "sexual";
        violence: "violence";
      }>>>;
      reviewerName: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
      note: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
      childAsset: zod.ZodOptional<zod.ZodString>;
      childStatus: zod.ZodOptional<zod.ZodEnum<{
        "age-restricted": "age-restricted";
        allowed: "allowed";
        blocked: "blocked";
        limited: "limited";
        purged: "purged";
      }>>;
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
      parentAsset: EventFieldDefinition<zod.ZodOptional<zod.ZodString>>;
      previousStatus: EventFieldDefinition<zod.ZodOptional<zod.ZodNullable<zod.ZodEnum<{
        completed: "completed";
        failed: "failed";
        processing: "processing";
        queued: "queued";
      }>>>>;
      failureReason: EventFieldDefinition<zod.ZodEnum<{
        "duration-limit": "duration-limit";
        "file-too-large": "file-too-large";
        "free-uploads-exhausted": "free-uploads-exhausted";
        "media-limit": "media-limit";
        "multiple-tracks": "multiple-tracks";
        "processing-error": "processing-error";
        "resolution-limit": "resolution-limit";
        "too-many-items": "too-many-items";
        "type-mismatch": "type-mismatch";
        "undecodable-content": "undecodable-content";
        "unsupported-format": "unsupported-format";
        "uploads-paused": "uploads-paused";
      }>>;
    };
    /** Example data, used for synthetic test sends (`createSampleEvent`). */
    example: NoInfer<{
      assetName?: string | null | undefined;
      assetType?: "audio" | "file" | "image" | "multimedia-document" | "plaintext-document" | "video" | "website" | null | undefined;
      parentAsset?: string | undefined;
      previousStatus?: "completed" | "failed" | "processing" | "queued" | null | undefined;
      failureReason: "duration-limit" | "file-too-large" | "free-uploads-exhausted" | "media-limit" | "multiple-tracks" | "processing-error" | "resolution-limit" | "too-many-items" | "type-mismatch" | "undecodable-content" | "unsupported-format" | "uploads-paused";
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
      /**
       * A person's name: `actor` names the event's `actor`, `member` the member in the `member-user-id`
       * fact. Deleting their account removes it from the events that name them.
       */
      names?: "actor" | "member";
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
      parentAsset: zod.ZodOptional<zod.ZodString>;
      previousStatus: zod.ZodOptional<zod.ZodNullable<zod.ZodEnum<{
        completed: "completed";
        failed: "failed";
        processing: "processing";
        queued: "queued";
      }>>>;
      failureReason: zod.ZodEnum<{
        "duration-limit": "duration-limit";
        "file-too-large": "file-too-large";
        "free-uploads-exhausted": "free-uploads-exhausted";
        "media-limit": "media-limit";
        "multiple-tracks": "multiple-tracks";
        "processing-error": "processing-error";
        "resolution-limit": "resolution-limit";
        "too-many-items": "too-many-items";
        "type-mismatch": "type-mismatch";
        "undecodable-content": "undecodable-content";
        "unsupported-format": "unsupported-format";
        "uploads-paused": "uploads-paused";
      }>;
    }, zod.core.$strip>;
  };
  readonly "asset.progress-updated": {
    id: "asset.progress-updated";
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
      completedSections: EventFieldDefinition<zod.ZodNumber>;
      totalSections: EventFieldDefinition<zod.ZodNumber>;
    };
    /** Example data, used for synthetic test sends (`createSampleEvent`). */
    example: NoInfer<{
      assetName?: string | null | undefined;
      assetType?: "audio" | "file" | "image" | "multimedia-document" | "plaintext-document" | "video" | "website" | null | undefined;
      completedSections: number;
      totalSections: number;
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
      /**
       * A person's name: `actor` names the event's `actor`, `member` the member in the `member-user-id`
       * fact. Deleting their account removes it from the events that name them.
       */
      names?: "actor" | "member";
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
      completedSections: zod.ZodNumber;
      totalSections: zod.ZodNumber;
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
      batchId: EventFieldDefinition<zod.ZodOptional<zod.ZodString>>;
    };
    /** Example data, used for synthetic test sends (`createSampleEvent`). */
    example: NoInfer<{
      assetName?: string | null | undefined;
      assetType?: "audio" | "file" | "image" | "multimedia-document" | "plaintext-document" | "video" | "website" | null | undefined;
      batchId?: string | undefined;
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
      /**
       * A person's name: `actor` names the event's `actor`, `member` the member in the `member-user-id`
       * fact. Deleting their account removes it from the events that name them.
       */
      names?: "actor" | "member";
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
      batchId: zod.ZodOptional<zod.ZodString>;
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
      batchId: EventFieldDefinition<zod.ZodOptional<zod.ZodString>>;
    };
    /** Example data, used for synthetic test sends (`createSampleEvent`). */
    example: NoInfer<{
      assetName?: string | null | undefined;
      assetType?: "audio" | "file" | "image" | "multimedia-document" | "plaintext-document" | "video" | "website" | null | undefined;
      batchId?: string | undefined;
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
      /**
       * A person's name: `actor` names the event's `actor`, `member` the member in the `member-user-id`
       * fact. Deleting their account removes it from the events that name them.
       */
      names?: "actor" | "member";
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
      batchId: zod.ZodOptional<zod.ZodString>;
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
      /**
       * A person's name: `actor` names the event's `actor`, `member` the member in the `member-user-id`
       * fact. Deleting their account removes it from the events that name them.
       */
      names?: "actor" | "member";
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
  readonly "asset.rerun-requested": {
    id: "asset.rerun-requested";
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
      moderationStatus: EventFieldDefinition<zod.ZodEnum<{
        "age-restricted": "age-restricted";
        allowed: "allowed";
        blocked: "blocked";
        limited: "limited";
        purged: "purged";
      }>>;
    };
    /** Example data, used for synthetic test sends (`createSampleEvent`). */
    example: NoInfer<{
      assetName?: string | null | undefined;
      assetType?: "audio" | "file" | "image" | "multimedia-document" | "plaintext-document" | "video" | "website" | null | undefined;
      moderationStatus: "age-restricted" | "allowed" | "blocked" | "limited" | "purged";
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
      /**
       * A person's name: `actor` names the event's `actor`, `member` the member in the `member-user-id`
       * fact. Deleting their account removes it from the events that name them.
       */
      names?: "actor" | "member";
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
      moderationStatus: zod.ZodEnum<{
        "age-restricted": "age-restricted";
        allowed: "allowed";
        blocked: "blocked";
        limited: "limited";
        purged: "purged";
      }>;
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
      parentAsset: EventFieldDefinition<zod.ZodOptional<zod.ZodString>>;
      automatedStatus: EventFieldDefinition<zod.ZodEnum<{
        "age-restricted": "age-restricted";
        allowed: "allowed";
        blocked: "blocked";
        limited: "limited";
      }>>;
      reviewReason: EventFieldDefinition<zod.ZodEnum<{
        sampled: "sampled";
        uncertain: "uncertain";
      }>>;
      uncertainCategories: EventFieldDefinition<zod.ZodArray<zod.ZodEnum<{
        "criminal-activity": "criminal-activity";
        harassment: "harassment";
        hate: "hate";
        "personal-information": "personal-information";
        profanity: "profanity";
        "self-harm": "self-harm";
        sexual: "sexual";
        violence: "violence";
      }>>>;
    };
    /** Example data, used for synthetic test sends (`createSampleEvent`). */
    example: NoInfer<{
      assetName?: string | null | undefined;
      assetType?: "audio" | "file" | "image" | "multimedia-document" | "plaintext-document" | "video" | "website" | null | undefined;
      parentAsset?: string | undefined;
      automatedStatus: "age-restricted" | "allowed" | "blocked" | "limited";
      reviewReason: "sampled" | "uncertain";
      uncertainCategories: ("criminal-activity" | "harassment" | "hate" | "personal-information" | "profanity" | "self-harm" | "sexual" | "violence")[];
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
      /**
       * A person's name: `actor` names the event's `actor`, `member` the member in the `member-user-id`
       * fact. Deleting their account removes it from the events that name them.
       */
      names?: "actor" | "member";
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
      parentAsset: zod.ZodOptional<zod.ZodString>;
      automatedStatus: zod.ZodEnum<{
        "age-restricted": "age-restricted";
        allowed: "allowed";
        blocked: "blocked";
        limited: "limited";
      }>;
      reviewReason: zod.ZodEnum<{
        sampled: "sampled";
        uncertain: "uncertain";
      }>;
      uncertainCategories: zod.ZodArray<zod.ZodEnum<{
        "criminal-activity": "criminal-activity";
        harassment: "harassment";
        hate: "hate";
        "personal-information": "personal-information";
        profanity: "profanity";
        "self-harm": "self-harm";
        sexual: "sexual";
        violence: "violence";
      }>>;
    }, zod.core.$strip>;
  };
  readonly "asset.review-completed": {
    id: "asset.review-completed";
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
      parentAsset: EventFieldDefinition<zod.ZodOptional<zod.ZodString>>;
      reviewId: EventFieldDefinition<zod.ZodString>;
      decision: EventFieldDefinition<zod.ZodEnum<{
        "age-restricted": "age-restricted";
        allowed: "allowed";
        blocked: "blocked";
        limited: "limited";
        purged: "purged";
      }>>;
      appliedToAsset: EventFieldDefinition<zod.ZodBoolean>;
      reviewerName: EventFieldDefinition<zod.ZodOptional<zod.ZodNullable<zod.ZodString>>>;
      note: EventFieldDefinition<zod.ZodNullable<zod.ZodString>>;
    };
    /** Example data, used for synthetic test sends (`createSampleEvent`). */
    example: NoInfer<{
      assetName?: string | null | undefined;
      assetType?: "audio" | "file" | "image" | "multimedia-document" | "plaintext-document" | "video" | "website" | null | undefined;
      parentAsset?: string | undefined;
      reviewId: string;
      decision: "age-restricted" | "allowed" | "blocked" | "limited" | "purged";
      appliedToAsset: boolean;
      reviewerName?: string | null | undefined;
      note: string | null;
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
      /**
       * A person's name: `actor` names the event's `actor`, `member` the member in the `member-user-id`
       * fact. Deleting their account removes it from the events that name them.
       */
      names?: "actor" | "member";
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
      parentAsset: zod.ZodOptional<zod.ZodString>;
      reviewId: zod.ZodString;
      decision: zod.ZodEnum<{
        "age-restricted": "age-restricted";
        allowed: "allowed";
        blocked: "blocked";
        limited: "limited";
        purged: "purged";
      }>;
      appliedToAsset: zod.ZodBoolean;
      reviewerName: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
      note: zod.ZodNullable<zod.ZodString>;
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
      parentAsset: EventFieldDefinition<zod.ZodOptional<zod.ZodString>>;
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
      parentAsset?: string | undefined;
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
      /**
       * A person's name: `actor` names the event's `actor`, `member` the member in the `member-user-id`
       * fact. Deleting their account removes it from the events that name them.
       */
      names?: "actor" | "member";
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
      parentAsset: zod.ZodOptional<zod.ZodString>;
      hashListId: zod.ZodString;
      hashListName: zod.ZodString;
      distance: zod.ZodNumber;
      matchAction: zod.ZodEnum<{
        block: "block";
        flag: "flag";
      }>;
    }, zod.core.$strip>;
  };
  readonly "asset.link-flagged": {
    id: "asset.link-flagged";
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
      parentAsset: EventFieldDefinition<zod.ZodOptional<zod.ZodString>>;
      linkVerdict: EventFieldDefinition<zod.ZodEnum<{
        adult: "adult";
        gambling: "gambling";
        malware: "malware";
        phishing: "phishing";
        safe: "safe";
        unresolved: "unresolved";
      }>>;
      linkUrl: EventFieldDefinition<zod.ZodString>;
      linkFinalUrl: EventFieldDefinition<zod.ZodOptional<zod.ZodNullable<zod.ZodString>>>;
      linkStatus: EventFieldDefinition<zod.ZodEnum<{
        "age-restricted": "age-restricted";
        blocked: "blocked";
        limited: "limited";
      }>>;
    };
    /** Example data, used for synthetic test sends (`createSampleEvent`). */
    example: NoInfer<{
      assetName?: string | null | undefined;
      assetType?: "audio" | "file" | "image" | "multimedia-document" | "plaintext-document" | "video" | "website" | null | undefined;
      parentAsset?: string | undefined;
      linkVerdict: "adult" | "gambling" | "malware" | "phishing" | "safe" | "unresolved";
      linkUrl: string;
      linkFinalUrl?: string | null | undefined;
      linkStatus: "age-restricted" | "blocked" | "limited";
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
      /**
       * A person's name: `actor` names the event's `actor`, `member` the member in the `member-user-id`
       * fact. Deleting their account removes it from the events that name them.
       */
      names?: "actor" | "member";
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
      parentAsset: zod.ZodOptional<zod.ZodString>;
      linkVerdict: zod.ZodEnum<{
        adult: "adult";
        gambling: "gambling";
        malware: "malware";
        phishing: "phishing";
        safe: "safe";
        unresolved: "unresolved";
      }>;
      linkUrl: zod.ZodString;
      linkFinalUrl: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
      linkStatus: zod.ZodEnum<{
        "age-restricted": "age-restricted";
        blocked: "blocked";
        limited: "limited";
      }>;
    }, zod.core.$strip>;
  };
  readonly "usage.free-uploads-exhausted": {
    id: "usage.free-uploads-exhausted";
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
      /**
       * A person's name: `actor` names the event's `actor`, `member` the member in the `member-user-id`
       * fact. Deleting their account removes it from the events that name them.
       */
      names?: "actor" | "member";
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
  readonly "usage.uploads-paused": {
    id: "usage.uploads-paused";
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
      resumesAt: EventFieldDefinition<zod.ZodOptional<zod.ZodNullable<zod.ZodNumber>>>;
    };
    /** Example data, used for synthetic test sends (`createSampleEvent`). */
    example: NoInfer<{
      reason: "payment-failed" | "project-budget" | "spend-limit" | "usage-cap";
      resumesAt?: number | null | undefined;
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
      /**
       * A person's name: `actor` names the event's `actor`, `member` the member in the `member-user-id`
       * fact. Deleting their account removes it from the events that name them.
       */
      names?: "actor" | "member";
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
      resumesAt: zod.ZodOptional<zod.ZodNullable<zod.ZodNumber>>;
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
      /**
       * A person's name: `actor` names the event's `actor`, `member` the member in the `member-user-id`
       * fact. Deleting their account removes it from the events that name them.
       */
      names?: "actor" | "member";
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
        configurator: "configurator";
        custom: "custom";
        editor: "editor";
        viewer: "viewer";
      }>>;
    };
    /** Example data, used for synthetic test sends (`createSampleEvent`). */
    example: NoInfer<{
      memberUserId: string;
      memberName?: string | null | undefined;
      role: "admin" | "configurator" | "custom" | "editor" | "viewer";
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
      /**
       * A person's name: `actor` names the event's `actor`, `member` the member in the `member-user-id`
       * fact. Deleting their account removes it from the events that name them.
       */
      names?: "actor" | "member";
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
        configurator: "configurator";
        custom: "custom";
        editor: "editor";
        viewer: "viewer";
      }>;
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
        configurator: "configurator";
        custom: "custom";
        editor: "editor";
        viewer: "viewer";
      }>>;
    };
    /** Example data, used for synthetic test sends (`createSampleEvent`). */
    example: NoInfer<{
      memberUserId: string;
      memberName?: string | null | undefined;
      role: "admin" | "configurator" | "custom" | "editor" | "viewer";
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
      /**
       * A person's name: `actor` names the event's `actor`, `member` the member in the `member-user-id`
       * fact. Deleting their account removes it from the events that name them.
       */
      names?: "actor" | "member";
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
        configurator: "configurator";
        custom: "custom";
        editor: "editor";
        viewer: "viewer";
      }>;
    }, zod.core.$strip>;
  };
  readonly "project.member-left": {
    id: "project.member-left";
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
        configurator: "configurator";
        custom: "custom";
        editor: "editor";
        viewer: "viewer";
      }>>;
    };
    /** Example data, used for synthetic test sends (`createSampleEvent`). */
    example: NoInfer<{
      memberUserId: string;
      memberName?: string | null | undefined;
      role: "admin" | "configurator" | "custom" | "editor" | "viewer";
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
      /**
       * A person's name: `actor` names the event's `actor`, `member` the member in the `member-user-id`
       * fact. Deleting their account removes it from the events that name them.
       */
      names?: "actor" | "member";
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
        configurator: "configurator";
        custom: "custom";
        editor: "editor";
        viewer: "viewer";
      }>;
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
        configurator: "configurator";
        custom: "custom";
        editor: "editor";
        viewer: "viewer";
      }>>;
      role: EventFieldDefinition<zod.ZodEnum<{
        admin: "admin";
        configurator: "configurator";
        custom: "custom";
        editor: "editor";
        viewer: "viewer";
      }>>;
    };
    /** Example data, used for synthetic test sends (`createSampleEvent`). */
    example: NoInfer<{
      memberUserId: string;
      memberName?: string | null | undefined;
      previousRole: "admin" | "configurator" | "custom" | "editor" | "viewer";
      role: "admin" | "configurator" | "custom" | "editor" | "viewer";
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
      /**
       * A person's name: `actor` names the event's `actor`, `member` the member in the `member-user-id`
       * fact. Deleting their account removes it from the events that name them.
       */
      names?: "actor" | "member";
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
        configurator: "configurator";
        custom: "custom";
        editor: "editor";
        viewer: "viewer";
      }>;
      role: zod.ZodEnum<{
        admin: "admin";
        configurator: "configurator";
        custom: "custom";
        editor: "editor";
        viewer: "viewer";
      }>;
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
        configurator: "configurator";
        custom: "custom";
        editor: "editor";
        viewer: "viewer";
      }>>;
    };
    /** Example data, used for synthetic test sends (`createSampleEvent`). */
    example: NoInfer<{
      inviteeEmail: string;
      role: "admin" | "configurator" | "custom" | "editor" | "viewer";
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
      /**
       * A person's name: `actor` names the event's `actor`, `member` the member in the `member-user-id`
       * fact. Deleting their account removes it from the events that name them.
       */
      names?: "actor" | "member";
      /** Display names for `enum` and `list` values that don't read well humanized. */
      valueLabels?: Readonly<Record<string, string>>;
      schema: zod.ZodType<unknown, unknown, zod.core.$ZodTypeInternals<unknown, unknown>>;
      key: string;
    }[];
    values: zod.ZodObject<{
      inviteeEmail: zod.ZodString;
      role: zod.ZodEnum<{
        admin: "admin";
        configurator: "configurator";
        custom: "custom";
        editor: "editor";
        viewer: "viewer";
      }>;
    }, zod.core.$strip>;
  };
  readonly "project.transferred": {
    id: "project.transferred";
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
      previousOrganisationId: EventFieldDefinition<zod.ZodString>;
      previousOrganisationName: EventFieldDefinition<zod.ZodString>;
      organisationId: EventFieldDefinition<zod.ZodString>;
      organisationName: EventFieldDefinition<zod.ZodString>;
      method: EventFieldDefinition<zod.ZodEnum<{
        handover: "handover";
        move: "move";
      }>>;
      apiKeysRevoked: EventFieldDefinition<zod.ZodNumber>;
      connectorsPaused: EventFieldDefinition<zod.ZodNumber>;
    };
    /** Example data, used for synthetic test sends (`createSampleEvent`). */
    example: NoInfer<{
      previousOrganisationId: string;
      previousOrganisationName: string;
      organisationId: string;
      organisationName: string;
      method: "handover" | "move";
      apiKeysRevoked: number;
      connectorsPaused: number;
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
      /**
       * A person's name: `actor` names the event's `actor`, `member` the member in the `member-user-id`
       * fact. Deleting their account removes it from the events that name them.
       */
      names?: "actor" | "member";
      /** Display names for `enum` and `list` values that don't read well humanized. */
      valueLabels?: Readonly<Record<string, string>>;
      schema: zod.ZodType<unknown, unknown, zod.core.$ZodTypeInternals<unknown, unknown>>;
      key: string;
    }[];
    values: zod.ZodObject<{
      previousOrganisationId: zod.ZodString;
      previousOrganisationName: zod.ZodString;
      organisationId: zod.ZodString;
      organisationName: zod.ZodString;
      method: zod.ZodEnum<{
        handover: "handover";
        move: "move";
      }>;
      apiKeysRevoked: zod.ZodNumber;
      connectorsPaused: zod.ZodNumber;
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
        configurator: "configurator";
        custom: "custom";
        editor: "editor";
        viewer: "viewer";
      }>>;
      createdByName: EventFieldDefinition<zod.ZodOptional<zod.ZodNullable<zod.ZodString>>>;
    };
    /** Example data, used for synthetic test sends (`createSampleEvent`). */
    example: NoInfer<{
      keyId: string;
      keyName?: string | null | undefined;
      role: "admin" | "configurator" | "custom" | "editor" | "viewer";
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
      /**
       * A person's name: `actor` names the event's `actor`, `member` the member in the `member-user-id`
       * fact. Deleting their account removes it from the events that name them.
       */
      names?: "actor" | "member";
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
        configurator: "configurator";
        custom: "custom";
        editor: "editor";
        viewer: "viewer";
      }>;
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
      revokedByName: EventFieldDefinition<zod.ZodOptional<zod.ZodNullable<zod.ZodString>>>;
    };
    /** Example data, used for synthetic test sends (`createSampleEvent`). */
    example: NoInfer<{
      keyId: string;
      keyName?: string | null | undefined;
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
      /**
       * A person's name: `actor` names the event's `actor`, `member` the member in the `member-user-id`
       * fact. Deleting their account removes it from the events that name them.
       */
      names?: "actor" | "member";
      /** Display names for `enum` and `list` values that don't read well humanized. */
      valueLabels?: Readonly<Record<string, string>>;
      schema: zod.ZodType<unknown, unknown, zod.core.$ZodTypeInternals<unknown, unknown>>;
      key: string;
    }[];
    values: zod.ZodObject<{
      keyId: zod.ZodString;
      keyName: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
      revokedByName: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
    }, zod.core.$strip>;
  };
  readonly "api-key.deleted": {
    id: "api-key.deleted";
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
      deletedByName: EventFieldDefinition<zod.ZodOptional<zod.ZodNullable<zod.ZodString>>>;
    };
    /** Example data, used for synthetic test sends (`createSampleEvent`). */
    example: NoInfer<{
      keyId: string;
      keyName?: string | null | undefined;
      deletedByName?: string | null | undefined;
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
      /**
       * A person's name: `actor` names the event's `actor`, `member` the member in the `member-user-id`
       * fact. Deleting their account removes it from the events that name them.
       */
      names?: "actor" | "member";
      /** Display names for `enum` and `list` values that don't read well humanized. */
      valueLabels?: Readonly<Record<string, string>>;
      schema: zod.ZodType<unknown, unknown, zod.core.$ZodTypeInternals<unknown, unknown>>;
      key: string;
    }[];
    values: zod.ZodObject<{
      keyId: zod.ZodString;
      keyName: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
      deletedByName: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
    }, zod.core.$strip>;
  };
  readonly "connector.disabled": {
    id: "connector.disabled";
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
      connectorType: EventFieldDefinition<zod.ZodEnum<{
        email: "email";
        "in-app": "in-app";
        slack: "slack";
        webhook: "webhook";
      }>>;
      consecutiveFailures: EventFieldDefinition<zod.ZodNumber>;
      lastError: EventFieldDefinition<zod.ZodOptional<zod.ZodNullable<zod.ZodString>>>;
    };
    /** Example data, used for synthetic test sends (`createSampleEvent`). */
    example: NoInfer<{
      connectorId: string;
      connectorName: string;
      connectorType: "email" | "in-app" | "slack" | "webhook";
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
      /**
       * A person's name: `actor` names the event's `actor`, `member` the member in the `member-user-id`
       * fact. Deleting their account removes it from the events that name them.
       */
      names?: "actor" | "member";
      /** Display names for `enum` and `list` values that don't read well humanized. */
      valueLabels?: Readonly<Record<string, string>>;
      schema: zod.ZodType<unknown, unknown, zod.core.$ZodTypeInternals<unknown, unknown>>;
      key: string;
    }[];
    values: zod.ZodObject<{
      connectorId: zod.ZodString;
      connectorName: zod.ZodString;
      connectorType: zod.ZodEnum<{
        email: "email";
        "in-app": "in-app";
        slack: "slack";
        webhook: "webhook";
      }>;
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
      /**
       * A person's name: `actor` names the event's `actor`, `member` the member in the `member-user-id`
       * fact. Deleting their account removes it from the events that name them.
       */
      names?: "actor" | "member";
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
      /**
       * A person's name: `actor` names the event's `actor`, `member` the member in the `member-user-id`
       * fact. Deleting their account removes it from the events that name them.
       */
      names?: "actor" | "member";
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