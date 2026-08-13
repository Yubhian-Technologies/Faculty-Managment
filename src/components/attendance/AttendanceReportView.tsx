"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, ShieldCheck, Search, Download } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { TableSkeleton } from "@/components/shared/SkeletonLoader";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import { exportToCSV } from "@/lib/utils";
import { isLateCheckIn } from "@/lib/attendance/lateStatus";
import { ATTENDANCE_STATUS_LABELS, type AttendanceStatus, type Department, type Course } from "@/types";

interface RosterEntry {
  uid: string;
  name: string;
  department: string;
  role: "PANEL_MEMBER" | "HOD";
  // Course id(s) this faculty has an explicit teaching assignment under —
  // only populated by the API for college-wide callers; used solely to
  // filter the Principal's report, never displayed/required in the flat
  // (HOD) view. Empty when no course-linked assignment is on record yet.
  courseIds?: string[];
  status: string;
  checkIn: string | null;
  checkOut: string | null;
  checkInVerified: boolean;
  checkOutVerified: boolean;
  [key: string]: unknown;
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case "PRESENT":    return "bg-green-100 text-green-800 border-green-200";
    case "ABSENT":     return "bg-red-100 text-red-800 border-red-200";
    case "HALF_DAY":   return "bg-yellow-100 text-yellow-800 border-yellow-200";
    case "ON_LEAVE":   return "bg-blue-100 text-blue-800 border-blue-200";
    case "ON_DUTY":    return "bg-purple-100 text-purple-800 border-purple-200";
    case "NOT_MARKED": return "bg-gray-100 text-gray-600 border-gray-200";
    default:           return "bg-gray-100 text-gray-700 border-gray-200";
  }
}

function statusLabel(status: string): string {
  if (status === "NOT_MARKED") return "Not Marked";
  return ATTENDANCE_STATUS_LABELS[status as AttendanceStatus] ?? status;
}

