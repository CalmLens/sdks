import { CalmLensError, invalidArgument, SDK_ERROR_CODES } from "./CalmLensError";

/** The HTTP response a successful call's result came from. */
export interface CalmLensLastResponse {
  /** The HTTP status, such as 200 or 201. */
  readonly status: number;
  /** The `x-request-id` header: quote it when you contact support about this request. */
  readonly requestId?: string;
  /** The response headers. */
  readonly headers: Headers;
  /** The `Idempotency-Key` the request was sent with, if any. */
  readonly idempotencyKey?: string;
}

/**
 * A call's result with the response it came from as `lastResponse`. `lastResponse` is not
 * enumerable, so `JSON.stringify`, spreading and `Object.keys` leave it out.
 */
export type CalmLensResponse<T> = T & { readonly lastResponse: CalmLensLastResponse };

/** Attaches `lastResponse` to a parsed JSON result; other values are returned unchanged. */
export const withLastResponse = <T>(value: T, lastResponse: CalmLensLastResponse): T => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.defineProperty(value, "lastResponse", {
      value: lastResponse,
      enumerable: false,
      writable: false,
      configurable: true,
    });
  }
  return value;
};

/** `value` with `from`'s `lastResponse`, for results the SDK builds from a response. */
export const copyLastResponse = <T>(value: T, from: unknown): T => {
  const lastResponse = (from as { lastResponse?: CalmLensLastResponse } | null)?.lastResponse;
  return lastResponse ? withLastResponse(value, lastResponse) : value;
};

/** The most items `autoPagingToArray` collects; iterate with `for await` for more. */
export const AUTO_PAGING_TO_ARRAY_MAX = 10_000;

export interface AutoPagingToArrayOptions {
  /** How many items to collect at most, from 1 to 10,000. */
  limit: number;
}

/** The fields every cursor-paginated list response has. */
export interface CursorPageData<Item> {
  items: Item[];
  nextCursor: string | null;
  hasMore: boolean;
}

/** Walking from a page: every item of it and of the pages after it. */
export interface AutoPaging<Item> extends AsyncIterable<Item> {
  /** Collects items from this page onward, fetching pages as needed, until `limit` are found. */
  autoPagingToArray(options: AutoPagingToArrayOptions): Promise<Item[]>;
}

/**
 * One page of a list, as the API returned it, with page navigation. `for await` over the page
 * yields its items and every item after them, fetching pages as needed.
 */
export type ListPage<Page extends CursorPageData<unknown>> = CalmLensResponse<Page> &
  AutoPaging<Page["items"][number]> & {
    /** Whether a page follows this one. */
    hasNextPage(): boolean;
    /** Fetches the page after this one; fails with `sdk/invalid-argument` when there is none. */
    getNextPage(): ListPromise<Page>;
  };

/**
 * What `list` methods return: await it for the first page, or `for await` over it for every item
 * across pages. The cursor keeps the position stable when items are inserted or deleted.
 */
export interface ListPromise<Page extends CursorPageData<unknown>>
  extends Promise<ListPage<Page>>,
    AutoPaging<Page["items"][number]> {}

/**
 * Iterators stop rather than loop: a page that says more follow must not hand back a cursor this
 * iteration has already sent, which would repeat the same pages forever.
 */
const assertNewCursor = (sent: Set<string>, cursor: string) => {
  if (sent.has(cursor)) {
    throw new CalmLensError(SDK_ERROR_CODES.INVALID_RESPONSE, {
      message: "The API returned a cursor it had already returned, with more pages to follow",
      details: { cursor },
    });
  }
  sent.add(cursor);
};

type FetchPage<Page> = (cursor: string | undefined) => Promise<Page>;

interface PageSource<Page> {
  fetchPage: FetchPage<Page>;
  /**
   * Whether the list is a feed, like events, whose empty page with `hasMore` still has a next
   * page. Other lists end at an empty page.
   */
  feed: boolean;
}

