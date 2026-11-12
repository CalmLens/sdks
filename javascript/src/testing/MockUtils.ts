import { invalidArgument } from "../client/CalmLensError";
import type { Asset, AssetSearchResponse } from "../client/CalmLensTypes";
import type { CursorPage } from "../contract/Page.js";
import { MOCK_ASSET_FILTER_FIELDS } from "./MockAssetFilters";

/** A list's sort, as the API reads its `sort` query value: fields in order, each with a direction. */
export type MockSort = Array<{ field: string; direction: "asc" | "desc" }>;

/**
 * A `sort` query value as the API parses it (`sortQueryField` in shared/Page.ts): comma-separated
 * fields from `fields`, descending when prefixed with `-`, none repeated and at most `max`.
 * Undefined for a list that sends none; `undefined`'s default applies.
 */
export const parseSort = (
  value: string | null,
  fields: readonly string[],
  max: number,
  fail: () => Error,
): MockSort | undefined => {
  if (value === null) return undefined;
  const sort: MockSort = [];
  for (const part of value.split(",").map((item) => item.trim())) {
    const field = part.startsWith("-") ? part.slice(1) : part;
    if (!/^-?[A-Za-z][A-Za-z0-9.]*$/.test(part) || !fields.includes(field)) throw fail();
    if (sort.some((rule) => rule.field === field)) throw fail();
    sort.push({ field, direction: part.startsWith("-") ? "desc" : "asc" });
  }
  if (sort.length > max) throw fail();
  return sort;
};

const toBase64Utf8 = (value: string) =>
  btoa(Array.from(new TextEncoder().encode(value), (byte) => String.fromCharCode(byte)).join(""));
const fromBase64Utf8 = (value: string) =>
  new TextDecoder("utf-8", { fatal: true }).decode(
    Uint8Array.from(atob(value), (char) => char.charCodeAt(0)),
  );

/**
 * Why a page request is refused, like the API: `validation/too-small` or `validation/too-big` for
 * a page size outside 1 to 100 (with the query field as `path`), and `cursor/invalid`
 * for a cursor that does not decode or came from another query.
 */
export type PageRequestFailure = (
  code: "validation/too-small" | "validation/too-big" | "cursor/invalid",
  path?: string,
) => Error;

/** Every API cursor list returns this many items unless `pageSize` says otherwise. */
export const DEFAULT_PAGE_SIZE = 50;

/** A cursor page request: the API's `cursor` and `pageSize` query values, and its parsed `sort`. */
export interface PageRequest {
  cursor?: string;
  pageSize?: number;
  sort?: MockSort;
}

/**
 * One keyset page like the API's (packages/shared-backend/src/CursorPagination.ts): ordered by
 * `sort` (newest first by default) with an `id` tie-breaker added, starting after the cursor's
 * values. The cursor is tied to `scope` (the filter, folder or parent) and the sort, so it only
 * continues the query it came from. `name` and `id` are compared by code point, like the database.
 */
export const createPage = <T extends { id: string }>(
  items: T[],
  query: PageRequest,
  {
    scope,
    fail,
    defaultPageSize = DEFAULT_PAGE_SIZE,
    defaultSort = [{ field: "createdAt", direction: "desc" }],
  }: {
    scope: string;
    fail: PageRequestFailure;
    defaultPageSize?: number;
    defaultSort?: MockSort;
  },
): CursorPage<T> => {
  const pageSize = query.pageSize ?? defaultPageSize;
  if (typeof pageSize !== "number" || !Number.isFinite(pageSize) || pageSize < 1)
    throw fail("validation/too-small", "pageSize");
  if (pageSize > 100) throw fail("validation/too-big", "pageSize");
  if (!Number.isInteger(pageSize)) throw invalidArgument("Invalid page size");
  const ordering: MockSort = query.sort?.length ? [...query.sort] : [...defaultSort];
  if (!ordering.some(({ field }) => field === "id"))
    ordering.push({ field: "id", direction: ordering[0]!.direction });
  const signature = JSON.stringify([scope, ordering]);
  let remaining = orderItems(items, ordering);
  if (query.cursor) {
    let values: unknown[];
    try {
      const parsed = JSON.parse(fromBase64Utf8(query.cursor));
      values = parsed?.values;
      if (
        parsed?.scope !== signature ||
        !Array.isArray(values) ||
        values.length !== ordering.length ||
        values.some((value, i) =>
          STRING_FIELDS.has(ordering[i]!.field)
            ? typeof value !== "string"
            : typeof value !== "number" || !Number.isFinite(value),
        )
      )
        throw new Error();
    } catch {
      throw fail("cursor/invalid");
    }
    remaining = remaining.filter((item) => {
      for (const [i, rule] of ordering.entries()) {
        const result = compareValues(item[rule.field as keyof T], values[i]);
        if (result) return rule.direction === "desc" ? result < 0 : result > 0;
      }
      return false;
    });
  }
  const pageItems = remaining.slice(0, pageSize);
  const hasMore = remaining.length > pageSize;
  const last = pageItems.at(-1);
  return {
    items: pageItems,
    hasMore,
    nextCursor:
      hasMore && last
        ? toBase64Utf8(
            JSON.stringify({
              scope: signature,
              values: ordering.map(({ field }) => last[field as keyof T]),
            }),
          )
        : null,
  };
};

