import "./Classification-CxRedzgH.js";
import "./UploadPreset-BoAKW8Dy.js";
import * as zod from "zod";
declare const PUBLIC_UPLOAD_PRESET_SCHEMA: zod.ZodObject<{
  id: zod.ZodString;
  projectId: zod.ZodString;
  createdByUserId: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
  key: zod.ZodString;
  revision: zod.ZodNumber;
  name: zod.ZodPipe<zod.ZodString, zod.ZodTransform<string, string>>;
  access: zod.ZodEnum<{
    anyone: "anyone";
    token: "token";
  }>;
  enabled: zod.ZodBoolean;
  allowedContentTypes: zod.ZodOptional<zod.ZodNullable<zod.ZodArray<zod.ZodString>>>;
  maxSizeInBytes: zod.ZodOptional<zod.ZodNullable<zod.ZodNumber>>;
  folderId: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
  policyId: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
  visibility: zod.ZodEnum<{
    private: "private";
    public: "public";
  }>;
  processingOptions: zod.ZodOptional<zod.ZodNullable<zod.ZodObject<{
    retainContent: zod.ZodOptional<zod.ZodNullable<zod.ZodBoolean>>;
    storeSensitiveMetadata: zod.ZodOptional<zod.ZodNullable<zod.ZodBoolean>>;
    features: zod.ZodOptional<zod.ZodNullable<zod.ZodObject<{
      ocr: zod.ZodOptional<zod.ZodNullable<zod.ZodObject<{
        enabled: zod.ZodBoolean;
      }, zod.core.$strict>>>;
      personDetection: zod.ZodOptional<zod.ZodNullable<zod.ZodObject<{
        enabled: zod.ZodBoolean;
      }, zod.core.$strict>>>;
      faceDetection: zod.ZodOptional<zod.ZodNullable<zod.ZodObject<{
        enabled: zod.ZodBoolean;
        ageEstimation: zod.ZodOptional<zod.ZodBoolean>;
      }, zod.core.$strict>>>;
      linkDetection: zod.ZodOptional<zod.ZodNullable<zod.ZodObject<{
        enabled: zod.ZodBoolean;
      }, zod.core.$strict>>>;
      aiGeneratedDetection: zod.ZodOptional<zod.ZodNullable<zod.ZodObject<{
        enabled: zod.ZodBoolean;
      }, zod.core.$strict>>>;
      streaming: zod.ZodOptional<zod.ZodNullable<zod.ZodObject<{
        enabled: zod.ZodBoolean;
      }, zod.core.$strict>>>;
    }, zod.core.$strict>>>;
  }, zod.core.$strict>>>;
  revealDecision: zod.ZodBoolean;
  dailyUploadLimit: zod.ZodOptional<zod.ZodNullable<zod.ZodNumber>>;
  allowedOrigins: zod.ZodOptional<zod.ZodNullable<zod.ZodArray<zod.ZodString>>>;
  createdAt: zod.ZodNumber;
  updatedAt: zod.ZodOptional<zod.ZodNumber>;
}, zod.core.$strip>;
/**
 * One preset in an ensure-upload-presets request: its whole definition, addressed by key. Fields
 * left out take their defaults, so a preset matches what was sent.
 */