/** The cursor each page was requested with, for iteration's repeated-cursor check. */
const requestCursors = new WeakMap<object, string>();

const autoPaging = <Page extends CursorPageData<unknown>>(
  first: Promise<ListPage<Page>>,
): AutoPaging<Page["items"][number]> => {
  type Item = Page["items"][number];
  async function* items(): AsyncGenerator<Item, void, undefined> {
    let page = await first;
    const start = requestCursors.get(page);
    const sent = new Set(start === undefined ? [] : [start]);
    for (;;) {
      // Checked before the page's items are yielded, so a repeating page is never yielded twice.
      const more = page.hasNextPage();
      if (more) assertNewCursor(sent, page.nextCursor!);
      yield* page.items as Item[];
      if (!more) return;
      page = await page.getNextPage();
    }
  }
  return {
    [Symbol.asyncIterator]: () => items(),
    async autoPagingToArray(options: AutoPagingToArrayOptions): Promise<Item[]> {
      const limit = options?.limit;
      if (!Number.isInteger(limit) || limit < 1 || limit > AUTO_PAGING_TO_ARRAY_MAX) {
        throw invalidArgument(
          `autoPagingToArray needs a limit from 1 to ${AUTO_PAGING_TO_ARRAY_MAX}; iterate with for await for more`,
        );
      }
      const collected: Item[] = [];
      for await (const item of items()) {
        collected.push(item);
        if (collected.length >= limit) break;
      }
      return collected;
    },
  };
};

const toListPage = <Page extends CursorPageData<unknown>>(
  data: Page,
  source: PageSource<Page>,
  cursor: string | undefined,
): ListPage<Page> => {
  if (!data || typeof data !== "object" || !Array.isArray(data.items)) {
    throw new CalmLensError(SDK_ERROR_CODES.INVALID_RESPONSE, {
      message: "The API returned a list without items",
    });
  }
  const hasNextPage = () =>
    data.hasMore === true &&
    typeof data.nextCursor === "string" &&
    data.nextCursor !== "" &&
    (source.feed || data.items.length > 0);
  const page = data as ListPage<Page>;
  if (cursor !== undefined) requestCursors.set(page, cursor);
  const self = Promise.resolve(page);
  const { [Symbol.asyncIterator]: iterate, autoPagingToArray } = autoPaging(self);
  Object.defineProperties(page, {
    hasNextPage: { value: hasNextPage, configurable: true },
    getNextPage: {
      value: (): ListPromise<Page> => {
        const next = data.nextCursor ?? undefined;
        return list(async () => {
          if (!hasNextPage()) {
            throw invalidArgument("There is no next page; check hasNextPage() first");
          }
          // A page that names the cursor it was requested with as the next repeats forever.
          if (next !== undefined && next === cursor) assertNewCursor(new Set([next]), next);
          return toListPage(await source.fetchPage(next), source, next);
        });
      },
      configurable: true,
    },
    autoPagingToArray: { value: autoPagingToArray, configurable: true },
    [Symbol.asyncIterator]: { value: iterate, configurable: true },
  });
  return page;
};

const list = <Page extends CursorPageData<unknown>>(
  load: () => Promise<ListPage<Page>>,
): ListPromise<Page> => {
  // An async function, so that invalid options reject the promise rather than throw.
  const first = (async () => load())();
  return Object.assign(first, autoPaging(first)) as ListPromise<Page>;
};

/**
 * A list call: `fetchPage` requests the page at a cursor, the first page at `cursor` (which may
 * be `undefined`). Failures, including invalid options, reject the promise.
 */
export const listPages = <Page extends CursorPageData<unknown>>(
  fetchPage: FetchPage<Page>,
  { cursor, feed = false }: { cursor?: string; feed?: boolean } = {},
): ListPromise<Page> => {
  const source = { fetchPage, feed };
  return list(async () => toListPage(await fetchPage(cursor), source, cursor));
};
