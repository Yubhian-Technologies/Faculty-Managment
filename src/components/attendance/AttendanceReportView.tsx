"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, ShieldCheck, Search, Download, Upload, Pencil, CalendarDays, Clock3 } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { EmptyState } from "@/components/shared/EmptyState";
import { TableSkeleton } from "@/components/shared/SkeletonLoader";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { toast } from "@/hooks/useToast";
import { exportToCSV, exportRosterMonthlyCSV } from "@/lib/utils";
import { isLateCheckIn } from "@/lib/attendance/lateStatus";
import { isManualEditWindowOpen, MANUAL_EDIT_WINDOW_CLOSED_MESSAGE } from "@/lib/attendance/attendanceWindow";
import { ATTENDANCE_STATUS_LABELS, type AttendanceStatus, type Department, type Course, type MonthlySummaryRow } from "@/types";

interface RosterEntry {
  uid: string;
  name: string;
  department: string;
  role: "PANEL_MEMBER" | "HOD" | "COLLEGE_STAFF";
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
  // HOD-granted exception for this specific day (see "Permission" below) -
  // arriving at/before this time never counts as Late, even past 09:05.
  permittedCheckInTime?: string | null;
  // The reason an HOD/Principal/VP wrote when manually marking/correcting
  // this record, or the auto-generated explanation for a derived Absent day
  // - visible here so Management (and anyone else reviewing this roster)
  // can see why, not just what.
  remarks?: string | null;
  [key: string]: unknown;
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function currentMonthValue(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case "PRESENT":        return "bg-green-100 text-green-800 border-green-200";
    case "ABSENT":         return "bg-red-100 text-red-800 border-red-200";
    case "HALF_DAY":       return "bg-yellow-100 text-yellow-800 border-yellow-200";
    case "ON_LEAVE":       return "bg-blue-100 text-blue-800 border-blue-200";
    case "ON_DUTY":        return "bg-purple-100 text-purple-800 border-purple-200";
    case "NOT_MARKED":     return "bg-gray-100 text-gray-600 border-gray-200";
    case "NOT_REGISTERED": return "bg-orange-100 text-orange-800 border-orange-200";
    default:                return "bg-gray-100 text-gray-700 border-gray-200";
  }
}

function statusLabel(status: string): string {
  if (status === "NOT_MARKED") return "Not Checked In Yet";
  if (status === "NOT_REGISTERED") return "Not Registered";
  return ATTENDANCE_STATUS_LABELS[status as AttendanceStatus] ?? status;
}