declare const ENSURE_UPLOAD_PRESET_SCHEMA: zod.ZodObject<{
  key: zod.ZodString;
  revision: zod.ZodOptional<zod.ZodNumber>;
  name: zod.ZodPipe<zod.ZodString, zod.ZodTransform<string, string>>;
  access: zod.ZodDefault<zod.ZodEnum<{
    anyone: "anyone";
    token: "token";
  }>>;
  enabled: zod.ZodDefault<zod.ZodBoolean>;
  allowedContentTypes: zod.ZodOptional<zod.ZodNullable<zod.ZodArray<zod.ZodString>>>;
  maxSizeInBytes: zod.ZodOptional<zod.ZodNullable<zod.ZodNumber>>;
  folderId: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
  policyId: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
  visibility: zod.ZodDefault<zod.ZodEnum<{
    private: "private";
    public: "public";
  }>>;
  processingOptions: zod.ZodOptional<zod.ZodNullable<zod.ZodObject<{
    retainContent: zod.ZodOptional<zod.ZodNullable<zod.ZodBoolean>>;
    storeSensitiveMetadata: zod.ZodOptional<zod.ZodNullable<zod.ZodBoolean>>;
    features: zod.ZodOptional<zod.ZodNullable<zod.ZodObject<{
      ocr: zod.ZodOptional<zod.ZodNullable<zod.ZodObject<{
        enabled: zod.ZodBoolean;
      }, zod.core.$strict>>>;
      personDetection: zod.ZodOptional<zod.ZodNullable<zod.ZodObject<{
        enabled: zod.ZodBoolean;
      }, zod.core.$strict>>>;
      faceDetection: zod.ZodOptional<zod.ZodNullable<zod.ZodObject<{
        enabled: zod.ZodBoolean;
        ageEstimation: zod.ZodOptional<zod.ZodBoolean>;
      }, zod.core.$strict>>>;
      linkDetection: zod.ZodOptional<zod.ZodNullable<zod.ZodObject<{
        enabled: zod.ZodBoolean;
      }, zod.core.$strict>>>;
      aiGeneratedDetection: zod.ZodOptional<zod.ZodNullable<zod.ZodObject<{
        enabled: zod.ZodBoolean;
      }, zod.core.$strict>>>;
      streaming: zod.ZodOptional<zod.ZodNullable<zod.ZodObject<{
        enabled: zod.ZodBoolean;
      }, zod.core.$strict>>>;
    }, zod.core.$strict>>>;
  }, zod.core.$strict>>>;
  revealDecision: zod.ZodDefault<zod.ZodBoolean>;
  dailyUploadLimit: zod.ZodOptional<zod.ZodNullable<zod.ZodNumber>>;
  allowedOrigins: zod.ZodOptional<zod.ZodNullable<zod.ZodArray<zod.ZodString>>>;
}, zod.core.$strict>;
type EnsureUploadPresetInput = zod.input<typeof ENSURE_UPLOAD_PRESET_SCHEMA>;
/**
 * The settings the project settings endpoints read and replace. Its policy and metadata fields have
 * their own endpoints, so they aren't listed here.
 */
