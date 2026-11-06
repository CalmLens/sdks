import "zod";
/** Every public list's envelope: the page's items, and how to continue. */
interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}
export { CursorPage as t };