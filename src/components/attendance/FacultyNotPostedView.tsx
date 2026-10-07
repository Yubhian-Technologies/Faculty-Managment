"use client";

import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/shared/EmptyState";
import { toast } from "@/hooks/useToast";
import { useMyDepartments } from "@/hooks/useMyDepartments";
import { downloadTablePdf, downloadTableXlsx, type TableExport } from "@/lib/attendance/tableExport";
import type { Department, Course } from "@/types";

interface AllRow {
  facultyId: string;
  name: string;
  department: string;
  totalPeriods: number;
  onTime: number;
  late: number;
  notMarked: number;
  pending: number;
}
interface AllResult { dates: string[]; rows: AllRow[] }

const ALL = "__all__";

// Department -> Course picker, then a daily or period query. The report lists
// every faculty member teaching that course (or, for "All" departments, every
// faculty member) with their periods and how many were not posted. Department is
// scoped to an HOD's own department(s) when hodScoped.
export function FacultyNotPostedView({
  title = "Not Posted Faculty Reports",
  description = "Faculty who did not submit student attendance — daily or for a period. For daily, also use the office correction flow.",
  hodScoped,
}: {
  title?: string;
  description?: string;
  hodScoped?: boolean;
}) {
  const [date, setDate] = useState("");
  const [departments, setDepartments] = useState<Department[]>([]);
  const [selectedDepartmentId, setSelectedDepartmentId] = useState("");
  const [courses, setCourses] = useState<Course[]>([]);
  // Every department in the college, by id - only to NAME the department a
  // course belongs to below. `departments` above is deliberately narrowed to
  // this HOD's own tree, and a feeder course belongs to a department outside
  // it, so that list cannot name them.
  const [departmentNameById, setDepartmentNameById] = useState<Record<string, string>>({});
  const [isLoadingCourses, setIsLoadingCourses] = useState(false);
  const [selectedCourseId, setSelectedCourseId] = useState("");

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [data, setData] = useState<AllResult | null>(null);
  const [onlyNotPosted, setOnlyNotPosted] = useState(true);
  const [downloading, setDownloading] = useState<"" | "pdf" | "xlsx">("");
  const [loading, setLoading] = useState(false);

  // For an HOD a level with one option is not a choice: Department is asked only
  // when there are sub-departments, Course only when there are several courses.
  const departmentId = selectedDepartmentId || (hodScoped && departments.length === 1 ? departments[0].id : "");
  const myDepartments = useMyDepartments();
  const hodOwnDepartments = hodScoped ? myDepartments.filter(Boolean) : null;

  useEffect(() => {
    fetch("/api/college/departments")
      .then((r) => r.json() as Promise<{ departments: Department[] }>)
      .then((d) => {
        const active = (d.departments ?? []).filter((dep) => dep.isActive);
        setDepartmentNameById(Object.fromEntries((d.departments ?? []).map((dep) => [dep.id, dep.name])));
        // An HOD sees their own department(s) plus the sub-departments beneath them.
        const ownIds = hodOwnDepartments ? new Set(active.filter((dep) => hodOwnDepartments.includes(dep.name)).map((dep) => dep.id)) : null;
        const scoped = ownIds ? active.filter((dep) => ownIds.has(dep.id) || (!!dep.parentDepartmentId && ownIds.has(dep.parentDepartmentId))) : active;
        setDepartments(scoped.sort((a, b) => a.name.localeCompare(b.name)));
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load departments" }));
    // hodOwnDepartments is derived fresh from the user every render - depend
    // on the user identity fields it's built from instead, so this doesn't
    // re-fetch on every render (same convention as FacultyAttendanceCompletionView).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myDepartments.join(",")]);

  useEffect(() => {
    void (async () => {
      setSelectedCourseId("");
      setCourses([]);
      if (!departmentId || departmentId === ALL) return;
      setIsLoadingCourses(true);
      try {
        const res = await fetch(`/api/college/courses?departmentId=${departmentId}`);
        const d = await res.json() as { courses: Course[] };
        // The API already scopes this list to the department: a sub-department
        // gets its parent's courses and a feeder department (e.g. Basic Science)
        // the courses it feeds, none of which are docs the department itself
        // owns, so the list is not narrowed any further here.
        const active = (d.courses ?? []).filter((c) => c.isActive);
        setCourses(active.sort((a, b) => a.name.localeCompare(b.name)));
      } catch {
        toast({ variant: "destructive", title: "Failed to load courses" });
      } finally {
        setIsLoadingCourses(false);
      }
    })();
  }, [departmentId]);

  const courseId = selectedCourseId || (hodScoped && courses.length === 1 ? courses[0].id : "");
  const duplicateCourseNames = useMemo(() => {
    const seen = new Set<string>();
    const dupes = new Set<string>();
    for (const c of courses) {
      if (seen.has(c.name)) dupes.add(c.name);
      seen.add(c.name);
    }
    return dupes;
  }, [courses]);
  const showDepartment = !hodScoped || departments.length !== 1;
  const allDepartments = departmentId === ALL;
  const showCourse = !!departmentId && !allDepartments && (!hodScoped || courses.length !== 1);
  const selectedDepartment = departments.find((d) => d.id === departmentId) ?? null;
  // A report needs "All", or a department AND a course.
  const canLoad = allDepartments || (!!selectedDepartment && !!courseId);

  async function load(mode: "daily" | "period") {
    if (!canLoad) {
      toast({ variant: "destructive", title: "Select a department and course" });
      return;
    }
    setLoading(true);
    try {
      const p = new URLSearchParams({ all: "true" });
      if (!allDepartments && selectedDepartment) {
        p.set("department", selectedDepartment.name);
        p.set("courseId", courseId);
      }
      if (mode === "daily") {
        if (!date) throw new Error("Pick date");
        p.set("date", date);
      } else {
        if (!from || !to) throw new Error("Pick from and to");
        p.set("from", from); p.set("to", to);
      }
      const res = await fetch(`/api/college/faculty-attendance-completion?${p.toString()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed");
      setData(json);
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Failed" });
    } finally {
      setLoading(false);
    }
  }

  // The report on screen as a plain table, so the downloads match it exactly
  // (including the "only not posted" tick for the all-faculty view).
  function currentTable(): TableExport | null {
    if (data == null) return null;
    const rows = onlyNotPosted ? data.rows.filter((r) => r.notMarked > 0) : data.rows;
    const range = data.dates.length === 1 ? data.dates[0] : `${data.dates[0]} to ${data.dates[data.dates.length - 1]}`;
    const scope = allDepartments ? "All departments" : `${selectedDepartment?.name ?? ""} - ${courses.find((c) => c.id === courseId)?.name ?? ""}`;
    return {
      title: "Faculty not posted", subtitle: `${scope} - ${range}${onlyNotPosted ? " - only faculty with not-posted periods" : ""}`,
      headers: ["Faculty", "Department", "Periods", "On time", "Late", "Not posted", "Pending"],
      rows: rows.map((r) => [r.name, r.department || "-", r.totalPeriods, r.onTime, r.late, r.notMarked, r.pending]),
    };
  }

  async function download(kind: "pdf" | "xlsx") {
    const table = currentTable();
    if (!table) return;
    setDownloading(kind);
    try {
      const base = `not-posted-${Date.now()}`;
      if (kind === "pdf") await downloadTablePdf(table, base);
      else await downloadTableXlsx(table, base);
    } catch {
      toast({ variant: "destructive", title: "Download failed" });
    } finally {
      setDownloading("");
    }
  }

  const downloadButtons = data != null ? (
    <div className="flex gap-2">
      <Button variant="outline" size="sm" onClick={() => void download("xlsx")} disabled={downloading !== ""}>
        {downloading === "xlsx" ? "Exporting…" : "Download Excel"}
      </Button>
      <Button variant="outline" size="sm" onClick={() => void download("pdf")} disabled={downloading !== ""}>
        {downloading === "pdf" ? "Generating…" : "Download PDF"}
      </Button>
    </div>
  ) : null;

  return (
    <div className="space-y-6">
      <PageHeader title={title} description={description} />

      <Card>
        <CardHeader><CardTitle>Faculty Not Posted — Query</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {showDepartment && <div>
              <Label htmlFor="faculty-notposted-department">Department</Label>
              <Select value={selectedDepartmentId} onValueChange={(v) => { setSelectedDepartmentId(v); setData(null); }}>
                <SelectTrigger id="faculty-notposted-department">
                  <SelectValue placeholder="Select department" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>All</SelectItem>
                  {departments.map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>}
            {showCourse && (
              <div>
                <Label htmlFor="faculty-notposted-course">Course</Label>
                <Select value={selectedCourseId} onValueChange={(v) => { setSelectedCourseId(v); setData(null); }} disabled={isLoadingCourses}>
                  <SelectTrigger id="faculty-notposted-course">
                    <SelectValue placeholder={isLoadingCourses ? "Loading courses…" : "Select course"} />
                  </SelectTrigger>
                  <SelectContent>
                    {courses.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                        {/* The API returns this department's own course AND any
                            feeder department's course of the same programme -
                            deliberately, since they are different course docs
                            with their own sections. Rendering the bare name put
                            two identical-looking rows in the list with no way
                            to tell them apart; the owner is shown only when a
                            name is actually ambiguous. */}
                        {duplicateCourseNames.has(c.name) && departmentNameById[c.departmentId] && (
                          <span className="text-muted-foreground"> · {departmentNameById[c.departmentId]}</span>
                        )}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="faculty-notposted-date">Daily date</Label>
              <Input
                id="faculty-notposted-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div className="flex items-end">
              <Button onClick={() => void load("daily")} disabled={loading || !canLoad}>Load</Button>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="faculty-notposted-from">From</Label>
              <Input id="faculty-notposted-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="faculty-notposted-to">To</Label>
              <Input id="faculty-notposted-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <div className="flex items-end">
              <Button onClick={() => void load("period")} disabled={loading || !canLoad}>Load</Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {!departmentId ? (
        <EmptyState title="Select a department to get started" />
      ) : allDepartments ? null : !courseId ? (
        <EmptyState title="Select a course, then pick a query above" />
      ) : null}

      {data != null && (() => {
        const d = data;
        const rows = onlyNotPosted ? d.rows.filter((r) => r.notMarked > 0) : d.rows;
        const range = d.dates.length === 1 ? d.dates[0] : `${d.dates[0]} to ${d.dates[d.dates.length - 1]}`;
        return (
          <Card>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center justify-between gap-2">
                <span>All faculty — {range}</span>
                <label className="flex cursor-pointer items-center gap-2 text-sm font-normal">
                  <Checkbox checked={onlyNotPosted} onCheckedChange={(v) => setOnlyNotPosted(v === true)} />
                  Only faculty with not-posted periods
                </label>
                {downloadButtons}
              </CardTitle>
            </CardHeader>
            <CardContent className="overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="px-3 py-2">Faculty</th>
                    <th className="px-3 py-2">Department</th>
                    <th className="px-3 py-2 text-center">Periods</th>
                    <th className="px-3 py-2 text-center">On time</th>
                    <th className="px-3 py-2 text-center">Late</th>
                    <th className="px-3 py-2 text-center">Not posted</th>
                    <th className="px-3 py-2 text-center">Pending</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((r) => (
                    <tr key={r.facultyId}>
                      <td className="px-3 py-2 font-medium">{r.name}</td>
                      <td className="px-3 py-2">{r.department || "—"}</td>
                      <td className="px-3 py-2 text-center">{r.totalPeriods}</td>
                      <td className="px-3 py-2 text-center">{r.onTime}</td>
                      <td className="px-3 py-2 text-center">{r.late}</td>
                      <td className="px-3 py-2 text-center font-semibold">{r.notMarked}</td>
                      <td className="px-3 py-2 text-center">{r.pending}</td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr><td className="px-3 py-4 text-center text-muted-foreground" colSpan={7}>{onlyNotPosted ? "No faculty have not-posted periods." : "No faculty found."}</td></tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        );
      })()}
    </div>
  );
}
