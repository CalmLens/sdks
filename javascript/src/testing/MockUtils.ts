import { invalidArgument } from "../client/CalmLensError";
import type {
  Asset,
  AssetSearchResponse,
  AssetType,
  SubmitAssetOptions,
} from "../client/CalmLensTypes";
import type { CursorPage, CursorPageQuery, Page } from "../contract/Page.js";

export const toRawBase64 = (value: string): string => {
  const marker = ";base64,";
  const markerIndex = value.indexOf(marker);
  if (markerIndex === -1) {
    return value;
  }
  return value.slice(markerIndex + marker.length);
};

export const byteLengthFromBase64 = (value: string): number => {
  const raw = toRawBase64(value);
  return Math.floor((raw.length * 3) / 4) - (raw.endsWith("==") ? 2 : raw.endsWith("=") ? 1 : 0);
};

export const base64ToArrayBuffer = (value: string): ArrayBuffer => {
  const raw = toRawBase64(value);
  let bytes: Uint8Array;
  if (typeof Buffer !== "undefined") {
    bytes = new Uint8Array(Buffer.from(raw, "base64"));
  } else {
    const binary = atob(raw);
    bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  }
  const arrayBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(arrayBuffer).set(bytes);
  return arrayBuffer;
};

export const inferAssetType = (options: SubmitAssetOptions): AssetType => {
  if ("url" in options) {
    return "website";
  }

  const type = "content" in options ? options.content.type : options.part.type;
  if (type.startsWith("image/") || ["jpg", "jpeg", "png", "gif", "webp", "avif"].includes(type)) {
    return "image";
  }
  if (type.startsWith("video/")) {
    return "video";
  }
  if (type.startsWith("audio/")) {
    return "audio";
  }
  if (type === "text/plain" || type === "txt" || type.startsWith("text/")) {
    return "plaintext-document";
  }
  if (type.includes("pdf") || type.includes("document") || ["pdf", "doc", "docx"].includes(type)) {
    return "multimedia-document";
  }
  return "file";
};

type Ordering = NonNullable<Page<unknown>["ordering"]>;

export const createPage = <T extends { id: string; createdAt: number }>(
  items: T[],
  query: CursorPageQuery,
): CursorPage<T> => {
  const pageSize = query.pageSize ?? 10;
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100)
    throw invalidArgument("Invalid page size");
  const ordering: NonNullable<CursorPageQuery["ordering"]> = query.ordering?.length
    ? [...query.ordering]
    : [{ field: "createdAt", direction: "DESC" } as const];
  if (ordering.some(({ field }) => field !== "createdAt" && field !== "id"))
    throw invalidArgument("Invalid ordering");
  if (!ordering.some(({ field }) => field === "id"))
    ordering.push({ field: "id", direction: ordering[0]!.direction });
  let remaining = orderItems(items, ordering);
  if (query.cursor) {
    let values: unknown[];
    try {
      values = JSON.parse(atob(query.cursor));
      if (
        !Array.isArray(values) ||
        values.length !== ordering.length ||
        values.some((value, i) =>
          ordering[i]!.field === "id"
            ? typeof value !== "string"
            : typeof value !== "number" || !Number.isFinite(value),
        )
      )
        throw new Error();
    } catch {
      throw invalidArgument("Invalid cursor");
    }
    remaining = remaining.filter((item) => {
      for (const [i, rule] of ordering.entries()) {
        const result = compareValues(item[rule.field as keyof T], values[i]);
        if (result) return rule.direction === "DESC" ? result < 0 : result > 0;
      }
      return false;
    });
  }
  const pageItems = remaining.slice(0, pageSize);
  const hasMore = remaining.length > pageSize;
  const last = pageItems.at(-1);
  return {
    items: pageItems,
    pageSize,
    hasMore,
    ordering,
    nextCursor:
      hasMore && last
        ? btoa(JSON.stringify(ordering.map(({ field }) => last[field as keyof T])))
        : null,
  };
};

