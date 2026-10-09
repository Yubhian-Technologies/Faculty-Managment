import { useMemo, useState } from "react";

/**
 * Client-side pagination over an already-loaded list, for pages that render
 * cards/rows themselves instead of going through DataTable's `paginate`.
 * Pair with the shared <Pagination> component. The page is clamped rather than
 * reset via an effect, so a filter that shrinks `items` while sitting on a
 * later page settles back to the last real page on the next render.
 *
 * `initial` restores a page / page size a list was left on (e.g. from its URL).
 */
export function usePagination<T>(items: T[], defaultPageSize = 20, initial?: { page?: number; pageSize?: number }) {
  const [page, setPage] = useState(initial?.page ?? 1);
  const [pageSize, setPageSizeState] = useState(initial?.pageSize ?? defaultPageSize);
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const effectivePage = Math.min(page, totalPages);
  const pageItems = useMemo(
    () => items.slice((effectivePage - 1) * pageSize, effectivePage * pageSize),
    [items, effectivePage, pageSize]
  );
  return {
    pageItems,
    page: effectivePage,
    pageSize,
    total: items.length,
    setPage,
    setPageSize: (size: number) => {
      setPageSizeState(size);
      setPage(1);
    },
  };
}
