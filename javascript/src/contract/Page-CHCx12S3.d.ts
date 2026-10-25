import * as zod from "zod";
declare const ORDER_SCHEMA: zod.ZodObject<{
  field: zod.ZodString;
  direction: zod.ZodEnum<{
    ASC: "ASC";
    DESC: "DESC";
  }>;
}, zod.core.$strip>;
type Order = zod.infer<typeof ORDER_SCHEMA>;
declare const PAGE_QUERY_SCHEMA: zod.ZodObject<{
  pageIndex: zod.ZodDefault<zod.ZodNumber>;
  pageSize: zod.ZodOptional<zod.ZodNumber>;
  ordering: zod.ZodOptional<zod.ZodArray<zod.ZodObject<{
    field: zod.ZodString;
    direction: zod.ZodEnum<{
      ASC: "ASC";
      DESC: "DESC";
    }>;
  }, zod.core.$strip>>>;
}, zod.core.$strip>;
type PageQuery = zod.infer<typeof PAGE_QUERY_SCHEMA>;
interface Page<T> extends Required<PageQuery> {
  items: T[];
  total: number | undefined;
  hasMore: boolean;
}
/** Public collections use a stable position rather than an offset into a changing list. */
declare const CURSOR_PAGE_QUERY_SCHEMA: zod.ZodObject<{
  cursor: zod.ZodOptional<zod.ZodString>;
  pageSize: zod.ZodOptional<zod.ZodNumber>;
  ordering: zod.ZodOptional<zod.ZodArray<zod.ZodObject<{
    direction: zod.ZodEnum<{
      ASC: "ASC";
      DESC: "DESC";
    }>;
    field: zod.ZodEnum<{
      createdAt: "createdAt";
      id: "id";
    }>;
  }, zod.core.$strip>>>;
}, zod.core.$strict>;
type CursorPageQuery = zod.infer<typeof CURSOR_PAGE_QUERY_SCHEMA>;
interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
  pageSize: number;
  hasMore: boolean;
  ordering: Order[];
}
export { Page as i, CursorPageQuery as n, Order as r, CursorPage as t };