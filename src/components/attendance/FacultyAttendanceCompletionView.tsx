"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { TableSkeleton } from "@/components/shared/SkeletonLoader";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import { useAuth } from "@/hooks/useAuth";
import type { Department, Course } from "@/types";

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

interface FacultyOption {
  facultyId: string;
  name: string;
  designation: string;
}

type PeriodStatus = "ON_TIME" | "LATE" | "NOT_MARKED" | "PENDING";

interface PeriodRow {
  periodNumber: number;
  startTime: string;
  endTime: string;
  courseId: string;
  year: number;
  sectionName: string | null;
  subjectName: string;
  status: PeriodStatus;
  submittedAtDisplay: string | null;
}

function statusBadgeClass(status: PeriodStatus): string {
  switch (status) {
    case "ON_TIME":    return "bg-green-100 text-green-800 border-green-200";
    case "LATE":       return "bg-orange-100 text-orange-800 border-orange-200";
    case "NOT_MARKED": return "bg-red-100 text-red-800 border-red-200";
    case "PENDING":    return "bg-gray-100 text-gray-600 border-gray-200";
  }
}

const STATUS_LABELS: Record<PeriodStatus, string> = {
  ON_TIME: "On Time",
  LATE: "Late",
  NOT_MARKED: "Not Marked",
  PENDING: "Pending",
};

interface FacultyAttendanceCompletionViewProps {
  title: string;
  description: string;
  // HOD's own view - restricts the Department picker to their own
  // department(s) (user.departments/department). The API route enforces the
  // same restriction server-side regardless (getHodDepartmentScope /
  // canHodEditDepartment) - this is the matching client-side narrowing so an
  // HOD never even sees another department as an option.
  hodScoped?: boolean;
}