function StatusCell({ row }: { row: RosterEntry }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${statusBadgeClass(row.status)}`}>
        {statusLabel(row.status)}
      </span>
      {row.status === "PRESENT" && isLateCheckIn(row.checkIn, row.permittedCheckInTime) && (
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

function ReasonCell({ row }: { row: RosterEntry }) {
  return row.remarks ? (
    <span className="text-xs text-muted-foreground italic">{row.remarks}</span>
  ) : <>—</>;
}

function RosterTable({ rows, onMark, monthlyViewBasePath }: { rows: RosterEntry[]; onMark?: (row: RosterEntry) => void; monthlyViewBasePath?: string }) {
  const showActions = !!onMark || !!monthlyViewBasePath;
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
              <th className="px-4 py-2 text-left font-medium text-muted-foreground whitespace-nowrap">Reason</th>
              {showActions && <th className="px-4 py-2 text-left font-medium text-muted-foreground whitespace-nowrap" />}
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((row) => (
              <tr key={row.uid} className="bg-background">
                <td className="px-4 py-3 whitespace-nowrap">{row.name}</td>
                <td className="px-4 py-3 whitespace-nowrap"><StatusCell row={row} /></td>
                <td className="px-4 py-3 whitespace-nowrap"><CheckInCell row={row} /></td>
                <td className="px-4 py-3 whitespace-nowrap"><CheckOutCell row={row} /></td>
                <td className="px-4 py-3 max-w-xs"><ReasonCell row={row} /></td>
                {showActions && (
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      {monthlyViewBasePath && (
                        <Button variant="outline" size="sm" asChild>
                          <Link href={`${monthlyViewBasePath}/${row.uid}`}>
                            <CalendarDays className="h-3.5 w-3.5 mr-1" /> This Month
                          </Link>
                        </Button>
                      )}
                      {onMark && (
                        <Button variant="outline" size="sm" onClick={() => onMark(row)}>
                          <Pencil className="h-3.5 w-3.5 mr-1" /> Mark
                        </Button>
                      )}
                    </div>
                  </td>
                )}
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
  // Shows a "Mark" action that opens a dialog to set check-in/out on
  // someone's behalf (POST /api/college/attendance/manual) - for when they
  // can't complete the self-attendance flow themselves (most commonly:
  // checked in, then left campus for official work, so the on-campus
  // geofence blocks their own check-out). Wired to whichever row(s) the
  // caller is actually authorized to mark - the API enforces that
  // server-side regardless of this prop either way:
  //   - Flat (non-grouped) table: every Faculty row - HOD's own report.
  //   - Grouped table: only the HOD row, never Faculty - Principal/VP's
  //     report, mirroring the face-registration reset cascade (one tier at
  //     a time; Principal doesn't skip past the HOD to mark Faculty here).
  allowManualMark?: boolean;
  // Adds a "This Month" link (to `${monthlyViewBasePath}/${uid}`) next to
  // Mark, opening PersonMonthlyAttendanceView for that person - the whole
  // month at a glance instead of one date at a time. Same row scoping as
  // allowManualMark; pass the caller's own base route (e.g.
  // "/hod/faculty-attendance" or "/principal/attendance-report").
  monthlyViewBasePath?: string;
  // Adds an "Import CSV" button right next to "Export Department (Month)",
  // linking to that role's bulk attendance-history import page (see
  // AttendanceImportPage) - kept beside Export rather than only in the
  // sidebar nav, since that's where someone reviewing a month is already
  // looking when they notice a gap worth backfilling.
  importHref?: string;
}

export function AttendanceReportView({ title, description, groupByDepartmentAndCourse, allowManualMark, monthlyViewBasePath, importHref }: AttendanceReportViewProps) {
  const [date, setDate] = useState(todayISO());
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");

  const [departments, setDepartments] = useState<Department[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [selectedDepartmentId, setSelectedDepartmentId] = useState("");
  const [selectedCourseId, setSelectedCourseId] = useState("");
  const [isLoadingCourses, setIsLoadingCourses] = useState(false);

  // Department-wide / college-wide monthly CSV export (every day of the
  // selected month, every person in scope) - distinct from the existing
  // per-date "Export CSV" above, which only ever covers the single picked
  // `date`. Shared month picker for both scopes.
  const [exportMonth, setExportMonth] = useState(currentMonthValue());
  const [exportingScope, setExportingScope] = useState<"department" | "college" | null>(null);

  const [markTarget, setMarkTarget] = useState<RosterEntry | null>(null);
  const [manualCheckIn, setManualCheckIn] = useState("");
  const [manualCheckOut, setManualCheckOut] = useState("");
  const [manualReason, setManualReason] = useState("");
  const [isMarking, setIsMarking] = useState(false);

  // "Permission" (HOD-only, Faculty only - see check-in-permission/route.ts):
  // excuses a specific late arrival time in advance of the person's OWN
  // self-check-in, distinct from Mark above (which sets the check-in/out
  // time directly on their behalf).
  const [permissionTarget, setPermissionTarget] = useState<RosterEntry | null>(null);
  const [permissionTime, setPermissionTime] = useState("");
  const [permissionReason, setPermissionReason] = useState("");
  const [isGrantingPermission, setIsGrantingPermission] = useState(false);

  const loadRoster = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/college/attendance/report?date=${date}`);
      const d = await res.json() as { roster: RosterEntry[]; error?: string };
      setRoster(d.roster ?? []);
    } catch {
      toast({ variant: "destructive", title: "Failed to load attendance report" });
    } finally {
      setIsLoading(false);
    }
  }, [date]);

  useEffect(() => {
    // Wrapped so setState calls aren't reachable synchronously from the
    // effect body (react-hooks/set-state-in-effect).
    void (async () => { await loadRoster(); })();
  }, [loadRoster]);

  function openMarkDialog(row: RosterEntry) {
    setMarkTarget(row);
    setManualCheckIn(row.checkIn ?? "");
    setManualCheckOut(row.checkOut ?? "");
    setManualReason("");
  }

  async function handleManualMark() {
    if (!markTarget) return;
    setIsMarking(true);
    try {
      const res = await fetch("/api/college/attendance/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          facultyId: markTarget.uid,
          date,
          checkIn: manualCheckIn || undefined,
          checkOut: manualCheckOut || undefined,
          reason: manualReason,
        }),
      });
      const json = await res.json() as { error?: string };
      if (!res.ok) {
        toast({ variant: "destructive", title: json.error ?? "Failed to mark attendance" });
        return;
      }
      toast({ title: `Attendance updated for ${markTarget.name}` });
      setMarkTarget(null);
      await loadRoster();
    } catch {
      toast({ variant: "destructive", title: "Failed to mark attendance" });
    } finally {
      setIsMarking(false);
    }
  }

  function openPermissionDialog(row: RosterEntry) {
    setPermissionTarget(row);
    setPermissionTime(row.permittedCheckInTime ?? "");
    setPermissionReason("");
  }

  async function handleGrantPermission() {
    if (!permissionTarget) return;
    setIsGrantingPermission(true);
    try {
      const res = await fetch("/api/college/attendance/check-in-permission", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          facultyId: permissionTarget.uid,
          date,
          permittedCheckInTime: permissionTime,
          reason: permissionReason,
        }),
      });
      const json = await res.json() as { error?: string };
      if (!res.ok) {
        toast({ variant: "destructive", title: json.error ?? "Failed to grant permission" });
        return;
      }
      toast({ title: `Check-in permission granted for ${permissionTarget.name}`, description: `${date} is excused - won't count as late no matter when they check in.` });
      setPermissionTarget(null);
      await loadRoster();
    } catch {
      toast({ variant: "destructive", title: "Failed to grant permission" });
    } finally {
      setIsGrantingPermission(false);
    }
  }

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
        // Same collapse the Dean's subject picker applies: the courses API also
        // returns a feeder's courses (a department cross-listing this one via
        // secondaryDepartments), so one catalog course the Principal added once
        // would otherwise appear twice here, once per owning department. Keep
        // this department's own doc when both exist.
        const active = (d.courses ?? []).filter((c) => c.isActive);
        const byCatalogCourse = new Map<string, Course>();
        for (const c of active) {
          const key = c.catalogId ?? `name:${c.name.trim().toLowerCase()}`;
          const kept = byCatalogCourse.get(key);
          if (!kept || (c.departmentId === selectedDepartmentId && kept.departmentId !== selectedDepartmentId)) {
            byCatalogCourse.set(key, c);
          }
        }
        setCourses(Array.from(byCatalogCourse.values()).sort((a, b) => a.name.localeCompare(b.name)));
      } catch {
        toast({ variant: "destructive", title: "Failed to load courses" });
      } finally {
        setIsLoadingCourses(false);
      }
    })();
  }, [groupByDepartmentAndCourse, selectedDepartmentId]);

  const presentCount = roster.filter((r) => r.status === "PRESENT").length;
  // Editing (not viewing) is only allowed for the current month, up to the
  // 25th - see isManualEditWindowOpen. "This Month"/viewing stays available
  // regardless; only the "Mark" action is gated by this.
  const canEditSelectedDate = isManualEditWindowOpen(new Date(`${date}T00:00:00`));
  // Permission is the opposite direction from Mark - a forward-looking
  // exception granted BEFORE the person checks in themselves, not a
  // correction of an already-passed day - so it's gated by "today or later"
  // (matching check-in-permission/route.ts's own rule) instead of Mark's
  // current-month/25th-cutoff window, which would wrongly block granting one
  // for today once the month passes the 25th.
  const canGrantPermission = date >= todayISO();

  const columns: Column<RosterEntry>[] = [
    { key: "name", header: "Faculty" },
    { key: "department", header: "Department", hideOnMobile: true },
    { key: "status", header: "Status", render: (row) => <StatusCell row={row} /> },
    { key: "checkIn", header: "Check In", render: (row) => <CheckInCell row={row} /> },
    { key: "checkOut", header: "Check Out", render: (row) => <CheckOutCell row={row} /> },
    { key: "remarks", header: "Reason", render: (row) => <ReasonCell row={row} /> },
    ...(allowManualMark || monthlyViewBasePath
      ? [{
          key: "actions",
          header: "",
          render: (row: RosterEntry) =>
            row.role === "PANEL_MEMBER" || row.role === "COLLEGE_STAFF" ? (
              <div className="flex items-center gap-2">
                {monthlyViewBasePath && (
                  <Button variant="outline" size="sm" asChild>
                    <Link href={`${monthlyViewBasePath}/${row.uid}`}>
                      <CalendarDays className="h-3.5 w-3.5 mr-1" /> This Month
                    </Link>
                  </Button>
                )}
                {allowManualMark && canEditSelectedDate && (
                  <Button variant="outline" size="sm" onClick={() => openMarkDialog(row)}>
                    <Pencil className="h-3.5 w-3.5 mr-1" /> Mark
                  </Button>
                )}
                {/* Faculty (teaching or technical) only - COLLEGE_STAFF has no
                    late-check-in penalty to excuse in the first place. */}
                {allowManualMark && canGrantPermission && row.role === "PANEL_MEMBER" && (
                  // Once granted for this person on this date, the day is
                  // already excused - there's nothing further to decide, so
                  // the action is replaced by what was granted rather than
                  // reopening a dialog that would just re-submit the same
                  // thing. permittedCheckInTime is set by the grant and comes
                  // back on the reloaded roster.
                  row.permittedCheckInTime ? (
                    <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
                      <Clock3 className="h-3.5 w-3.5" /> Permitted {row.permittedCheckInTime}
                    </span>
                  ) : (
                    <Button variant="outline" size="sm" onClick={() => openPermissionDialog(row)}>
                      <Clock3 className="h-3.5 w-3.5 mr-1" /> Permission
                    </Button>
                  )
                )}
              </div>
            ) : null,
        } satisfies Column<RosterEntry>]
      : []),
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

  async function handleExportMonth(scope: "department" | "college") {
    const [y, m] = exportMonth.split("-").map(Number);
    if (!y || !m) {
      toast({ variant: "destructive", title: "Select a month first" });
      return;
    }
    const params = new URLSearchParams({ scope, year: String(y), month: String(m) });
    if (scope === "department" && selectedDepartment) params.set("department", selectedDepartment.name);
    setExportingScope(scope);
    try {
      const res = await fetch(`/api/college/attendance/monthly-export?${params.toString()}`);
      const d = await res.json() as { rows?: MonthlySummaryRow[]; department?: string; error?: string };
      if (!res.ok) {
        toast({ variant: "destructive", title: d.error ?? "Failed to export" });
        return;
      }
      if (!d.rows || d.rows.length === 0) {
        toast({ title: "Nothing to export for that month" });
        return;
      }
      const label = scope === "college" ? "college" : (d.department || selectedDepartment?.name || "department");
      exportRosterMonthlyCSV(d.rows, `attendance-${label}-${exportMonth}`);
    } catch {
      toast({ variant: "destructive", title: "Failed to export" });
    } finally {
      setExportingScope(null);
    }
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

      {allowManualMark && !canEditSelectedDate && (
        <p className="text-xs text-muted-foreground">{MANUAL_EDIT_WINDOW_CLOSED_MESSAGE}</p>
      )}

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

          <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-muted/20 p-3">
            <div className="space-y-2">
              <Label htmlFor="export-month">Export month</Label>
              <Input
                id="export-month"
                type="month"
                value={exportMonth}
                onChange={(e) => setExportMonth(e.target.value)}
                className="w-40"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={!selectedDepartment || exportingScope !== null}
              onClick={() => void handleExportMonth("department")}
            >
              <Download className="h-4 w-4 mr-1" />
              {exportingScope === "department" ? "Exporting…" : "Export Department (Month)"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={exportingScope !== null}
              onClick={() => void handleExportMonth("college")}
            >
              <Download className="h-4 w-4 mr-1" />
              {exportingScope === "college" ? "Exporting…" : "Export College (Month)"}
            </Button>
            {importHref && (
              <Button variant="outline" size="sm" asChild>
                <Link href={importHref}>
                  <Upload className="h-4 w-4 mr-1" />
                  Import CSV
                </Link>
              </Button>
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
                      <RosterTable rows={[searchedHod]} onMark={allowManualMark && canEditSelectedDate ? openMarkDialog : undefined} monthlyViewBasePath={monthlyViewBasePath} />
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
        <div className="space-y-4">
          <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-muted/20 p-3">
            <div className="space-y-2">
              <Label htmlFor="export-month">Export month</Label>
              <Input
                id="export-month"
                type="month"
                value={exportMonth}
                onChange={(e) => setExportMonth(e.target.value)}
                className="w-40"
              />
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={exportingScope !== null}
              onClick={() => void handleExportMonth("department")}
            >
              <Download className="h-4 w-4 mr-1" />
              {exportingScope === "department" ? "Exporting…" : "Export Department (Month)"}
            </Button>
            {importHref && (
              <Button variant="outline" size="sm" asChild>
                <Link href={importHref}>
                  <Upload className="h-4 w-4 mr-1" />
                  Import CSV
                </Link>
              </Button>
            )}
          </div>
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
        </div>
      )}

      {allowManualMark && (() => {
        const checkOutNotAfterCheckIn = !!manualCheckIn && !!manualCheckOut && manualCheckOut <= manualCheckIn;
        return (
          <ConfirmDialog
            open={!!markTarget}
            onOpenChange={(open) => { if (!open) setMarkTarget(null); }}
            title={`Mark attendance for ${markTarget?.name ?? "faculty"}?`}
            description={`For ${date}. Use this when they can't complete self check-in/out themselves (e.g. they left campus for official work). This is recorded as a manual entry, distinct from a real face+location check-in.`}
            confirmLabel="Save"
            loading={isMarking}
            confirmDisabled={!manualReason.trim() || (!manualCheckIn && !manualCheckOut) || checkOutNotAfterCheckIn}
            onConfirm={() => void handleManualMark()}
          >
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="manual-checkin">Check In</Label>
                  <Input id="manual-checkin" type="time" value={manualCheckIn} onChange={(e) => setManualCheckIn(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="manual-checkout">Check Out</Label>
                  <Input id="manual-checkout" type="time" value={manualCheckOut} onChange={(e) => setManualCheckOut(e.target.value)} />
                </div>
              </div>
              {checkOutNotAfterCheckIn && (
                <p className="text-xs text-destructive">Check-out must be after check-in.</p>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="manual-reason">Reason (required)</Label>
                <Textarea
                  id="manual-reason"
                  value={manualReason}
                  onChange={(e) => setManualReason(e.target.value)}
                  rows={3}
                  placeholder="Why are you marking this manually? e.g. Left campus at 2pm for an official site visit."
                />
              </div>
            </div>
          </ConfirmDialog>
        );
      })()}

      {allowManualMark && (
        <ConfirmDialog
          open={!!permissionTarget}
          onOpenChange={(open) => { if (!open) setPermissionTarget(null); }}
          title={`Grant check-in permission to ${permissionTarget?.name ?? "faculty"}?`}
          description={`For ${date}. This whole day is excused - however late they actually check in, it won't count as Late (or toward the 3-late -> 0.5 Casual Leave deduction). They still check in themselves as normal; the time below is just a record of what was agreed.`}
          confirmLabel="Grant"
          loading={isGrantingPermission}
          confirmDisabled={!permissionReason.trim() || !permissionTime}
          onConfirm={() => void handleGrantPermission()}
        >
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="permission-time">Permitted check-in time</Label>
              <Input id="permission-time" type="time" value={permissionTime} onChange={(e) => setPermissionTime(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="permission-reason">Reason (required)</Label>
              <Textarea
                id="permission-reason"
                value={permissionReason}
                onChange={(e) => setPermissionReason(e.target.value)}
                rows={3}
                placeholder="Why are you granting this? e.g. Attending a family function in the morning."
              />
            </div>
          </div>
        </ConfirmDialog>
      )}
    </div>
  );
}