declare const PUBLIC_PROJECT_SETTINGS_SCHEMA: zod.ZodObject<{
  retainContent: zod.ZodDefault<zod.ZodBoolean>;
  optOutJurisdictions: zod.ZodDefault<zod.ZodArray<zod.ZodEnum<{
    EU: "EU";
  }>>>;
  blockUnmoderatedAssets: zod.ZodDefault<zod.ZodBoolean>;
  storeSensitiveMetadata: zod.ZodDefault<zod.ZodBoolean>;
  streamingEnabled: zod.ZodDefault<zod.ZodBoolean>;
  aiMediaSearchEnabled: zod.ZodDefault<zod.ZodBoolean>;
  remoteUrlRule: zod.ZodDefault<zod.ZodNullable<zod.ZodObject<{
    mode: zod.ZodEnum<{
      allow: "allow";
      deny: "deny";
    }>;
    domains: zod.ZodArray<zod.ZodString>;
  }, zod.core.$strip>>>;
  websiteSubmissionsPerMinute: zod.ZodDefault<zod.ZodNullable<zod.ZodNumber>>;
  humanReview: zod.ZodDefault<zod.ZodObject<{
    allowedSamplePercent: zod.ZodDefault<zod.ZodNumber>;
    restrictedSamplePercent: zod.ZodDefault<zod.ZodNumber>;
    uncertaintyMarginPercent: zod.ZodDefault<zod.ZodNumber>;
    reviewMissingEvidence: zod.ZodDefault<zod.ZodBoolean>;
  }, zod.core.$strict>>;
}, zod.core.$strict>;
type PublicProjectSettings = zod.infer<typeof PUBLIC_PROJECT_SETTINGS_SCHEMA>;
declare const PROJECT_SETTINGS_RESOURCE_SCHEMA: zod.ZodObject<{
  projectId: zod.ZodString;
  revision: zod.ZodNumber;
  settings: zod.ZodObject<{
    retainContent: zod.ZodDefault<zod.ZodBoolean>;
    optOutJurisdictions: zod.ZodDefault<zod.ZodArray<zod.ZodEnum<{
      EU: "EU";
    }>>>;
    blockUnmoderatedAssets: zod.ZodDefault<zod.ZodBoolean>;
    storeSensitiveMetadata: zod.ZodDefault<zod.ZodBoolean>;
    streamingEnabled: zod.ZodDefault<zod.ZodBoolean>;
    aiMediaSearchEnabled: zod.ZodDefault<zod.ZodBoolean>;
    remoteUrlRule: zod.ZodDefault<zod.ZodNullable<zod.ZodObject<{
      mode: zod.ZodEnum<{
        allow: "allow";
        deny: "deny";
      }>;
      domains: zod.ZodArray<zod.ZodString>;
    }, zod.core.$strip>>>;
    websiteSubmissionsPerMinute: zod.ZodDefault<zod.ZodNullable<zod.ZodNumber>>;
    humanReview: zod.ZodDefault<zod.ZodObject<{
      allowedSamplePercent: zod.ZodDefault<zod.ZodNumber>;
      restrictedSamplePercent: zod.ZodDefault<zod.ZodNumber>;
      uncertaintyMarginPercent: zod.ZodDefault<zod.ZodNumber>;
      reviewMissingEvidence: zod.ZodDefault<zod.ZodBoolean>;
    }, zod.core.$strict>>;
  }, zod.core.$strict>;
}, zod.core.$strip>;
type ProjectSettingsResource = zod.infer<typeof PROJECT_SETTINGS_RESOURCE_SCHEMA>;
declare const PUT_PROJECT_SETTINGS_BODY_SCHEMA: zod.ZodObject<{
  revision: zod.ZodOptional<zod.ZodNumber>;
  settings: zod.ZodObject<{
    retainContent: zod.ZodDefault<zod.ZodBoolean>;
    optOutJurisdictions: zod.ZodDefault<zod.ZodArray<zod.ZodEnum<{
      EU: "EU";
    }>>>;
    blockUnmoderatedAssets: zod.ZodDefault<zod.ZodBoolean>;
    storeSensitiveMetadata: zod.ZodDefault<zod.ZodBoolean>;
    streamingEnabled: zod.ZodDefault<zod.ZodBoolean>;
    aiMediaSearchEnabled: zod.ZodDefault<zod.ZodBoolean>;
    remoteUrlRule: zod.ZodDefault<zod.ZodNullable<zod.ZodObject<{
      mode: zod.ZodEnum<{
        allow: "allow";
        deny: "deny";
      }>;
      domains: zod.ZodArray<zod.ZodString>;
    }, zod.core.$strip>>>;
    websiteSubmissionsPerMinute: zod.ZodDefault<zod.ZodNullable<zod.ZodNumber>>;
    humanReview: zod.ZodDefault<zod.ZodObject<{
      allowedSamplePercent: zod.ZodDefault<zod.ZodNumber>;
      restrictedSamplePercent: zod.ZodDefault<zod.ZodNumber>;
      uncertaintyMarginPercent: zod.ZodDefault<zod.ZodNumber>;
      reviewMissingEvidence: zod.ZodDefault<zod.ZodBoolean>;
    }, zod.core.$strict>>;
  }, zod.core.$strict>;
  searchIndexingBudgetUnits: zod.ZodOptional<zod.ZodNumber>;
}, zod.core.$strict>;
type PutProjectSettingsBody = zod.input<typeof PUT_PROJECT_SETTINGS_BODY_SCHEMA>;
declare const METADATA_FIELDS_RESOURCE_SCHEMA: zod.ZodObject<{
  projectId: zod.ZodString;
  revision: zod.ZodNumber;
  fields: zod.ZodArray<zod.ZodObject<{
    id: zod.ZodString;
    title: zod.ZodString;
    description: zod.ZodOptional<zod.ZodString>;
    type: zod.ZodEnum<{
      boolean: "boolean";
      date: "date";
      number: "number";
      string: "string";
      url: "url";
    }>;
    icon: zod.ZodEnum<{
      folder: "folder";
      hash: "hash";
      layers: "layers";
      link: "link";
      photo: "photo";
      tag: "tag";
      user: "user";
    }>;
    color: zod.ZodString;
  }, zod.core.$strip>>;
}, zod.core.$strip>;
type MetadataFieldsResource = zod.infer<typeof METADATA_FIELDS_RESOURCE_SCHEMA>;
declare const ENSURE_METADATA_FIELDS_BODY_SCHEMA: zod.ZodObject<{
  revision: zod.ZodOptional<zod.ZodNumber>;
  fields: zod.ZodArray<zod.ZodObject<{
    id: zod.ZodString;
    title: zod.ZodString;
    description: zod.ZodOptional<zod.ZodString>;
    type: zod.ZodEnum<{
      boolean: "boolean";
      date: "date";
      number: "number";
      string: "string";
      url: "url";
    }>;
    icon: zod.ZodEnum<{
      folder: "folder";
      hash: "hash";
      layers: "layers";
      link: "link";
      photo: "photo";
      tag: "tag";
      user: "user";
    }>;
    color: zod.ZodString;
  }, zod.core.$strip>>;
}, zod.core.$strict>;
type EnsureMetadataFieldsBody = zod.input<typeof ENSURE_METADATA_FIELDS_BODY_SCHEMA>;
export { ProjectSettingsResource as a, PUBLIC_UPLOAD_PRESET_SCHEMA as i, EnsureUploadPresetInput as n, PublicProjectSettings as o, MetadataFieldsResource as r, PutProjectSettingsBody as s, EnsureMetadataFieldsBody as t };