const compareValues = (left: unknown, right: unknown): number => {
  if (left === right) return 0;
  if (left === undefined || left === null) return -1;
  if (right === undefined || right === null) return 1;
  if (typeof left === "number" && typeof right === "number") return left - right;
  return String(left).localeCompare(String(right));
};

/** Sorts like the API's `ordering`; without one, newest first. */
export const orderItems = <T>(items: T[], ordering: Ordering | null | undefined): T[] => {
  const rules: Ordering = ordering?.length
    ? ordering
    : ([{ field: "createdAt", direction: "DESC" }] as Ordering);
  return [...items].sort((a, b) => {
    for (const rule of rules) {
      const result = compareValues(
        (a as Record<string, unknown>)[rule.field],
        (b as Record<string, unknown>)[rule.field],
      );
      if (result !== 0) return rule.direction === "DESC" ? -result : result;
    }
    return 0;
  });
};

const COMPARISON = /^([A-Za-z][\w.]*)(==|!=|=in=|=out=|>=|<=|=gt=|=ge=|=lt=|=le=|>|<)(.+)$/;

const parseFilterValue = (raw: string): unknown => {
  const value = raw.trim();
  if (/^".*"$/.test(value) || /^'.*'$/.test(value)) return value.slice(1, -1);
  if (value === "null") return null;
  if (value === "true") return true;
  if (value === "false") return false;
  if (value !== "" && !Number.isNaN(Number(value))) return Number(value);
  return value;
};

const readField = (item: Record<string, unknown>, path: string): unknown =>
  path
    .split(".")
    .reduce<unknown>(
      (value, key) =>
        value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined,
      item,
    );

const unsupportedFilter = (expression: string) =>
  invalidArgument(
    `MockCalmLensServerClient cannot evaluate the filter "${expression}". It supports ==, !=, <, <=, >, >=, =in= and =out=, joined by ; (and) or , (or) and grouped with parentheses.`,
  );

const matchesComparison = (item: Record<string, unknown>, comparison: string): boolean => {
  const match = COMPARISON.exec(comparison.trim());
  if (!match) throw unsupportedFilter(comparison);
  const [, field, operator, rawValue] = match as unknown as [string, string, string, string];
  const actual = readField(item, field);
  const isList = operator === "=in=" || operator === "=out=";
  if (isList && !/^\(.*\)$/.test(rawValue.trim())) throw unsupportedFilter(comparison);
  const values = isList
    ? rawValue.trim().slice(1, -1).split(",").map(parseFilterValue)
    : [parseFilterValue(rawValue)];
  const equals = (expected: unknown) =>
    Array.isArray(actual)
      ? actual.includes(expected)
      : expected === null
        ? actual === null || actual === undefined
        : actual === expected;
  switch (operator) {
    case "==":
      return equals(values[0]);
    case "!=":
      return !equals(values[0]);
    case "=in=":
      return values.some(equals);
    case "=out=":
      return !values.some(equals);
    case ">":
    case "=gt=":
      return compareValues(actual, values[0]) > 0;
    case ">=":
    case "=ge=":
      return compareValues(actual, values[0]) >= 0;
    case "<":
    case "=lt=":
      return compareValues(actual, values[0]) < 0;
    default:
      return compareValues(actual, values[0]) <= 0;
  }
};

/** Splits on `separator` outside quotes and parentheses. */
const splitTopLevel = (text: string, separator: string): string[] => {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = "";
  for (const char of text) {
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === "(") {
      depth++;
    } else if (char === ")") {
      depth--;
    } else if (char === separator && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts;
};

/** The expression inside `( … )` when the parentheses enclose all of `text`, else undefined. */
const unwrapGroup = (text: string): string | undefined => {
  if (!text.startsWith("(") || !text.endsWith(")")) return undefined;
  let depth = 0;
  let quote: string | null = null;
  for (const [index, char] of [...text].entries()) {
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === "(") {
      depth++;
    } else if (char === ")" && --depth === 0) {
      return index === text.length - 1 ? text.slice(1, -1) : undefined;
    }
  }
  return undefined;
};

