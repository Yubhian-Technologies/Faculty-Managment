"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { GraduationCap, Search, Users } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/EmptyState";
import { toast } from "@/hooks/useToast";
import { formatDate } from "@/lib/utils";
import { RosterDetailView } from "@/components/students/RosterFieldInputs";
import type { StudentListItem } from "@/types";

const UNSPECIFIED_COURSE = "Unspecified programme";
const UNSPECIFIED_BATCH = "Unspecified batch";

// Every graduated student, grouped Course → Batch (e.g. "B.Tech" → "2021-2025")
// exactly as they were snapshotted at the moment they were graduated (see
// students/promote/route.ts) - stable even if the section they graduated out
// of is later renamed or removed. Shared between Principal and College
// Office: both read the same college-wide roster, neither can edit here.
export function GraduatedStudentsView() {
  const [students, setStudents] = useState<StudentListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [courseFilter, setCourseFilter] = useState("all");
  const [batchFilter, setBatchFilter] = useState("all");
  const [viewTarget, setViewTarget] = useState<StudentListItem | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/college/students");
      const data = await res.json() as { students: StudentListItem[] };
      setStudents((data.students ?? []).filter((s) => s.status === "GRADUATED"));
    } catch {
      toast({ variant: "destructive", title: "Failed to load graduated students" });
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Wrapped so the loader's setState calls aren't reachable synchronously from
  // the effect body (react-hooks/set-state-in-effect).
  useEffect(() => {
    void (async () => { await load(); })();
  }, [load]);

  const courseNames = useMemo(
    () => Array.from(new Set(students.map((s) => s.graduationCourseName?.trim() || UNSPECIFIED_COURSE))).sort((a, b) => a.localeCompare(b)),
    [students]
  );
  const batches = useMemo(
    () => Array.from(new Set(students.map((s) => s.graduationBatch?.trim() || UNSPECIFIED_BATCH))).sort((a, b) => b.localeCompare(a)),
    [students]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return students.filter((s) => {
      const course = s.graduationCourseName?.trim() || UNSPECIFIED_COURSE;
      const batch = s.graduationBatch?.trim() || UNSPECIFIED_BATCH;
      if (courseFilter !== "all" && course !== courseFilter) return false;
      if (batchFilter !== "all" && batch !== batchFilter) return false;
      if (q && !(
        s.name.toLowerCase().includes(q)
        || (s.rollNumber ?? "").toLowerCase().includes(q)
        || (s.department ?? "").toLowerCase().includes(q)
      )) return false;
      return true;
    });
  }, [students, search, courseFilter, batchFilter]);

  // Course → Batch → students, both levels sorted for a stable, scannable
  // hierarchy - newest batch first within a course, since that's the group
  // someone's most likely looking for right after a promotion run.
  const grouped = useMemo(() => {
    const byCourse = new Map<string, Map<string, StudentListItem[]>>();
    for (const s of filtered) {
      const course = s.graduationCourseName?.trim() || UNSPECIFIED_COURSE;
      const batch = s.graduationBatch?.trim() || UNSPECIFIED_BATCH;
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
  }, [filtered]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Graduated Students"
        description="Every student who has completed their programme, grouped by course and batch"
      />

      <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <GraduationCap className="h-4 w-4" />
        <span><strong className="text-foreground">{students.length}</strong> graduated total</span>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, roll number or department"
            className="pl-9"
          />
        </div>
        <Select value={courseFilter} onValueChange={setCourseFilter}>
          <SelectTrigger className="sm:w-56"><SelectValue placeholder="All courses" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All courses</SelectItem>
            {courseNames.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={batchFilter} onValueChange={setBatchFilter}>
          <SelectTrigger className="sm:w-44"><SelectValue placeholder="All batches" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All batches</SelectItem>
            {batches.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <div key={i} className="h-12 rounded-lg border bg-muted/30 animate-pulse" />)}
        </div>
      ) : grouped.length === 0 ? (
        <EmptyState
          title={students.length === 0 ? "No graduated students yet" : "No graduates match your filters"}
          description={students.length === 0 ? "Students appear here once they're graduated from Student Promotion." : "Try clearing the search or filters."}
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
                              onClick={() => setViewTarget(s)}
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

      <Dialog open={!!viewTarget} onOpenChange={(o) => { if (!o) setViewTarget(null); }}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{viewTarget?.name}</DialogTitle>
            <DialogDescription>
              {viewTarget?.graduationCourseName || "Programme not recorded"} · {viewTarget?.graduationBatch || "Batch not recorded"} · Graduated {viewTarget ? formatDate(viewTarget.graduatedAt) : ""}
            </DialogDescription>
          </DialogHeader>
          {viewTarget && <RosterDetailView student={viewTarget} />}
          <DialogFooter>
            <Button variant="outline" onClick={() => setViewTarget(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
