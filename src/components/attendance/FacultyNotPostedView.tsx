"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/shared/EmptyState";
import { toast } from "@/hooks/useToast";
import { useMyDepartments } from "@/hooks/useMyDepartments";
import type { Department, Course } from "@/types";

interface PeriodRow {
  assignmentId: string;
  periodNumber: number;
  startTime: string;
  endTime: string;
  sectionName: string | null;
  subjectName: string;
  status: "ON_TIME" | "LATE" | "NOT_MARKED" | "PENDING" | "IN_PROGRESS";
  submittedAtDisplay: string | null;
}
interface DailyResult {
  facultyName: string;
  date: string;
  periods: PeriodRow[];
}
interface RangeResult {
  facultyName: string;
  totalPeriods: number;
  onTime: number;
  late: number;
  notMarked: number;
  pending: number;
  byDate: Record<string, { periods: number; notMarked: number }>;
}
interface FacultyOption {
  facultyId: string;
  name: string;
  designation: string;
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Cascading picker: Department -> Course -> Faculty, same real APIs and
// pattern as FacultyAttendanceCompletionView's own picker (department scoped
// to an HOD's own department(s) when hodScoped, course narrowed to that
// department, faculty narrowed to who actually teaches that course) -
// replacing the old raw facultyId text field. `facultyId` here is always the
// facultyMembers doc id (see /api/college/faculty-attendance-completion's own
// doc-comment), matching what /api/college/faculty-attendance-completion
// itself expects for both the daily and range queries below.
export function FacultyNotPostedView({
  title = "Not Posted Faculty Reports",
  description = "Faculty who did not submit student attendance — daily, monthly, period, till now. For daily, also use the office correction flow.",
  hodScoped,
}: {
  title?: string;
  description?: string;
  hodScoped?: boolean;
}) {
  const [date, setDate] = useState(todayISO());
  const [departments, setDepartments] = useState<Department[]>([]);
  const [selectedDepartmentId, setSelectedDepartmentId] = useState("");
  const [courses, setCourses] = useState<Course[]>([]);
  const [isLoadingCourses, setIsLoadingCourses] = useState(false);
  const [selectedCourseId, setSelectedCourseId] = useState("");

  const [faculty, setFaculty] = useState<FacultyOption[]>([]);
  const [isLoadingFaculty, setIsLoadingFaculty] = useState(false);
  const [selectedFacultyId, setSelectedFacultyId] = useState("");

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [year, setYear] = useState("");
  const [month, setMonth] = useState("");
  const [data, setData] = useState<DailyResult | RangeResult | null>(null);
  const [loadedMode, setLoadedMode] = useState<"daily" | "range" | null>(null);
  const [loading, setLoading] = useState(false);

  const myDepartments = useMyDepartments();
  const hodOwnDepartments = hodScoped ? myDepartments.filter(Boolean) : null;

  useEffect(() => {
    fetch("/api/college/departments")
      .then((r) => r.json() as Promise<{ departments: Department[] }>)
      .then((d) => {
        const active = (d.departments ?? []).filter((dep) => dep.isActive);
        const scoped = hodOwnDepartments ? active.filter((dep) => hodOwnDepartments.includes(dep.name)) : active;
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
      if (!selectedDepartmentId) return;
      setIsLoadingCourses(true);
      try {
        const res = await fetch(`/api/college/courses?departmentId=${selectedDepartmentId}`);
        const d = await res.json() as { courses: Course[] };
        const ownOnly = (d.courses ?? []).filter((c) => c.isActive && c.departmentId === selectedDepartmentId);
        setCourses(ownOnly.sort((a, b) => a.name.localeCompare(b.name)));
      } catch {
        toast({ variant: "destructive", title: "Failed to load courses" });
      } finally {
        setIsLoadingCourses(false);
      }
    })();
  }, [selectedDepartmentId]);

  const selectedDepartment = departments.find((d) => d.id === selectedDepartmentId) ?? null;

  useEffect(() => {
    void (async () => {
      setSelectedFacultyId("");
      setFaculty([]);
      setData(null);
      setLoadedMode(null);
      if (!selectedDepartment || !selectedCourseId || !date) return;
      setIsLoadingFaculty(true);
      try {
        const params = new URLSearchParams({ date, department: selectedDepartment.name, courseId: selectedCourseId });
        const res = await fetch(`/api/college/faculty-attendance-completion?${params.toString()}`);
        const d = await res.json() as { faculty?: FacultyOption[]; error?: string };
        setFaculty(d.faculty ?? []);
      } catch {
        toast({ variant: "destructive", title: "Failed to load faculty" });
      } finally {
        setIsLoadingFaculty(false);
      }
    })();
  }, [selectedDepartment, selectedCourseId, date]);

  const selectedFaculty = faculty.find((f) => f.facultyId === selectedFacultyId) ?? null;

  async function load(mode: "daily" | "period" | "month" | "tillNow") {
    if (!selectedFacultyId) {
      toast({ variant: "destructive", title: "Select faculty" });
      return;
    }
    setLoading(true);
    try {
      const p = new URLSearchParams({ facultyId: selectedFacultyId });
      if (mode === "daily") {
        if (!date) throw new Error("Pick date");
        p.set("date", date);
      } else if (mode === "period") {
        if (!from || !to) throw new Error("Pick from and to");
        p.set("from", from); p.set("to", to);
      } else if (mode === "month") {
        if (!year || !month) throw new Error("Pick year+month");
        p.set("year", year); p.set("month", month);
      } else if (mode === "tillNow") p.set("allTime", "true");
      const res = await fetch(`/api/college/faculty-attendance-completion?${p.toString()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed");
      setData(json);
      setLoadedMode(mode === "daily" ? "daily" : "range");
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Failed" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title={title} description={description} />

      <Card>
        <CardHeader><CardTitle>Faculty Not Posted — Query</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <Label htmlFor="faculty-notposted-department">Department</Label>
              <Select value={selectedDepartmentId} onValueChange={setSelectedDepartmentId}>
                <SelectTrigger id="faculty-notposted-department">
                  <SelectValue placeholder="Select department" />
                </SelectTrigger>
                <SelectContent>
                  {departments.map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {selectedDepartmentId && (
              <div>
                <Label htmlFor="faculty-notposted-course">Course</Label>
                <Select value={selectedCourseId} onValueChange={setSelectedCourseId} disabled={isLoadingCourses}>
                  <SelectTrigger id="faculty-notposted-course">
                    <SelectValue placeholder={isLoadingCourses ? "Loading courses…" : "Select course"} />
                  </SelectTrigger>
                  <SelectContent>
                    {courses.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {selectedCourseId && (
              <div>
                <Label htmlFor="faculty-notposted-faculty">Faculty</Label>
                <Select value={selectedFacultyId} onValueChange={setSelectedFacultyId} disabled={isLoadingFaculty}>
                  <SelectTrigger id="faculty-notposted-faculty">
                    <SelectValue placeholder={isLoadingFaculty ? "Loading faculty…" : "Select faculty"} />
                  </SelectTrigger>
                  <SelectContent>
                    {faculty.map((f) => (
                      <SelectItem key={f.facultyId} value={f.facultyId}>{f.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          {selectedCourseId && !isLoadingFaculty && faculty.length === 0 && (
            <p className="text-xs text-muted-foreground">No faculty found for this course.</p>
          )}

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
              <Button onClick={() => void load("daily")} disabled={loading || !selectedFacultyId}>Load Daily</Button>
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
              <Button onClick={() => void load("period")} disabled={loading || !selectedFacultyId}>Load Period</Button>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="faculty-notposted-year">Year</Label>
              <Input id="faculty-notposted-year" value={year} onChange={(e) => setYear(e.target.value)} placeholder="2026" />
            </div>
            <div>
              <Label htmlFor="faculty-notposted-month">Month</Label>
              <Input id="faculty-notposted-month" value={month} onChange={(e) => setMonth(e.target.value)} placeholder="4" />
            </div>
            <div className="flex items-end">
              <Button onClick={() => void load("month")} disabled={loading || !selectedFacultyId}>Load Monthly</Button>
            </div>
          </div>
          <Button variant="outline" onClick={() => void load("tillNow")} disabled={loading || !selectedFacultyId}>
            Load Till Now (365d cap)
          </Button>
        </CardContent>
      </Card>

      {!selectedDepartmentId ? (
        <EmptyState title="Select a department to get started" />
      ) : !selectedCourseId ? (
        <EmptyState title="Select a course to see its faculty" />
      ) : !selectedFacultyId ? (
        <EmptyState title="Select a faculty member, then pick a query above" />
      ) : null}

      {data != null && loadedMode === "daily" && (() => {
        const d = data as DailyResult;
        return (
          <Card>
            <CardHeader><CardTitle>{selectedFaculty?.name ?? d.facultyName} — {d.date}</CardTitle></CardHeader>
            <CardContent className="overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="px-3 py-2">Period</th>
                    <th className="px-3 py-2">Time</th>
                    <th className="px-3 py-2">Section</th>
                    <th className="px-3 py-2">Subject</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Submitted At</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {d.periods.map((p) => (
                    <tr key={`${p.assignmentId}_${p.periodNumber}`}>
                      <td className="px-3 py-2">{p.periodNumber}</td>
                      <td className="px-3 py-2">{p.startTime}–{p.endTime}</td>
                      <td className="px-3 py-2">{p.sectionName ?? "—"}</td>
                      <td className="px-3 py-2">{p.subjectName}</td>
                      <td className="px-3 py-2">{p.status}</td>
                      <td className="px-3 py-2">{p.submittedAtDisplay ?? "—"}</td>
                    </tr>
                  ))}
                  {d.periods.length === 0 && (
                    <tr><td className="px-3 py-4 text-center text-muted-foreground" colSpan={6}>No scheduled periods that day.</td></tr>
                  )}
                </tbody>
              </table>
            </CardContent>
          </Card>
        );
      })()}
      {data != null && loadedMode === "range" && (() => {
        const d = data as RangeResult;
        const dates = Object.keys(d.byDate).sort();
        return (
          <Card>
            <CardHeader><CardTitle>{selectedFaculty?.name ?? d.facultyName} — Summary</CardTitle></CardHeader>
            <CardContent className="space-y-4 overflow-auto">
              <div className="flex flex-wrap gap-4 text-sm">
                <span>Total periods: <strong>{d.totalPeriods}</strong></span>
                <span>On time: <strong>{d.onTime}</strong></span>
                <span>Late: <strong>{d.late}</strong></span>
                <span>Not posted: <strong>{d.notMarked}</strong></span>
                <span>Pending: <strong>{d.pending}</strong></span>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Periods</th>
                    <th className="px-3 py-2">Not Posted</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {dates.map((date) => (
                    <tr key={date}>
                      <td className="px-3 py-2">{date}</td>
                      <td className="px-3 py-2">{d.byDate[date].periods}</td>
                      <td className="px-3 py-2">{d.byDate[date].notMarked}</td>
                    </tr>
                  ))}
                  {dates.length === 0 && (
                    <tr><td className="px-3 py-4 text-center text-muted-foreground" colSpan={3}>No scheduled periods in range.</td></tr>
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