/** Evaluates `,` (or) of `;` (and) terms, where a term is a comparison or a `( … )` group. */
const matchesExpression = (item: Record<string, unknown>, expression: string): boolean =>
  splitTopLevel(expression, ",").some((alternative) =>
    splitTopLevel(alternative, ";").every((term) => {
      const trimmed = term.trim();
      if (!trimmed) throw unsupportedFilter(expression);
      const group = unwrapGroup(trimmed);
      return group === undefined
        ? matchesComparison(item, trimmed)
        : matchesExpression(item, group);
    }),
  );

/**
 * Applies an RSQL `filter` like the API: comparisons joined by `;` (and), which binds tighter
 * than `,` (or), and grouped with parentheses. Anything it can't evaluate throws instead of
 * returning wrong results.
 */
export const filterAssets = <T>(items: T[], filter: string | null | undefined): T[] => {
  if (!filter) return items;
  // Evaluate once up front so an unsupported filter fails even when there are no items.
  if (items.length === 0) matchesExpression({}, filter);
  return items.filter((item) => matchesExpression(item as Record<string, unknown>, filter));
};

const MAX_SEARCH_TOKENS = 8;
type AssetSearchResult = AssetSearchResponse["items"][number];
type SearchField = AssetSearchResult["matchedFields"][number];

/** The keyword fields the API searches, in the order it reports matches. */
const searchFieldValues = (asset: Asset): Array<[SearchField, string]> => [
  ["name", asset.name],
  ["id", asset.id],
  ["externalId", asset.externalId ?? ""],
  ["description", asset.description ?? ""],
  ["tags", asset.tags?.join(" ") ?? ""],
  ["type", asset.type],
  ["content.format", asset.content?.format ?? ""],
  ["content.extension", asset.content?.extension ?? ""],
  ["classification.moderation.status", asset.classification.moderation.status],
];

/** The API's keyword score for the whole lowercased query. */
const keywordScore = (values: Map<SearchField, string>, query: string): number => {
  const id = values.get("id")!;
  const externalId = values.get("externalId")!;
  const name = values.get("name")!;
  if (id === query) return 1000;
  if (externalId === query) return 950;
  if (name === query) return 900;
  if (id.startsWith(query)) return 800;
  if (externalId.startsWith(query)) return 750;
  if (name.startsWith(query)) return 700;
  if (name.includes(query)) return 600;
  if (values.get("tags")!.includes(query)) return 500;
  return 100;
};

/**
 * Keyword search as the API runs it: every whitespace-separated token (case-insensitive, at
 * most 8) must appear in some searchable field. Results are ranked by the API's score, then
 * newest first.
 */
export const searchAssets = (
  assets: Asset[],
  query: string,
  limit: number,
): AssetSearchResult[] => {
  const normalized = query.trim().toLowerCase();
  const tokens = [...new Set(normalized.split(/\s+/).filter(Boolean))].slice(0, MAX_SEARCH_TOKENS);
  if (tokens.length === 0) return [];
  return assets
    .map((asset) => {
      const fields = searchFieldValues(asset).map(
        ([field, value]) => [field, value.toLowerCase()] as [SearchField, string],
      );
      const matches = tokens.every((token) => fields.some(([, value]) => value.includes(token)));
      return {
        asset,
        matches,
        score: keywordScore(new Map(fields), normalized),
        matchedFields: fields
          .filter(([, value]) => tokens.some((token) => value.includes(token)))
          .map(([field]) => field),
      };
    })
    .filter((result) => result.matches)
    .sort((a, b) => b.score - a.score || b.asset.createdAt - a.asset.createdAt)
    .slice(0, limit)
    .map(({ asset, score, matchedFields }) => ({ asset, score, matchedFields }));
};