const STRING_FIELDS = new Set(["id", "name"]);

const compareValues = (left: unknown, right: unknown): number => {
  if (left === right) return 0;
  if (left === undefined || left === null) return -1;
  if (right === undefined || right === null) return 1;
  if (typeof left === "number" && typeof right === "number") return left - right;
  // Like the database: text compares by code point, so case matters.
  const [a, b] = [String(left), String(right)];
  return a < b ? -1 : a > b ? 1 : 0;
};

/** Sorts like the API's `sort`; without one, newest first. */
export const orderItems = <T>(items: T[], ordering: MockSort | null | undefined): T[] => {
  const rules: MockSort = ordering?.length ? ordering : [{ field: "createdAt", direction: "desc" }];
  return [...items].sort((a, b) => {
    for (const rule of rules) {
      const result = compareValues(
        (a as Record<string, unknown>)[rule.field],
        (b as Record<string, unknown>)[rule.field],
      );
      if (result !== 0) return rule.direction === "desc" ? -result : result;
    }
    return 0;
  });
};

/** Thrown for a filter the API refuses with `filter/invalid`. */
export class MockInvalidFilter extends Error {}

type FilterValue = string | number | null;
type FilterNode =
  | { type: "and" | "or"; nodes: FilterNode[] }
  | { type: "comparison"; field: string; operator: string; values: FilterValue[] };
type FilterToken = { kind: "word" | "quoted" | "operator" | "paren" | "logic"; text: string };

/** The characters that end an unquoted word, as in @rsql/parser. */
const RESERVED = "\"'();,=!~<> \n\t\r";
const LOGIC_WORDS = ["and", "or"];

/** Splits a filter into tokens like @rsql/parser's lexer. */
const tokenize = (filter: string): FilterToken[] => {
  const tokens: FilterToken[] = [];
  let i = 0;
  while (i < filter.length) {
    const char = filter[i]!;
    if (" \n\t\r".includes(char)) {
      i++;
    } else if (char === '"' || char === "'") {
      let text = "";
      let j = i + 1;
      for (; j < filter.length && filter[j] !== char; j++) {
        if (filter[j] === "\\" && j + 1 < filter.length) j++;
        text += filter[j];
      }
      if (j >= filter.length) throw new MockInvalidFilter();
      tokens.push({ kind: "quoted", text });
      i = j + 1;
    } else if (char === "(" || char === ")") {
      tokens.push({ kind: "paren", text: char });
      i++;
    } else if (char === ";" || char === ",") {
      tokens.push({ kind: "logic", text: char === ";" ? "and" : "or" });
      i++;
    } else if ("=!~<>".includes(char)) {
      const operator = /^(==|!=|<=|>=|<|>|=[a-z]*=)/.exec(filter.slice(i))?.[0];
      if (!operator) throw new MockInvalidFilter();
      tokens.push({ kind: "operator", text: operator });
      i += operator.length;
    } else {
      const word = LOGIC_WORDS.find((logic) => filter.startsWith(`${logic} `, i));
      if (word) {
        tokens.push({ kind: "logic", text: word });
        i += word.length;
        continue;
      }
      let j = i + 1;
      while (j < filter.length && !RESERVED.includes(filter[j]!)) j++;
      tokens.push({ kind: "word", text: filter.slice(i, j) });
      i = j;
    }
  }
  return tokens;
};

/**
 * A field's value as the API reads it (zodbase/rsql): `null` is a missing value only on a
 * nullable field, and a number field's value must be a finite number.
 */
const readFilterValue = (field: string, text: string): FilterValue => {
  const { kind, nullable } = MOCK_ASSET_FILTER_FIELDS[field]!;
  if (text === "null" && nullable) return null;
  if (kind !== "number") return text;
  const number = Number(text);
  if (text === "" || !Number.isFinite(number)) throw new MockInvalidFilter();
  return number;
};

