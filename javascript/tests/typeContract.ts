// Compares a declared SDK type with the type the API's schema describes (types.json, written as
// TypeScript to types.generated.ts), and names every difference as `<path>: <problem>`.
// packages/sdk-contract/README.md, "Declared types", has the rules. `tsc` fails when a
// `Mismatches<...>` isn't `never`, and its error lists the differences.

type Flat<T> = { [K in keyof T]: T[K] } & {};

/** The string literals a type lists; an open string (`string`, `string & {}`) lists none. */
type Literals<T> = T extends string ? (string extends T ? never : T) : never;
type IsOpenString<T> = [Extract<T, string>] extends [never]
  ? false
  : string extends Extract<T, string>
    ? true
    : false;

type IsAny<T> = 0 extends 1 & T ? true : false;
type IsUnknown<T> = unknown extends T ? (IsAny<T> extends true ? false : true) : false;

type OptionalKeys<T> = {
  [K in keyof T]-?: {} extends Pick<T, K> ? K : never;
}[keyof T];

type Primitive = string | number | boolean | bigint | symbol;

type NullMismatch<D, E, P extends string> = [null] extends [E]
  ? [null] extends [D]
    ? never
    : `${P}: not nullable, the API allows null`
  : [null] extends [D]
    ? `${P}: nullable, the API never allows null`
    : never;

/**
 * Every difference between declared `D` and expected `E` at path `P`. `Depth` stops the walk
 * inside recursive types.
 */
export type Mismatches<
  D,
  E,
  P extends string,
  Depth extends unknown[] = [],
> = Depth["length"] extends 12
  ? never
  : IsUnknown<E> extends true
    ? never
    : IsAny<E> extends true
      ? never
      : IsAny<D> extends true
        ? never
        :
            | NullMismatch<D, E, P>
            | Compare<Exclude<D, null | undefined>, Exclude<E, null | undefined>, P, Depth>;

type Compare<D, E, P extends string, Depth extends unknown[]> = [E] extends [never]
  ? never
  : [Literals<E>] extends [never]
    ? [E] extends [string]
      ? [D] extends [string]
        ? never
        : `${P}: should be a string`
      : [E] extends [number]
        ? [D] extends [number]
          ? number extends D
            ? never
            : `${P}: should be a number`
          : `${P}: should be a number`
        : [E] extends [boolean]
          ? [D] extends [boolean]
            ? [E] extends [D]
              ? [boolean] extends [E]
                ? never
                : [D] extends [E]
                  ? never
                  : `${P}: should be ${E & boolean}`
              : `${P}: should be ${boolean extends E ? "a boolean" : E & boolean}`
            : `${P}: should be a boolean`
          : [E] extends [readonly (infer EItem)[]]
            ? [D] extends [readonly (infer DItem)[]]
              ? Mismatches<DItem, EItem, `${P}[]`, [...Depth, 0]>
              : `${P}: should be an array`
            : CompareObjects<D, E, P, Depth>
    : CompareEnum<D, E, P>;

type CompareEnum<D, E, P extends string> =
  | ([Exclude<Literals<E>, D>] extends [never]
      ? never
      : `${P}: does not accept ${Exclude<Literals<E>, D> & string}`)
  | (IsOpenString<D> extends true
      ? never
      : [Exclude<Literals<D>, E>] extends [never]
        ? never
        : `${P}: lists ${Exclude<Literals<D>, E> & string}, which the API lacks`);

type CompareObjects<D, E, P extends string, Depth extends unknown[]> = [E] extends [Primitive]
  ? never
  : IsUnion<E> extends true
    ? [Tags<E>] extends [never]
      ? // Untagged unions of objects: each side must accept the other.
        [E] extends [D]
        ? [D] extends [E]
          ? never
          : `${P}: declares a union branch the API lacks`
        : `${P}: does not accept every union branch`
      : TaggedMismatches<D, E, P, Depth>
    : string extends keyof E
      ? IsAny<E[keyof E & string]> extends true
        ? never // An open record, such as transform options: any declared object fits.
        : string extends keyof D
          ? Mismatches<D[keyof D & string], E[keyof E & string], `${P}{}`, [...Depth, 0]>
          : `${P}: should be a record`
      : FieldMismatches<Merge<D>, Flat<E>, P, Depth>;

/**
 * The key that tags a union of objects: `type` (events, extracted text) or `key` (event facts),
 * when every branch has a literal value for it.
 */
type TagKey<T> = [Literals<TagOf<T, "type">>] extends [never]
  ? [Literals<TagOf<T, "key">>] extends [never]
    ? never
    : "key"
  : "type";