export function FacultyAttendanceCompletionView({ title, description, hodScoped }: FacultyAttendanceCompletionViewProps) {
  const { user } = useAuth();
  const router = useRouter();

  // Defense-in-depth: the nav item is already hidden from College Admin (see
  // navConfig's hideForRealRoles) and the API 403s them regardless, but a
  // direct URL hit should still bounce rather than render a page that then
  // fails every fetch.
  useEffect(() => {
    if (user && user.realRole === "COLLEGE_ADMIN") {
      router.replace("/principal");
    }
  }, [user, router]);

  const [date, setDate] = useState(todayISO());
  const [departments, setDepartments] = useState<Department[]>([]);
  const [selectedDepartmentId, setSelectedDepartmentId] = useState("");
  const [courses, setCourses] = useState<Course[]>([]);
  const [isLoadingCourses, setIsLoadingCourses] = useState(false);
  const [selectedCourseId, setSelectedCourseId] = useState("");

  const [faculty, setFaculty] = useState<FacultyOption[]>([]);
  const [isLoadingFaculty, setIsLoadingFaculty] = useState(false);
  const [selectedFacultyId, setSelectedFacultyId] = useState("");

  const [periods, setPeriods] = useState<PeriodRow[]>([]);
  const [isLoadingPeriods, setIsLoadingPeriods] = useState(false);

  const hodOwnDepartments = hodScoped
    ? (user?.departments && user.departments.length > 0 ? user.departments : [user?.department ?? ""]).filter(Boolean)
    : null;

  useEffect(() => {
    fetch("/api/college/departments")
      .then((r) => r.json() as Promise<{ departments: Department[] }>)
      .then((d) => {
        const active = (d.departments ?? []).filter((dep) => dep.isActive);
        const scoped = hodOwnDepartments ? active.filter((dep) => hodOwnDepartments.includes(dep.name)) : active;
        setDepartments(scoped.sort((a, b) => a.name.localeCompare(b.name)));
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load departments" }));
    // hodOwnDepartments is derived fresh from `user` every render - depend on
    // the user identity fields it's built from instead, so this doesn't
    // re-fetch on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.department, user?.departments?.join(",")]);

  useEffect(() => {
    // Wrapped so setState calls aren't reachable synchronously from the
    // effect body (react-hooks/set-state-in-effect).
    void (async () => {
      setSelectedCourseId("");
      setCourses([]);
      if (!selectedDepartmentId) return;
      setIsLoadingCourses(true);
      try {
        const res = await fetch(`/api/college/courses?departmentId=${selectedDepartmentId}`);
        const d = await res.json() as { courses: Course[] };
        // GET /api/college/courses also returns a feeder department's own
        // course docs (e.g. a shared first-year "Basic Science" course cross-
        // listed into this department - see getRelatedDepartmentIds) - real,
        // distinct data other pages intentionally show, but here it just
        // looks like the same course name twice with no faculty behind the
        // feeder's copy (this department's own teachingAssignments are never
        // filed under the feeder's course id). Keep only this department's
        // own course docs so the picker only ever offers a course that can
        // actually resolve to this department's faculty.
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
      setPeriods([]);
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

  useEffect(() => {
    void (async () => {
      setPeriods([]);
      if (!selectedFacultyId || !date) return;
      setIsLoadingPeriods(true);
      try {
        const params = new URLSearchParams({ date, facultyId: selectedFacultyId });
        const res = await fetch(`/api/college/faculty-attendance-completion?${params.toString()}`);
        const d = await res.json() as { periods?: PeriodRow[]; error?: string };
        setPeriods(d.periods ?? []);
      } catch {
        toast({ variant: "destructive", title: "Failed to load periods" });
      } finally {
        setIsLoadingPeriods(false);
      }
    })();
  }, [selectedFacultyId, date]);

  const selectedFaculty = faculty.find((f) => f.facultyId === selectedFacultyId) ?? null;
  const markedOnTimeCount = periods.filter((p) => p.status === "ON_TIME").length;

  return (
    <div className="space-y-6">
      <PageHeader title={title} description={description} />

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-2">
          <Label htmlFor="completion-date">Date</Label>
          <Input id="completion-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-44" />
        </div>

        <div className="space-y-2">
          <Label htmlFor="completion-department">Department</Label>
          <Select value={selectedDepartmentId} onValueChange={setSelectedDepartmentId}>
            <SelectTrigger id="completion-department" className="w-64">
              <SelectValue placeholder="Select Department" />
            </SelectTrigger>
            <SelectContent>
              {departments.map((d) => (
                <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {selectedDepartmentId && (
          <div className="space-y-2">
            <Label htmlFor="completion-course">Course</Label>
            <Select value={selectedCourseId} onValueChange={setSelectedCourseId} disabled={isLoadingCourses}>
              <SelectTrigger id="completion-course" className="w-64">
                <SelectValue placeholder={isLoadingCourses ? "Loading courses…" : "Select Course"} />
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
          <div className="space-y-2">
            <Label htmlFor="completion-faculty">Faculty</Label>
            <Select value={selectedFacultyId} onValueChange={setSelectedFacultyId} disabled={isLoadingFaculty}>
              <SelectTrigger id="completion-faculty" className="w-64">
                <SelectValue placeholder={isLoadingFaculty ? "Loading faculty…" : "Select Faculty"} />
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

      {!selectedDepartmentId ? (
        <EmptyState title="Select a department to get started" />
      ) : !selectedCourseId ? (
        <EmptyState title="Select a course to see its faculty" />
      ) : isLoadingFaculty ? (
        <TableSkeleton rows={3} cols={3} />
      ) : faculty.length === 0 ? (
        <EmptyState title="No faculty found for this course" />
      ) : !selectedFacultyId ? (
        <EmptyState title="Select a faculty member to view their periods for this date" />
      ) : isLoadingPeriods ? (
        <TableSkeleton rows={5} cols={5} />
      ) : periods.length === 0 ? (
        <EmptyState
          title="No scheduled periods"
          description={`${selectedFaculty?.name ?? "This faculty member"} has no published timetable periods on ${date}.`}
        />
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            {markedOnTimeCount} of {periods.length} periods marked on time
          </div>
          <div className="rounded-lg border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-4 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">Period</th>
                    <th className="px-4 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">Time</th>
                    <th className="px-4 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">Subject</th>
                    <th className="px-4 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">Year / Section</th>
                    <th className="px-4 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">Status</th>
                    <th className="px-4 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">Submitted</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {periods.map((p) => (
                    <tr key={p.periodNumber} className="bg-background">
                      <td className="px-4 py-3 whitespace-nowrap">{p.periodNumber}</td>
                      <td className="px-4 py-3 whitespace-nowrap">{p.startTime}–{p.endTime}</td>
                      <td className="px-4 py-3 whitespace-nowrap">{p.subjectName}</td>
                      <td className="px-4 py-3 whitespace-nowrap">Year {p.year}{p.sectionName ? ` / ${p.sectionName}` : ""}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${statusBadgeClass(p.status)}`}>
                          {STATUS_LABELS[p.status]}
                        </span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">{p.submittedAtDisplay ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