function StatusCell({ row }: { row: RosterEntry }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${statusBadgeClass(row.status)}`}>
        {statusLabel(row.status)}
      </span>
      {isLateCheckIn(row.checkIn) && (
        <span className="inline-flex items-center rounded-full border border-red-200 bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-800">
          Late
        </span>
      )}
    </span>
  );
}

function CheckInCell({ row }: { row: RosterEntry }) {
  return row.checkIn ? (
    <span className="inline-flex items-center gap-1">
      {row.checkIn}
      {row.checkInVerified && <ShieldCheck className="h-3.5 w-3.5 text-green-600" aria-label="Face + location verified" />}
    </span>
  ) : <>—</>;
}

function CheckOutCell({ row }: { row: RosterEntry }) {
  return row.checkOut ? (
    <span className="inline-flex items-center gap-1">
      {row.checkOut}
      {row.checkOutVerified && <ShieldCheck className="h-3.5 w-3.5 text-green-600" aria-label="Face + location verified" />}
    </span>
  ) : <>—</>;
}

function RosterTable({ rows }: { rows: RosterEntry[] }) {
  return (
    <div className="rounded-lg border overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-4 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">Name</th>
              <th className="px-4 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">Status</th>
              <th className="px-4 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">Check In</th>
              <th className="px-4 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">Check Out</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((row) => (
              <tr key={row.uid} className="bg-background">
                <td className="px-4 py-3 whitespace-nowrap">{row.name}</td>
                <td className="px-4 py-3 whitespace-nowrap"><StatusCell row={row} /></td>
                <td className="px-4 py-3 whitespace-nowrap"><CheckInCell row={row} /></td>
                <td className="px-4 py-3 whitespace-nowrap"><CheckOutCell row={row} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface AttendanceReportViewProps {
  title: string;
  description: string;
  // Adds dependent Department -> Course dropdowns above the report and, once
  // both are picked, shows that department's HOD plus its faculty for that
  // course instead of the flat table. Opt-in so the HOD's department-scoped
  // report keeps its existing flat layout untouched.
  groupByDepartmentAndCourse?: boolean;
}

export function AttendanceReportView({ title, description, groupByDepartmentAndCourse }: AttendanceReportViewProps) {
  const [date, setDate] = useState(todayISO());
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");

  const [departments, setDepartments] = useState<Department[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [selectedDepartmentId, setSelectedDepartmentId] = useState("");
  const [selectedCourseId, setSelectedCourseId] = useState("");
  const [isLoadingCourses, setIsLoadingCourses] = useState(false);

  useEffect(() => {
    setIsLoading(true);
    fetch(`/api/college/attendance/report?date=${date}`)
      .then((r) => r.json() as Promise<{ roster: RosterEntry[]; error?: string }>)
      .then((d) => setRoster(d.roster ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load attendance report" }))
      .finally(() => setIsLoading(false));
  }, [date]);

  useEffect(() => {
    if (!groupByDepartmentAndCourse) return;
    fetch("/api/college/departments")
      .then((r) => r.json() as Promise<{ departments: Department[] }>)
      .then((d) => setDepartments((d.departments ?? []).filter((dep) => dep.isActive).sort((a, b) => a.name.localeCompare(b.name))))
      .catch(() => toast({ variant: "destructive", title: "Failed to load departments" }));
  }, [groupByDepartmentAndCourse]);

  useEffect(() => {
    void (async () => {
      if (!groupByDepartmentAndCourse || !selectedDepartmentId) {
        setCourses([]);
        return;
      }
      setIsLoadingCourses(true);
      try {
        const res = await fetch(`/api/college/courses?departmentId=${selectedDepartmentId}`);
        const d = await res.json() as { courses: Course[] };
        setCourses((d.courses ?? []).filter((c) => c.isActive).sort((a, b) => a.name.localeCompare(b.name)));
      } catch {
        toast({ variant: "destructive", title: "Failed to load courses" });
      } finally {
        setIsLoadingCourses(false);
      }
    })();
  }, [groupByDepartmentAndCourse, selectedDepartmentId]);

  const presentCount = roster.filter((r) => r.status === "PRESENT").length;

  const columns: Column<RosterEntry>[] = [
    { key: "name", header: "Faculty" },
    { key: "department", header: "Department", hideOnMobile: true },
    { key: "status", header: "Status", render: (row) => <StatusCell row={row} /> },
    { key: "checkIn", header: "Check In", render: (row) => <CheckInCell row={row} /> },
    { key: "checkOut", header: "Check Out", render: (row) => <CheckOutCell row={row} /> },
  ];

  const selectedDepartment = departments.find((d) => d.id === selectedDepartmentId) ?? null;
  const selectedCourse = courses.find((c) => c.id === selectedCourseId) ?? null;

  const scopedRoster = selectedDepartment ? roster.filter((r) => r.department === selectedDepartment.name) : [];
  const hodEntry = scopedRoster.find((r) => r.role === "HOD") ?? null;
  // A faculty with an explicit teaching assignment must match the selected
  // course's id exactly (real signal, respected either way). One with NO
  // course-linked assignment on record at all hasn't been disambiguated yet
  // — rather than hiding a real department faculty member behind that gap in
  // the data, they're shown under any course of their department until an
  // assignment says otherwise.
  const facultyEntries = selectedCourse
    ? scopedRoster.filter((r) => {
        if (r.role === "HOD") return false;
        const courseIds = r.courseIds ?? [];
        return courseIds.length === 0 || courseIds.includes(selectedCourse.id);
      })
    : [];

  const searchedHod = hodEntry && (!search || hodEntry.name.toLowerCase().includes(search.toLowerCase())) ? hodEntry : null;
  const searchedFaculty = search
    ? facultyEntries.filter((r) => r.name.toLowerCase().includes(search.toLowerCase()))
    : facultyEntries;

  function handleGroupedExport() {
    const rows = [...(searchedHod ? [searchedHod] : []), ...searchedFaculty];
    exportToCSV(rows, `attendance-${date}`, columns.map((c) => ({ key: c.key, header: c.header })));
  }

  return (
    <div className="space-y-6">
      <PageHeader title={title} description={description} />

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-2">
          <Label htmlFor="report-date">Date</Label>
          <Input id="report-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-44" />
        </div>
        {!isLoading && (
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground pb-2.5">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            {presentCount} of {roster.length} present
          </div>
        )}
      </div>

      {groupByDepartmentAndCourse ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-2">
              <Label htmlFor="report-department">Department</Label>
              <Select
                value={selectedDepartmentId}
                onValueChange={(v) => { setSelectedDepartmentId(v); setSelectedCourseId(""); }}
              >
                <SelectTrigger id="report-department" className="w-64">
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
                <Label htmlFor="report-course">Course</Label>
                <Select value={selectedCourseId} onValueChange={setSelectedCourseId} disabled={isLoadingCourses}>
                  <SelectTrigger id="report-course" className="w-64">
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
          </div>

          {!selectedDepartment ? (
            <EmptyState title="Select a department to view its attendance report" />
          ) : !selectedCourse ? (
            <EmptyState title="Select a course to view its faculty" />
          ) : (
            <div className="space-y-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="relative flex-1 max-w-sm">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search by name..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-9"
                    autoComplete="off"
                  />
                </div>
                <Button variant="outline" size="sm" onClick={handleGroupedExport}>
                  <Download className="h-4 w-4 mr-1" />
                  Export CSV
                </Button>
              </div>

              {isLoading ? (
                <TableSkeleton rows={5} cols={4} />
              ) : (
                <div className="space-y-6">
                  <div className="space-y-2">
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">HOD</h3>
                    {searchedHod ? (
                      <RosterTable rows={[searchedHod]} />
                    ) : (
                      <p className="text-sm text-muted-foreground">No HOD assigned for this department.</p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Faculty · {searchedFaculty.length}
                    </h3>
                    {searchedFaculty.length > 0 ? (
                      <RosterTable rows={searchedFaculty} />
                    ) : (
                      <EmptyState title="No faculty found" />
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        <DataTable
          data={roster}
          columns={columns}
          isLoading={isLoading}
          keyExtractor={(r) => r.uid}
          searchPlaceholder="Search faculty..."
          searchKeys={["name", "department"]}
          emptyTitle="No faculty found"
          csvFilename={`attendance-${date}`}
        />
      )}
    </div>
  );
}