type TagOf<T, K extends string> = [T] extends [Record<K, string>] ? T[K & keyof T] : never;
type Tags<T> = Literals<TagOf<T, TagKey<T> & string>>;

/** A tagged union, branch by branch: each API branch against the declared branch with its tag. */
type TaggedMismatches<
  D,
  E,
  P extends string,
  Depth extends unknown[],
  K extends string = TagKey<E> & string,
> =
  | {
      [Tag in Tags<E>]: [Extract<D, Record<K, Tag>>] extends [never]
        ? `${P}<${Tag}>: missing`
        : FieldMismatches<
            Merge<Extract<D, Record<K, Tag>>>,
            Flat<Extract<E, Record<K, Tag>>>,
            `${P}<${Tag}>`,
            [...Depth, 0]
          >;
    }[Tags<E>]
  | {
      [Tag in Literals<TagOf<Extract<D, Record<K, string>>, K>>]: Tag extends Tags<E>
        ? never
        : `${P}<${Tag}>: not in the API`;
    }[Literals<TagOf<Extract<D, Record<K, string>>, K>>];

type AllKeys<T> = T extends unknown ? keyof T : never;
/**
 * A declared union of objects (a decision with or without `confirmPurge`) as one object: each
 * key's types from every branch, optional unless every branch requires it.
 */
type Merge<T> =
  IsUnion<T> extends true
    ? Flat<
        { [K in AllKeys<T> as K extends RequiredInAll<T> ? K : never]: ValueOf<T, K> } & {
          [K in AllKeys<T> as K extends RequiredInAll<T> ? never : K]?: ValueOf<T, K>;
        }
      >
    : Flat<T>;
type ValueOf<T, K extends PropertyKey> = T extends unknown
  ? K extends keyof T
    ? T[K]
    : never
  : never;
type RequiredInAll<T, Branch = T> = Exclude<
  AllKeys<T>,
  Branch extends unknown ? Exclude<AllKeys<T>, keyof Branch> | OptionalKeys<Branch> : never
>;

type FieldMismatches<D, E, P extends string, Depth extends unknown[]> =
  | {
      [K in keyof E & string]: K extends keyof D
        ?
            | (IsAny<E[K]> extends true
                ? never // An open value: the schema cannot say whether it is sent.
                : K extends OptionalKeys<E>
                  ? K extends OptionalKeys<D>
                    ? never
                    : `${P}.${K}: required, the API makes it optional`
                  : K extends OptionalKeys<D>
                    ? `${P}.${K}: optional, the API requires it`
                    : never)
            | Mismatches<D[K], E[K], `${P}.${K}`, [...Depth, 0]>
        : `${P}.${K}: missing`;
    }[keyof E & string]
  | {
      [K in keyof D & string]: K extends keyof E ? never : `${P}.${K}: not in the API`;
    }[keyof D & string];

type UnionToIntersection<U> = (U extends unknown ? (value: U) => void : never) extends (
  value: infer I,
) => void
  ? I
  : never;
type IsUnion<T> = [T] extends [UnionToIntersection<T>] ? false : true;

/** Compiles only when `T` is `never`; otherwise the error shows each difference. */
export const noMismatches = <T extends never>(): T | undefined => undefined;

/** The differences that count: every `Mismatches` except those of switched-off features. */
export type Differences<D, E, P extends string> = Exclude<Mismatches<D, E, P>, SwitchedOff>;

/**
 * Options of an operation that is not a PATCH, where `null` means the same as leaving a field
 * out: the SDK may refuse a `null` the API accepts, but never accept one it refuses.
 */
export type InputDifferences<D, E, P extends string> = Exclude<
  Differences<D, E, P>,
  `${string}: not nullable, the API allows null`
>;

/**
 * Features the API leaves out of its schemas while their switch is off (`ENABLE_*` in
 * packages/shared/src/SharedConstants.ts). The SDK's types come from the API's TypeScript
 * declarations, which keep them, so they are not differences.
 */
type SwitchedOff =
  // ENABLE_AI_GENERATED_DETECTION
  | `${string}.aiGeneratedDetection: not in the API`
  // ENABLE_LINK_SAFETY
  | `${string}.linkSafety: not in the API`
  | `${string}: lists asset.link-flagged, which the API lacks`
  | `${string}<asset.link-flagged>: not in the API`
  | `${string}: lists link-safety, which the API lacks`
  // ENABLE_APPEALS
  | `${string}: lists appeal.${string}, which the API lacks`
  | `${string}<appeal.${string}>: not in the API`;
