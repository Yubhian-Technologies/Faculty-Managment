import { useMemo, useState } from "react";

/**
 * Client-side pagination over an already-loaded list, for pages that render
 * cards/rows themselves instead of going through DataTable's `paginate`.
 * Pair with the shared <Pagination> component. The page is clamped rather than
 * reset via an effect, so a filter that shrinks `items` while sitting on a
 * later page settles back to the last real page on the next render.
 */
export function usePagination<T>(items: T[], defaultPageSize = 20) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeState] = useState(defaultPageSize);
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
