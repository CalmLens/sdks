import * as zod from "zod";
declare const ORDER_SCHEMA: zod.ZodObject<{
  field: zod.ZodString;
  direction: zod.ZodEnum<{
    asc: "asc";
    desc: "desc";
  }>;
}, zod.core.$strip>;
type Order = zod.infer<typeof ORDER_SCHEMA>;
declare const PAGE_QUERY_SCHEMA: zod.ZodObject<{
  pageIndex: zod.ZodDefault<zod.ZodNumber>;
  pageSize: zod.ZodOptional<zod.ZodNumber>;
  ordering: zod.ZodOptional<zod.ZodArray<zod.ZodObject<{
    field: zod.ZodString;
    direction: zod.ZodEnum<{
      asc: "asc";
      desc: "desc";
    }>;
  }, zod.core.$strip>>>;
}, zod.core.$strip>;
type PageQuery = zod.infer<typeof PAGE_QUERY_SCHEMA>;
interface Page<T> extends Required<PageQuery> {
  items: T[];
  total: number | undefined;
  hasMore: boolean;
}
interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
  pageSize: number;
  hasMore: boolean;
  ordering: Order[];
}
export { Order as n, Page as r, CursorPage as t };