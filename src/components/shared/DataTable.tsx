"use client";

import React, { useState } from "react";
import { Search, Download, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn, exportToCSV } from "@/lib/utils";
import { EmptyState } from "./EmptyState";
import { TableSkeleton } from "./SkeletonLoader";
import { Pagination } from "./Pagination";

const DEFAULT_PAGE_SIZE = 20;

export interface Column<T> {
  key: string;
  header: string;
  render?: (row: T) => React.ReactNode;
  className?: string;
  hideOnMobile?: boolean;
}

interface DataTableProps<T extends Record<string, unknown>> {
  data: T[];
  columns: Column<T>[];
  isLoading?: boolean;
  searchPlaceholder?: string;
  searchKeys?: (keyof T)[];
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: React.ReactNode;
  csvFilename?: string;
  filterComponent?: React.ReactNode;
  onRowClick?: (row: T) => void;
  keyExtractor: (row: T) => string;
  // When set, rows are grouped under a header row per returned label (e.g.
  // department), sorted alphabetically - search/export still apply first.
  groupBy?: (row: T) => string;
  // Opt-in client-side pagination (default page size 20, same 10/20/30/50
  // choices as the shared Pagination component used by the Office/Principal
  // Students pages) - off by default so every other, non-student list already
  // using this table is unaffected. Paginates AFTER search/groupBy so typing
  // in the search box still searches the whole `data` array, not just the
  // current page.
  paginate?: boolean;
  defaultPageSize?: number;
}

export function DataTable<T extends Record<string, unknown>>({
  data,
  columns,
  isLoading,
  searchPlaceholder = "Search...",
  searchKeys = [],
  emptyTitle = "No records found",
  emptyDescription,
  emptyAction,
  csvFilename,
  filterComponent,
  onRowClick,
  keyExtractor,
  groupBy,
  paginate,
  defaultPageSize,
}: DataTableProps<T>) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(defaultPageSize ?? DEFAULT_PAGE_SIZE);

  const filtered = search
    ? data.filter((row) =>
        searchKeys.some((key) =>
          String(row[key] ?? "").toLowerCase().includes(search.toLowerCase())
        )
      )
    : data;

  // Clamped rather than reset via an effect - if an external filter (e.g. the
  // host page's own Department/Course/Year selects) shrinks `data` while
  // sitting on a later page, this settles back to the last real page on the
  // very next render instead of showing a blank table.
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const effectivePage = Math.min(page, totalPages);
  const pageRows = paginate ? filtered.slice((effectivePage - 1) * pageSize, effectivePage * pageSize) : filtered;

  const groups = groupBy
    ? Object.entries(
        pageRows.reduce<Record<string, T[]>>((acc, row) => {
          const label = groupBy(row) || "—";
          (acc[label] ??= []).push(row);
          return acc;
        }, {})
      ).sort(([a], [b]) => a.localeCompare(b))
    : null;

  const handleExport = () => {
    if (!csvFilename) return;
    exportToCSV(
      filtered,
      csvFilename,
      columns.map((c) => ({ key: c.key, header: c.header }))
    );
  };

  const renderRow = (row: T) => (
    <tr
      key={keyExtractor(row)}
      onClick={() => onRowClick?.(row)}
      onKeyDown={
        onRowClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onRowClick(row);
              }
            }
          : undefined
      }
      tabIndex={onRowClick ? 0 : undefined}
      role={onRowClick ? "button" : undefined}
      className={cn(
        "bg-background hover:bg-muted/30 transition-colors",
        onRowClick && "cursor-pointer focus-visible:outline-2 focus-visible:outline-primary focus-visible:-outline-offset-2"
      )}
    >
      {columns.map((col) => (
        <td
          key={col.key}
          className={cn(
            "px-4 py-3 whitespace-nowrap",
            col.hideOnMobile && "hidden md:table-cell",
            col.className
          )}
        >
          {col.render ? col.render(row) : String(row[col.key] ?? "-")}
        </td>
      ))}
    </tr>
  );

  if (isLoading) return <TableSkeleton rows={5} cols={columns.length} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={searchPlaceholder}
            value={search}
            onChange={(e) => { setSearch(e.target.value); if (paginate) setPage(1); }}
            className="pl-9"
            // A plain, un-hinted text input is exactly what a browser's
            // autofill heuristics latch onto (e.g. offering the logged-in
            // user's own saved email) - this table is used to search
            // *other* people's records, so autofill here is never correct.
            autoComplete="off"
          />
        </div>
        <div className="flex items-center gap-2">
          {filterComponent && (
            <div className="flex items-center gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              {filterComponent}
            </div>
          )}
          {csvFilename && (
            <Button variant="outline" size="sm" onClick={handleExport}>
              <Download className="h-4 w-4 mr-1" />
              Export CSV
            </Button>
          )}
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title={emptyTitle}
          description={emptyDescription}
          action={emptyAction}
        />
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 sticky top-0">
                <tr>
                  {columns.map((col) => (
                    <th
                      key={col.key}
                      className={cn(
                        "px-4 py-3 text-left font-medium text-muted-foreground whitespace-nowrap",
                        col.hideOnMobile && "hidden md:table-cell",
                        col.className
                      )}
                    >
                      {col.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {groups
                  ? groups.map(([label, rows]) => (
                      <React.Fragment key={label}>
                        <tr className="bg-muted/30">
                          <td
                            colSpan={columns.length}
                            className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                          >
                            {label} · {rows.length}
                          </td>
                        </tr>
                        {rows.map((row) => renderRow(row))}
                      </React.Fragment>
                    ))
                  : pageRows.map((row) => renderRow(row))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {paginate && filtered.length > 0 && (
        <Pagination
          page={effectivePage}
          pageSize={pageSize}
          total={filtered.length}
          onPageChange={setPage}
          onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
        />
      )}
    </div>
  );
}
