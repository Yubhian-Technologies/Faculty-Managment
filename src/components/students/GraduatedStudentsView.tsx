"use client";

import { useAppliedFilters } from "@/hooks/useAppliedFilters";
import { LoadButton } from "@/components/shared/LoadButton";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { GraduationCap, Search, Users } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/shared/EmptyState";
import { Pagination } from "@/components/shared/Pagination";
import { toast } from "@/hooks/useToast";
import { formatDate } from "@/lib/utils";
import { graduateBatchLabel, graduateCourseLabel } from "@/lib/students/graduates";
import type { StudentListItem } from "@/types";

const DEFAULT_PAGE_SIZE = 20;

interface GraduatesResponse {
  students?: StudentListItem[];
  total?: number;
  overallTotal?: number;
  orderedIds?: string[];
  facets?: { courses: string[]; batches: string[] };
  error?: string;
}

// Every graduated student, grouped Course → Batch (e.g. "B.Tech" → "2021-2025")
// exactly as they were snapshotted at the moment they were graduated (see
// students/promote/route.ts) - stable even if the section they graduated out
// of is later renamed or removed. Shared between Principal and College
// Office: both read the same college-wide roster, neither can edit here.
// showHeader=false when embedded as a sub-tab of the Students page, which
// already renders its own header for all tabs. studentDetailHref builds the
// row's link to the canonical (role-prefixed) student profile page - this
// component is shared by College Office and Principal, whose profile routes
// live under different prefixes, so the caller supplies it rather than this
// component guessing a role from the current path.
export function GraduatedStudentsView({ showHeader = true, studentDetailHref }: { showHeader?: boolean; studentDetailHref: (studentId: string) => string }) {
  const router = useRouter();
  // Only graduates are ever read (status == GRADUATED, server-side), and only
  // one page of them is held here - see students/route.ts `graduates=1`.
  const [students, setStudents] = useState<StudentListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [overallTotal, setOverallTotal] = useState(0);
  const [facets, setFacets] = useState<{ courses: string[]; batches: string[] }>({ courses: [], batches: [] });
  const [isLoading, setIsLoading] = useState(true);
  const [isFetching, setIsFetching] = useState(false);
  const [search, setSearch] = useState("");
  const [courseFilter, setCourseFilter] = useState("all");
  const [batchFilter, setBatchFilter] = useState("all");
  // Search and filters edit a draft; the list is fetched when Load is clicked (or Enter in search).
  const { applied, dirty, load } = useAppliedFilters({ search, courseFilter, batchFilter });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  // The list request returns every matching id (in display order) plus the first
  // page; later pages are fetched by id, so paging reads only that page's
  // documents. Rows already fetched are kept, so revisiting a page is free.
  const orderedIds = useRef<string[]>([]);
  const rowCache = useRef(new Map<string, StudentListItem>());
  const pageSizeRef = useRef(DEFAULT_PAGE_SIZE);
  const requestSeq = useRef(0);

  const loadList = useCallback(async () => {
    const seq = ++requestSeq.current;
    setIsFetching(true);
    try {
      const params = new URLSearchParams({ graduates: "1", page: "1", pageSize: String(pageSizeRef.current) });
      const appliedSearch = applied.search.trim().toLowerCase();
      if (appliedSearch) params.set("search", appliedSearch);
      if (applied.courseFilter !== "all") params.set("course", applied.courseFilter);
      if (applied.batchFilter !== "all") params.set("batch", applied.batchFilter);
      const res = await fetch(`/api/college/students?${params.toString()}`);
      const json = await res.json() as GraduatesResponse;
      if (seq !== requestSeq.current) return; // a newer search/filter superseded this one
      if (!res.ok) {
        toast({ variant: "destructive", title: json.error ?? "Failed to load graduated students" });
        return;
      }
      const rows = json.students ?? [];
      orderedIds.current = json.orderedIds ?? [];
      rowCache.current = new Map(rows.map((r) => [r.id, r]));
      setStudents(rows);
      setTotal(json.total ?? 0);
      setOverallTotal(json.overallTotal ?? 0);
      setFacets(json.facets ?? { courses: [], batches: [] });
      setPage(1);
    } catch {
      if (seq === requestSeq.current) toast({ variant: "destructive", title: "Failed to load graduated students" });
    } finally {
      if (seq === requestSeq.current) {
        setIsFetching(false);
        setIsLoading(false);
      }
    }
  }, [applied]);

  // Wrapped so the loader's setState calls aren't reachable synchronously from
  // the effect body (react-hooks/set-state-in-effect).
  useEffect(() => {
    void (async () => { await loadList(); })();
  }, [loadList]);

  async function showPage(nextPage: number, nextSize: number) {
    const ids = orderedIds.current.slice((nextPage - 1) * nextSize, nextPage * nextSize);
    const missing = ids.filter((id) => !rowCache.current.has(id));
    if (missing.length > 0) {
      const seq = ++requestSeq.current;
      setIsFetching(true);
      try {
        const res = await fetch(`/api/college/students?graduates=1&ids=${missing.join(",")}`);
        const json = await res.json() as GraduatesResponse;
        if (seq !== requestSeq.current) return;
        if (!res.ok) {
          toast({ variant: "destructive", title: json.error ?? "Failed to load graduated students" });
          return;
        }
        for (const r of json.students ?? []) rowCache.current.set(r.id, r);
      } catch {
        if (seq === requestSeq.current) toast({ variant: "destructive", title: "Failed to load graduated students" });
        return;
      } finally {
        if (seq === requestSeq.current) setIsFetching(false);
      }
    }
    pageSizeRef.current = nextSize;
    setStudents(ids.map((id) => rowCache.current.get(id)).filter((r): r is StudentListItem => !!r));
    setPage(nextPage);
    setPageSize(nextSize);
  }

  // Course → Batch → students, both levels sorted for a stable, scannable
  // hierarchy - newest batch first within a course, since that's the group
  // someone's most likely looking for right after a promotion run.
  const grouped = useMemo(() => {
    const byCourse = new Map<string, Map<string, StudentListItem[]>>();
    for (const s of students) {
      const course = graduateCourseLabel(s);
      const batch = graduateBatchLabel(s);
      if (!byCourse.has(course)) byCourse.set(course, new Map());
      const byBatch = byCourse.get(course)!;
      if (!byBatch.has(batch)) byBatch.set(batch, []);
      byBatch.get(batch)!.push(s);
    }
    return Array.from(byCourse.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([course, byBatch]) => ({
        course,
        batches: Array.from(byBatch.entries())
          .sort((a, b) => b[0].localeCompare(a[0]))
          .map(([batch, list]) => ({
            batch,
            students: list.sort((a, b) => (a.rollNumber ?? "").localeCompare(b.rollNumber ?? "")),
          })),
      }));
  }, [students]);

  return (
    <div className="space-y-6">
      {showHeader && (
        <PageHeader
          title="Graduated Students"
          description="Every student who has completed their programme, grouped by course and batch"
        />
      )}

      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <GraduationCap className="h-4 w-4" />
        <span><strong className="text-foreground">{overallTotal}</strong> graduated total</span>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") load(); }}
            placeholder="Search by name, roll number or department"
            className="pl-9"
          />
        </div>
        <Select value={courseFilter} onValueChange={setCourseFilter}>
          <SelectTrigger className="sm:w-56"><SelectValue placeholder="All courses" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All courses</SelectItem>
            {facets.courses.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={batchFilter} onValueChange={setBatchFilter}>
          <SelectTrigger className="sm:w-44"><SelectValue placeholder="All batches" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All batches</SelectItem>
            {facets.batches.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
          </SelectContent>
        </Select>
        <LoadButton dirty={dirty} onClick={load} loading={isFetching} />
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <div key={i} className="h-12 rounded-lg border bg-muted/30 animate-pulse" />)}
        </div>
      ) : grouped.length === 0 ? (
        <EmptyState
          title={overallTotal === 0 ? "No graduated students yet" : "No graduates match your filters"}
          description={overallTotal === 0 ? "Students appear here once they're graduated from Student Promotion." : "Try clearing the search or filters."}
          icon={<GraduationCap className="h-8 w-8" />}
        />
      ) : (
        <div className="space-y-5">
          {grouped.map(({ course, batches: courseBatches }) => (
            <Card key={course}>
              <CardContent className="p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-semibold">{course}</h3>
                  <Badge variant="secondary" className="text-xs">
                    {courseBatches.reduce((n, b) => n + b.students.length, 0)} student{courseBatches.reduce((n, b) => n + b.students.length, 0) === 1 ? "" : "s"}
                  </Badge>
                </div>
                {courseBatches.map(({ batch, students: batchStudents }) => (
                  <div key={batch} className="space-y-2">
                    <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                      <Users className="h-3.5 w-3.5" />
                      {batch} · {batchStudents.length} student{batchStudents.length === 1 ? "" : "s"}
                    </div>
                    <div className="overflow-x-auto rounded-lg border">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/40">
                          <tr className="text-left text-xs text-muted-foreground">
                            <th className="p-2.5 font-medium">Roll No.</th>
                            <th className="p-2.5 font-medium">Name</th>
                            <th className="p-2.5 font-medium">Department</th>
                            <th className="p-2.5 font-medium">Graduated On</th>
                          </tr>
                        </thead>
                        <tbody>
                          {batchStudents.map((s) => (
                            <tr
                              key={s.id}
                              onClick={() => router.push(studentDetailHref(s.id))}
                              className="border-t cursor-pointer hover:bg-muted/40 transition-colors"
                            >
                              <td className="p-2.5 whitespace-nowrap">{s.rollNumber || "—"}</td>
                              <td className="p-2.5 font-medium whitespace-nowrap">{s.name}</td>
                              <td className="p-2.5 whitespace-nowrap">{s.department}</td>
                              <td className="p-2.5 whitespace-nowrap">{formatDate(s.graduatedAt)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {!isLoading && total > 0 && (
        <Pagination
          page={page}
          pageSize={pageSize}
          total={total}
          onPageChange={(p) => void showPage(p, pageSize)}
          onPageSizeChange={(size) => void showPage(1, size)}
          disabled={isFetching}
        />
      )}
    </div>
  );
}
