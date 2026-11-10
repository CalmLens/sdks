import "./Asset-C5CJR7RH.js";
import * as zod from "zod";
declare const UPLOAD_PRESET_SCHEMA: zod.ZodObject<{
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
type UploadPreset = zod.infer<typeof UPLOAD_PRESET_SCHEMA>;
export { UploadPreset as t };