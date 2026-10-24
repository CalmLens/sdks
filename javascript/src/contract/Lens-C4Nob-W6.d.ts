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
          "x-enumDescriptions": ["JPEG.", "PNG.", "WebP.", "AVIF.", "GIF."];
          description: "The output format. Leave it out to serve the best format the browser accepts.";
        };
        width: {
          type: "integer";
          minimum: 1;
          maximum: 10000;
          description: "The width in pixels, 1 to 10,000 after `dpr`. With a size and no `fit`, the image scales down.";
        };
        height: {
          type: "integer";
          minimum: 1;
          maximum: 10000;
          description: "The height in pixels, 1 to 10,000 after `dpr`.";
        };
        dpr: {
          type: "number";
          minimum: 1;
          maximum: 3;
          description: "The pixel density, 1 to 3: multiplies the width, height and border width.";
        };
        anim: {
          type: "boolean";
          description: "`false` serves the first frame of an animated GIF or WebP.";
        };
        background: {
          type: "string";
          "x-colour": true;
          description: "The background colour, such as `#ffffff`, for padding and transparency.";
        };
        blur: {
          type: "number";
          description: "The blur radius.";
        };
        border: {
          type: "object";
          title: "Border";
          description: "A border drawn around the image.";
          properties: {
            color: {
              type: "string";
              "x-colour": true;
              description: "The border colour.";
            };
            width: {
              type: "number";
              description: "The border width in pixels.";
            };
          };
          required: [];
          additionalProperties: false;
        };
        brightness: {
          type: "number";
          description: "The brightness factor.";
        };
        contrast: {
          type: "number";
          description: "The contrast factor.";
        };
        quality: {
          description: "The quality: 1 to 100, or a level. Lossy output defaults to `high`.";
          oneOf: [{
            type: "integer";
            minimum: 1;
            maximum: 100;
          }, {
            type: "string";
            title: "QualityLevel";
            description: "A named image quality.";
            enum: ["low", "medium", "high"];
            "x-enumDescriptions": ["Low quality, the smallest files.", "Medium quality.", "High quality."];
          }];
        };
        fit: {
          type: "string";
          enum: ["scale-down", "contain", "pad", "squeeze", "cover", "crop"];
          "x-enumDescriptions": ["Shrink to fit, never enlarge.", "Fit inside the box, keeping the aspect ratio.", "Fit inside the box and pad to fill it with `background`.", "Stretch to fill the box.", "Fill the box, cropping the overflow.", "Crop to the box without enlarging."];
          description: "How the image fits the `width` and `height`.";
        };
        flip: {
          type: "string";
          enum: ["h", "v", "hv"];
          "x-enumDescriptions": ["Horizontally.", "Vertically.", "Both."];
          description: "Flips the image horizontally (`h`), vertically (`v`) or both (`hv`).";
        };
        gamma: {
          type: "number";
          description: "The gamma.";
        };
        segment: {
          type: "string";
          enum: ["foreground"];
          "x-enumDescriptions": ["Keep the foreground and remove the background."];
          description: "`foreground` removes the background.";
        };
        gravity: {
          description: "Where to keep when cropping: a side, `face`, `auto`, or a point.";
          oneOf: [{
            type: "string";
            title: "GravitySide";
            description: "A named crop position.";
            enum: ["face", "left", "right", "top", "bottom", "center", "auto", "entropy"];
            "x-enumDescriptions": ["Centre on detected faces.", "The left edge.", "The right edge.", "The top edge.", "The bottom edge.", "The centre.", "Chosen automatically.", "The most detailed area."];
          }, {
            type: "object";
            title: "GravityPoint";
            properties: {
              mode: {
                type: "string";
                title: "GravityMode";
                enum: ["remainder", "box-center"];
                "x-enumDescriptions": ["`x` and `y` are fractions of the space left over after resizing.", "`x` and `y` are the centre of the crop box, as fractions of the image."];
                description: "How `x` and `y` place the point.";
              };
              x: {
                type: "number";
                description: "The horizontal position, 0 to 1.";
              };
              y: {
                type: "number";
                description: "The vertical position, 0 to 1.";
              };
            };
            required: ["mode"];
            additionalProperties: false;
          }];
        };
        rotate: {
          type: "integer";
          enum: [0, 90, 180, 270];
          description: "The clockwise rotation in degrees.";
        };
        saturation: {
          type: "number";
          description: "The saturation factor.";
        };
        sharpen: {
          type: "number";
          description: "The sharpen amount.";
        };
        trim: {
          description: "Trims the edges: `border` trims a detected border, or give edges and sizes.";
          oneOf: [{
            type: "string";
            enum: ["border"];
          }, {
            type: "object";
            title: "Trim";
            properties: {
              top: {
                type: "number";
                description: "Pixels to trim from the top.";
              };
              bottom: {
                type: "number";
                description: "Pixels to trim from the bottom.";
              };
              left: {
                type: "number";
                description: "Pixels to trim from the left.";
              };
              right: {
                type: "number";
                description: "Pixels to trim from the right.";
              };
              width: {
                type: "number";
                description: "The width to keep.";
              };
              height: {
                type: "number";
                description: "The height to keep.";
              };
              border: {
                description: "Trims a uniform border: `true`, or how to detect it.";
                oneOf: [{
                  type: "boolean";
                }, {
                  type: "object";
                  title: "TrimBorder";
                  properties: {
                    color: {
                      type: "string";
                      "x-colour": true;
                      description: "The border colour to trim.";
                    };
                    tolerance: {
                      type: "number";
                      description: "How far colours may differ.";
                    };
                    keep: {
                      type: "number";
                      description: "Pixels of border to keep.";
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