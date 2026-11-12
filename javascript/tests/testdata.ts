// The one loader of the shared SDK contract fixtures that packages/sdk-contract writes to
// sdks/go/testdata. contract.test.ts and contract-client.test.ts each replay their own fixtures
// (packages/sdk-contract/README.md, "Runners") through it.
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const testdata = (name: string) =>
  JSON.parse(readFileSync(join(import.meta.dir, "../../go/testdata", name), "utf8"));

/**
 * Every page of an events list, from the first: the shape every SDK's event iterator yields, which
 * the contract fixtures record for `events.iterate`. A page that names the cursor it was
 * requested with as the next is refused by `getNextPage` before it is yielded, as iteration does.
 */
export async function* eventPages<
  Page extends {
    hasMore: boolean;
    nextCursor: string;
    hasNextPage(): boolean;
    getNextPage(): Promise<Page>;
  },
>(first: Promise<Page>, cursor: string | undefined): AsyncGenerator<Page, void, undefined> {
  let page = await first;
  for (;;) {
    const more = page.hasNextPage();
    if (more && page.nextCursor === cursor) await page.getNextPage();
    yield page;
    if (!more) return;
    cursor = page.nextCursor;
    page = await page.getNextPage();
  }
}
