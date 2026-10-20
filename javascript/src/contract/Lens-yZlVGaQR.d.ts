import * as zod from "zod";
import { FromSchema, JSONSchema } from "json-schema-to-ts";
//#region packages/shared/src/AssetTransform.d.ts
interface AssetTransform<T extends string = string, O = unknown> {
  type: T;
  options: O;
}
interface AssetTransformType<T extends string = string, OSchema extends JSONSchema = JSONSchema> {
  type: T;
  optionsSchema: OSchema;
}
declare const DEFAULT_ASSET_TRANSFORMS: {
  readonly imageTransform: {
    readonly type: "imageTransform";
    readonly optionsSchema: {
      type: "object";
      properties: {
        format: {
          type: "string";
          enum: ["jpg", "png", "webp", "avif", "gif"];
        };
        width: {
          type: "integer";
          minimum: 0;
        };
        height: {
          type: "integer";
          minimum: 0;
        };
        background: {
          type: "string";
        };
        blur: {
          type: "number";
        };
        border: {
          type: "object";
          properties: {
            color: {
              type: "string";
            };
            width: {
              type: "number";
            };
          };
          required: [];
          additionalProperties: false;
        };
        brightness: {
          type: "number";
        };
        contrast: {
          type: "number";
        };
        quality: {
          type: "integer";
          minimum: 0;
          maximum: 255;
        };
        fit: {
          type: "string";
          enum: ["scale-down", "contain", "pad", "squeeze", "cover", "crop"];
        };
        flip: {
          type: "string";
          enum: ["h", "v", "hv"];
        };
        gamma: {
          type: "number";
        };
        segment: {
          type: "string";
          enum: ["foreground"];
        };
        gravity: {
          oneOf: [{
            type: "string";
            enum: ["face", "left", "right", "top", "bottom", "center", "auto", "entropy"];
          }, {
            type: "object";
            properties: {
              mode: {
                type: "string";
                enum: ["remainder", "box-center"];
              };
              x: {
                type: "number";
              };
              y: {
                type: "number";
              };
            };
            required: ["mode"];
            additionalProperties: false;
          }];
        };
        rotate: {
          type: "integer";
          enum: [0, 90, 180, 270];
        };
        saturation: {
          type: "number";
        };
        sharpen: {
          type: "number";
        };
        trim: {
          oneOf: [{
            type: "string";
            enum: ["border"];
          }, {
            type: "object";
            properties: {
              top: {
                type: "number";
              };
              bottom: {
                type: "number";
              };
              left: {
                type: "number";
              };
              right: {
                type: "number";
              };
              width: {
                type: "number";
              };
              height: {
                type: "number";
              };
              border: {
                oneOf: [{
                  type: "boolean";
                }, {
                  type: "object";
                  properties: {
                    color: {
                      type: "string";
                    };
                    tolerance: {
                      type: "number";
                    };
                    keep: {
                      type: "number";
                    };
                  };
                  required: [];
                  additionalProperties: false;
                }];
              };
            };
            required: [];
            additionalProperties: false;
          }];
        };
      };
      required: [];
      additionalProperties: false;
    };
  };
};
type AssetTransformForType<TType extends AssetTransformType> = TType extends AssetTransformType<infer T, infer O> ? AssetTransform<T, FromSchema<O>> : never;
type DefaultAssetTransformType = keyof typeof DEFAULT_ASSET_TRANSFORMS;
type DefaultAssetTransform = AssetTransformForType<(typeof DEFAULT_ASSET_TRANSFORMS)[DefaultAssetTransformType]>;
//#endregion
//#region packages/shared/src/Lens.d.ts
declare const LENS_TYPE_SCHEMA: zod.ZodEnum<{
  audio: "audio";
  document: "document";
  image: "image";
  video: "video";
  website: "website";
}>;
type LensType = zod.infer<typeof LENS_TYPE_SCHEMA>;
declare const LENS_SCHEMA: zod.ZodObject<{
  id: zod.ZodString;
  projectId: zod.ZodOptional<zod.ZodNullable<zod.ZodString>>;
  userId: zod.ZodOptional<zod.ZodNullable<zod.ZodPipe<zod.ZodString, zod.ZodTransform<string, string>>>>;
  version: zod.ZodDefault<zod.ZodNumber>;
  identifier: zod.ZodString;
  name: zod.ZodPipe<zod.ZodString, zod.ZodTransform<string, string>>;
  description: zod.ZodOptional<zod.ZodNullable<zod.ZodPipe<zod.ZodString, zod.ZodTransform<string, string>>>>;
  type: zod.ZodEnum<{
    audio: "audio";
    document: "document";
    image: "image";
    video: "video";
    website: "website";
  }>;
  active: zod.ZodBoolean;
  transforms: zod.ZodOptional<zod.ZodNullable<zod.ZodArray<zod.ZodObject<{
    type: zod.ZodString;
    options: zod.ZodUnknown;
  }, zod.core.$strip>>>>;
  createdAt: zod.ZodNumber;
  updatedAt: zod.ZodOptional<zod.ZodNumber>;
}, zod.core.$strip>;
type Lens = Omit<zod.infer<typeof LENS_SCHEMA>, "transforms"> & {
  transforms?: Array<DefaultAssetTransform | AssetTransform> | null;
};
//#endregion
export { Lens as n, LensType as r, LENS_SCHEMA as t };