/** Parses a filter: `;` (and) binds tighter than `,` (or), and parentheses group. */
const parseFilter = (filter: string): FilterNode => {
  const tokens = tokenize(filter);
  let position = 0;
  const peek = () => tokens[position];
  const next = () => {
    const token = tokens[position++];
    if (!token) throw new MockInvalidFilter();
    return token;
  };
  const value = () => {
    const token = next();
    if (token.kind !== "word" && token.kind !== "quoted") throw new MockInvalidFilter();
    return token.text;
  };
  const term = (): FilterNode => {
    const token = next();
    if (token.kind === "paren" && token.text === "(") {
      const node = alternatives();
      if (next().text !== ")") throw new MockInvalidFilter();
      return node;
    }
    if (token.kind !== "word" || !Object.hasOwn(MOCK_ASSET_FILTER_FIELDS, token.text))
      throw new MockInvalidFilter();
    const field = token.text;
    const operator = next();
    if (
      operator.kind !== "operator" ||
      !MOCK_ASSET_FILTER_FIELDS[field]!.operators.includes(operator.text)
    )
      throw new MockInvalidFilter();
    let texts: string[];
    if (peek()?.kind === "paren" && peek()?.text === "(") {
      next();
      texts = [value()];
      while (peek()?.kind === "logic" && peek()?.text === "or") {
        next();
        texts.push(value());
      }
      if (next().text !== ")") throw new MockInvalidFilter();
    } else {
      texts = [value()];
    }
    if (texts.length > 1 && operator.text !== "=in=" && operator.text !== "=out=")
      throw new MockInvalidFilter();
    return {
      type: "comparison",
      field,
      operator: operator.text,
      values: texts.map((text) => readFilterValue(field, text)),
    };
  };
  const conjunction = (): FilterNode => {
    const nodes = [term()];
    while (peek()?.kind === "logic" && peek()?.text === "and") {
      next();
      nodes.push(term());
    }
    return nodes.length === 1 ? nodes[0]! : { type: "and", nodes };
  };
  const alternatives = (): FilterNode => {
    const nodes = [conjunction()];
    while (peek()?.kind === "logic" && peek()?.text === "or") {
      next();
      nodes.push(conjunction());
    }
    return nodes.length === 1 ? nodes[0]! : { type: "or", nodes };
  };
  const node = alternatives();
  if (position !== tokens.length) throw new MockInvalidFilter();
  return node;
};

const readField = (item: Record<string, unknown>, path: string): unknown =>
  path
    .split(".")
    .reduce<unknown>(
      (value, key) =>
        value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined,
      item,
    );

/** `*` matches any run of characters, regardless of case; every other character itself. */
const wildcard = (pattern: string) =>
  new RegExp(
    `^${pattern
      .split("*")
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*")}$`,
    "isu",
  );

/** Compares like SQL: a missing value never matches, except `== null`. */
const matchesComparison = (
  item: Record<string, unknown>,
  { field, operator, values }: Extract<FilterNode, { type: "comparison" }>,
): boolean => {
  const actual = readField(item, field) ?? null;
  const [value] = values;
  // An asset without tags has none of them.
  if (actual === null && MOCK_ASSET_FILTER_FIELDS[field]!.kind === "list")
    return operator === "=out=";
  if (actual === null) return operator === "==" && value === null;
  if (operator === "!=" && value === null) return true;
  // Each tag counts as the asset's value.
  const actuals = Array.isArray(actual) ? actual : [actual];
  const equals = (expected: FilterValue) => actuals.some((each) => each === expected);
  if (
    (operator === "==" || operator === "!=") &&
    typeof value === "string" &&
    value.includes("*")
  ) {
    const pattern = wildcard(value);
    const matched = actuals.some((each) => typeof each === "string" && pattern.test(each));
    return operator === "==" ? matched : !matched;
  }
  switch (operator) {
    case "==":
      return equals(value!);
    case "!=":
      return !equals(value!);
    case "=in=":
      return values.some(equals);
    case "=out=":
      return !values.includes(null) && !values.some(equals);
  }
  if (value === null) return false;
  const order = compareValues(actual, value);
  switch (operator) {
    case ">":
      return order > 0;
    case ">=":
      return order >= 0;
    case "<":
      return order < 0;
    default:
      return order <= 0;
  }
};

const matchesNode = (item: Record<string, unknown>, node: FilterNode): boolean =>
  node.type === "comparison"
    ? matchesComparison(item, node)
    : node.type === "and"
      ? node.nodes.every((child) => matchesNode(item, child))
      : node.nodes.some((child) => matchesNode(item, child));

/**
 * Applies an RSQL `filter` like the API (zodbase/rsql with MOCK_ASSET_FILTER_FIELDS): only the
 * listed fields, each with its own operators, `;` (and) binding tighter than `,` (or), and parentheses. Throws
 * `MockInvalidFilter` for any filter the API refuses with `filter/invalid`.
 */
export const filterAssets = <T>(items: T[], filter: string | null | undefined): T[] => {
  if (!filter) return items;
  const node = parseFilter(filter);
  return items.filter((item) => matchesNode(item as Record<string, unknown>, node));
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
  ["classification.moderation.decision", asset.classification.moderation.decision ?? "pending"],
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
