import * as zod from "zod";
/**
 * Optional analyses a request can turn on with `processingOptions.features.<id>`. The catalog is
 * the single source for the request and result schemas, cache keys and metering. Features are
 * chosen per request only; there is no project-level default.
 */
/** How mature a feature is. Beta results may change shape. */
declare const PROCESSING_FEATURE_STAGES: readonly ["beta", "ga"];
type ProcessingFeatureStage = (typeof PROCESSING_FEATURE_STAGES)[number];
declare const PROCESSING_FEATURE_IDS: readonly ["ocr", "personDetection", "faceDetection"];
type ProcessingFeatureId = (typeof PROCESSING_FEATURE_IDS)[number];
declare const PROCESSING_FEATURES_SCHEMA: zod.ZodObject<{
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
}, zod.core.$strict>;
type ProcessingFeatures = zod.infer<typeof PROCESSING_FEATURES_SCHEMA>;
/** Position and size as fractions of the image width and height, from 0 to 1. */
declare const BOUNDING_BOX_SCHEMA: zod.ZodObject<{
  left: zod.ZodNumber;
  top: zod.ZodNumber;
  width: zod.ZodNumber;
  height: zod.ZodNumber;
}, zod.core.$strict>;
type BoundingBox = zod.infer<typeof BOUNDING_BOX_SCHEMA>;
declare const AGE_RANGE_SCHEMA: zod.ZodObject<{
  low: zod.ZodNumber;
  high: zod.ZodNumber;
}, zod.core.$strict>;
type AgeRange = zod.infer<typeof AGE_RANGE_SCHEMA>;
declare const DETECTED_PERSON_SCHEMA: zod.ZodObject<{
  box: zod.ZodObject<{
    left: zod.ZodNumber;
    top: zod.ZodNumber;
    width: zod.ZodNumber;
    height: zod.ZodNumber;
  }, zod.core.$strict>;
  confidence: zod.ZodNumber;
}, zod.core.$strict>;
type DetectedPerson = zod.infer<typeof DETECTED_PERSON_SCHEMA>;
declare const DETECTED_FACE_SCHEMA: zod.ZodObject<{
  box: zod.ZodObject<{
    left: zod.ZodNumber;
    top: zod.ZodNumber;
    width: zod.ZodNumber;
    height: zod.ZodNumber;
  }, zod.core.$strict>;
  confidence: zod.ZodNumber;
  ageRange: zod.ZodOptional<zod.ZodObject<{
    low: zod.ZodNumber;
    high: zod.ZodNumber;
  }, zod.core.$strict>>;
}, zod.core.$strict>;
type DetectedFace = zod.infer<typeof DETECTED_FACE_SCHEMA>;
declare const PROCESSING_FEATURE_RESULTS_SCHEMA: zod.ZodObject<{
  personDetection: zod.ZodOptional<zod.ZodDiscriminatedUnion<[zod.ZodObject<{
    status: zod.ZodLiteral<"evaluated">;
    stage: zod.ZodEnum<{
      beta: "beta";
      ga: "ga";
    }>;
    people: zod.ZodArray<zod.ZodObject<{
      box: zod.ZodObject<{
        left: zod.ZodNumber;
        top: zod.ZodNumber;
        width: zod.ZodNumber;
        height: zod.ZodNumber;
      }, zod.core.$strict>;
      confidence: zod.ZodNumber;
    }, zod.core.$strict>>;
  }, zod.core.$strict>, zod.ZodObject<{
    status: zod.ZodLiteral<"not-evaluated">;
    stage: zod.ZodEnum<{
      beta: "beta";
      ga: "ga";
    }>;
    reason: zod.ZodEnum<{
      "not-supported": "not-supported";
      unavailable: "unavailable";
    }>;
  }, zod.core.$strict>], "status">>;
  faceDetection: zod.ZodOptional<zod.ZodDiscriminatedUnion<[zod.ZodObject<{
    status: zod.ZodLiteral<"evaluated">;
    stage: zod.ZodEnum<{
      beta: "beta";
      ga: "ga";
    }>;
    faces: zod.ZodArray<zod.ZodObject<{
      box: zod.ZodObject<{
        left: zod.ZodNumber;
        top: zod.ZodNumber;
        width: zod.ZodNumber;
        height: zod.ZodNumber;
      }, zod.core.$strict>;
      confidence: zod.ZodNumber;
      ageRange: zod.ZodOptional<zod.ZodObject<{
        low: zod.ZodNumber;
        high: zod.ZodNumber;
      }, zod.core.$strict>>;
    }, zod.core.$strict>>;
  }, zod.core.$strict>, zod.ZodObject<{
    status: zod.ZodLiteral<"not-evaluated">;
    stage: zod.ZodEnum<{
      beta: "beta";
      ga: "ga";
    }>;
    reason: zod.ZodEnum<{
      "not-supported": "not-supported";
      unavailable: "unavailable";
    }>;
  }, zod.core.$strict>], "status">>;
}, zod.core.$strict>;
type ProcessingFeatureResults = zod.infer<typeof PROCESSING_FEATURE_RESULTS_SCHEMA>;
export type { AgeRange, BoundingBox, DetectedFace, DetectedPerson, ProcessingFeatureId, ProcessingFeatureResults, ProcessingFeatureStage, ProcessingFeatures };