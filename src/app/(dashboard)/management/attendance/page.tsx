"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ShieldCheck, CalendarDays, Download } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/shared/EmptyState";
import { isLateCheckIn } from "@/lib/attendance/lateStatus";
import { toDate, exportRosterMonthlyCSV } from "@/lib/utils";
import { toast } from "@/hooks/useToast";
import { ATTENDANCE_STATUS_LABELS } from "@/types";
import type { Location, College, Department, Course, AttendanceStatus, AttendanceRecord, MonthlyExportRow } from "@/types";

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
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

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function currentMonthValue(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

interface Row {
  uid: string;
  name: string;
  status: string;
  checkIn: string | null;
  checkOut: string | null;
  checkInVerified?: boolean;
  checkOutVerified?: boolean;
  // The reason an HOD/Principal/VP wrote when manually marking/correcting
  // this record, or the auto-generated explanation for a derived Absent day.
  remarks?: string | null;
}

interface DeptRosterEntry extends Row {
  role: "PANEL_MEMBER" | "HOD";
  courseIds?: string[];
}

// monthlyViewHref is used verbatim (for single-row tables where every row is
// the same person, e.g. Principal/VP - the college-scoped monthly page
// doesn't need a uid). monthlyViewBasePath instead appends `/${row.uid}`
// (for multi-row tables, e.g. HOD/Faculty). At most one is passed per call.
function RosterTable({ rows, monthlyViewHref, monthlyViewBasePath }: { rows: Row[]; monthlyViewHref?: string; monthlyViewBasePath?: string }) {
  const showActions = !!monthlyViewHref || !!monthlyViewBasePath;
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
            {rows.map((row) => {
              const href = monthlyViewHref ?? (monthlyViewBasePath ? `${monthlyViewBasePath}/${row.uid}` : undefined);
              return (
              <tr key={row.uid} className="bg-background">
                <td className="px-4 py-3 whitespace-nowrap">{row.name}</td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <span className="inline-flex items-center gap-1.5">
                    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${statusBadgeClass(row.status)}`}>
                      {statusLabel(row.status)}
                    </span>
                    {row.status === "PRESENT" && isLateCheckIn(row.checkIn) && (
                      <span className="inline-flex items-center rounded-full border border-red-200 bg-red-100 px-2.5 py-0.5 text-xs font-semibold text-red-800">
                        Late
                      </span>
                    )}
                  </span>
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  {row.checkIn ? (
                    <span className="inline-flex items-center gap-1">
                      {row.checkIn}
                      {row.checkInVerified && <ShieldCheck className="h-3.5 w-3.5 text-green-600" aria-label="Face + location verified" />}
                    </span>
                  ) : "—"}
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  {row.checkOut ? (
                    <span className="inline-flex items-center gap-1">
                      {row.checkOut}
                      {row.checkOutVerified && <ShieldCheck className="h-3.5 w-3.5 text-green-600" aria-label="Face + location verified" />}
                    </span>
                  ) : "—"}
                </td>
                <td className="px-4 py-3 max-w-xs">
                  {row.remarks ? <span className="text-xs text-muted-foreground italic">{row.remarks}</span> : "—"}
                </td>
                {showActions && (
                  <td className="px-4 py-3 whitespace-nowrap">
                    {href && (
                      <Button variant="outline" size="sm" asChild>
                        <Link href={href}>
                          <CalendarDays className="h-3.5 w-3.5 mr-1" /> This Month
                        </Link>
                      </Button>
                    )}
                  </td>
                )}
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Location -> College -> Principal + Vice Principal -> Department -> Course
// -> HOD -> Faculty, each level appearing only once its parent is picked,
// and each fetch scoped by the previous selection - so only records
// belonging to the selected hierarchy are ever shown. Every attendance
// value (status, check-in/out, verified badge, the red Late badge) comes
// from the exact same attendanceRecords data and isLateCheckIn 9:05 rule
// the Faculty/HOD/Principal/VP's own attendance pages use - this page only
// adds read-only, cross-college navigation on top, never a second
// attendance mechanism.
export default function ManagementAttendancePage() {
  const [date, setDate] = useState(todayISO());

  const [locations, setLocations] = useState<Location[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState("");

  const [colleges, setColleges] = useState<College[]>([]);
  const [selectedCollegeId, setSelectedCollegeId] = useState("");

  const [principal, setPrincipal] = useState<{ uid: string; name: string } | null>(null);
  const [isLoadingPrincipal, setIsLoadingPrincipal] = useState(false);
  const [selectedPrincipalUid, setSelectedPrincipalUid] = useState("");
  const [principalRow, setPrincipalRow] = useState<Row | null>(null);

  // Vice Principal is shown alongside Principal, driven by the same College
  // selection - it never gates Department/Course below (only Principal does)
  // so no separate select control is needed, just a fetch-and-display row.
  const [vicePrincipal, setVicePrincipal] = useState<{ uid: string; name: string } | null>(null);
  const [isLoadingVicePrincipal, setIsLoadingVicePrincipal] = useState(false);
  const [vicePrincipalRow, setVicePrincipalRow] = useState<Row | null>(null);

  const [departments, setDepartments] = useState<Department[]>([]);
  const [selectedDepartmentId, setSelectedDepartmentId] = useState("");

  const [courses, setCourses] = useState<Course[]>([]);
  const [selectedCourseId, setSelectedCourseId] = useState("");

  const [deptRoster, setDeptRoster] = useState<DeptRosterEntry[]>([]);
  const [isLoadingDeptRoster, setIsLoadingDeptRoster] = useState(false);

  // Department-wide / college-wide monthly CSV export (every day of the
  // selected month, every person in scope) - distinct from the per-date
  // roster views above.
  const [exportMonth, setExportMonth] = useState(currentMonthValue());
  const [exportingScope, setExportingScope] = useState<"department" | "college" | null>(null);

  useEffect(() => {
    fetch("/api/admin/locations")
      .then((r) => r.json() as Promise<{ locations: Location[] }>)
      .then((d) => setLocations((d.locations ?? []).filter((l) => l.isActive).sort((a, b) => a.name.localeCompare(b.name))))
      .catch(() => { /* non-critical - the Location select will just stay empty */ });
  }, []);

  useEffect(() => {
    fetch("/api/management/colleges")
      .then((r) => r.json() as Promise<{ colleges: College[] }>)
      .then((d) => setColleges((d.colleges ?? []).filter((c) => c.isActive)))
      .catch(() => { /* non-critical - the College select will just stay empty */ });
  }, []);

  function resetBelowLocation() {
    setSelectedCollegeId("");
    setPrincipal(null);
    setSelectedPrincipalUid("");
    setPrincipalRow(null);
    setVicePrincipal(null);
    setVicePrincipalRow(null);
    setDepartments([]);
    setSelectedDepartmentId("");
    setCourses([]);
    setSelectedCourseId("");
    setDeptRoster([]);
  }

  function resetBelowCollege() {
    setPrincipal(null);
    setSelectedPrincipalUid("");
    setPrincipalRow(null);
    setVicePrincipal(null);
    setVicePrincipalRow(null);
    setDepartments([]);
    setSelectedDepartmentId("");
    setCourses([]);
    setSelectedCourseId("");
    setDeptRoster([]);
  }

  function resetBelowDepartment() {
    setCourses([]);
    setSelectedCourseId("");
    setDeptRoster([]);
  }

  const collegesForLocation = colleges.filter((c) => c.locationId === selectedLocationId);

  // Principal + Vice Principal + department list, once a College is selected.
  // Guarded against races: switching colleges again before an in-flight
  // fetch for the *previous* college resolves must not let that stale
  // response overwrite the newly-selected college's data (e.g. a slow
  // response for College A landing after College B has already been picked
  // would otherwise show College A's Vice Principal under College B).
  useEffect(() => {
    let cancelled = false;
    // Wrapped in an async IIFE so every setState call below is reachable
    // only from a callback, never synchronously from the effect body
    // (react-hooks/set-state-in-effect) - same convention used throughout
    // this codebase's other attendance pages.
    void (async () => {
      if (!selectedCollegeId) return;
      const collegeId = selectedCollegeId;

      setIsLoadingPrincipal(true);
      fetch(`/api/management/colleges/${collegeId}/staff?role=PRINCIPAL`)
        .then((r) => r.json() as Promise<{ profile: { uid?: string; name?: string } | null }>)
        .then((d) => {
          if (cancelled) return;
          const p = d.profile?.uid ? { uid: d.profile.uid, name: d.profile.name ?? "" } : null;
          setPrincipal(p);
          setSelectedPrincipalUid(p ? p.uid : "");
        })
        .catch(() => { if (!cancelled) setPrincipal(null); })
        .finally(() => { if (!cancelled) setIsLoadingPrincipal(false); });

      setIsLoadingVicePrincipal(true);
      fetch(`/api/management/colleges/${collegeId}/staff?role=VICE_PRINCIPAL`)
        .then((r) => r.json() as Promise<{ profile: { uid?: string; name?: string } | null }>)
        .then((d) => { if (!cancelled) setVicePrincipal(d.profile?.uid ? { uid: d.profile.uid, name: d.profile.name ?? "" } : null); })
        .catch(() => { if (!cancelled) setVicePrincipal(null); })
        .finally(() => { if (!cancelled) setIsLoadingVicePrincipal(false); });

      fetch(`/api/management/colleges/${collegeId}/departments`)
        .then((r) => r.json() as Promise<{ departments: Department[] }>)
        .then((d) => { if (!cancelled) setDepartments((d.departments ?? []).filter((dep) => dep.isActive)); })
        .catch(() => { /* non-critical - the Department select will just stay empty */ });
    })();
    // Marks any in-flight fetch above as stale the moment the college
    // selection changes again, so a slow response for the *previous*
    // college can never overwrite the newly-selected college's data (e.g. a
    // slow response for College A landing after College B has already been
    // picked would otherwise show College A's Vice Principal under College B).
    return () => { cancelled = true; };
  }, [selectedCollegeId]);

  // Principal's own attendance for the selected date. Same race guard as
  // the effect above.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!selectedCollegeId || !selectedPrincipalUid || !principal) { setPrincipalRow(null); return; }
      const [y, m] = date.split("-").map(Number);
      fetch(`/api/management/colleges/${selectedCollegeId}/principal-attendance?year=${y}&month=${m}`)
        .then((r) => r.json() as Promise<{ records: (AttendanceRecord & { id: string })[]; registered?: boolean }>)
        .then((d) => {
          if (cancelled) return;
          const rec = (d.records ?? []).find((r) => {
            const rd = toDate(r.date);
            return rd ? dateKey(rd) === date : false;
          });
          setPrincipalRow({
            uid: principal.uid,
            name: principal.name,
            status: rec?.status ?? (d.registered ? "NOT_MARKED" : "NOT_REGISTERED"),
            checkIn: rec?.checkIn ?? null,
            checkOut: rec?.checkOut ?? null,
            checkInVerified: rec?.checkInVerified,
            checkOutVerified: rec?.checkOutVerified,
            remarks: rec?.remarks ?? null,
          });
        })
        .catch(() => { if (!cancelled) setPrincipalRow(null); });
    })();
    return () => { cancelled = true; };
  }, [selectedCollegeId, selectedPrincipalUid, principal, date]);

  // Vice Principal's own attendance for the selected date. Same race guard.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!selectedCollegeId || !vicePrincipal) { setVicePrincipalRow(null); return; }
      const [y, m] = date.split("-").map(Number);
      fetch(`/api/management/colleges/${selectedCollegeId}/vice-principal-attendance?year=${y}&month=${m}`)
        .then((r) => r.json() as Promise<{ records: (AttendanceRecord & { id: string })[]; registered?: boolean }>)
        .then((d) => {
          if (cancelled) return;
          const rec = (d.records ?? []).find((r) => {
            const rd = toDate(r.date);
            return rd ? dateKey(rd) === date : false;
          });
          setVicePrincipalRow({
            uid: vicePrincipal.uid,
            name: vicePrincipal.name,
            status: rec?.status ?? (d.registered ? "NOT_MARKED" : "NOT_REGISTERED"),
            checkIn: rec?.checkIn ?? null,
            checkOut: rec?.checkOut ?? null,
            checkInVerified: rec?.checkInVerified,
            checkOutVerified: rec?.checkOutVerified,
            remarks: rec?.remarks ?? null,
          });
        })
        .catch(() => { if (!cancelled) setVicePrincipalRow(null); });
    })();
    return () => { cancelled = true; };
  }, [selectedCollegeId, vicePrincipal, date]);

  const selectedDepartment = departments.find((d) => d.id === selectedDepartmentId) ?? null;
  const selectedDepartmentName = selectedDepartment?.name ?? "";

  async function handleExportMonth(scope: "department" | "college") {
    if (!selectedCollegeId) return;
    const [y, m] = exportMonth.split("-").map(Number);
    if (!y || !m) {
      toast({ variant: "destructive", title: "Select a month first" });
      return;
    }
    const params = new URLSearchParams({ scope, year: String(y), month: String(m) });
    if (scope === "department") {
      if (!selectedDepartmentName) return;
      params.set("department", selectedDepartmentName);
    }
    setExportingScope(scope);
    try {
      const res = await fetch(`/api/management/colleges/${selectedCollegeId}/monthly-export?${params.toString()}`);
      const d = await res.json() as { rows?: MonthlyExportRow[]; department?: string; error?: string };
      if (!res.ok) {
        toast({ variant: "destructive", title: d.error ?? "Failed to export" });
        return;
      }
      if (!d.rows || d.rows.length === 0) {
        toast({ title: "Nothing to export for that month" });
        return;
      }
      const collegeName = colleges.find((c) => c.id === selectedCollegeId)?.name ?? "college";
      const label = scope === "college" ? collegeName : (d.department || selectedDepartmentName);
      exportRosterMonthlyCSV(d.rows, `attendance-${label}-${exportMonth}`);
    } catch {
      toast({ variant: "destructive", title: "Failed to export" });
    } finally {
      setExportingScope(null);
    }
  }

  // Courses, once a Department is selected. Same race guard.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!selectedCollegeId || !selectedDepartmentId) { setCourses([]); return; }
      fetch(`/api/management/colleges/${selectedCollegeId}/courses?departmentId=${selectedDepartmentId}`)
        .then((r) => r.json() as Promise<{ courses: Course[] }>)
        .then((d) => { if (!cancelled) setCourses((d.courses ?? []).filter((c) => c.isActive).sort((a, b) => a.name.localeCompare(b.name))); })
        .catch(() => { /* non-critical - the Course select will just stay empty */ });
    })();
    return () => { cancelled = true; };
  }, [selectedCollegeId, selectedDepartmentId]);

  // HOD + Faculty roster for the selected department, on the selected date.
  // Same race guard - a stale roster for a previously selected department/
  // date must not overwrite a newer selection.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (!selectedCollegeId || !selectedDepartmentName) { setDeptRoster([]); return; }
      setIsLoadingDeptRoster(true);
      fetch(`/api/management/colleges/${selectedCollegeId}/department-attendance?department=${encodeURIComponent(selectedDepartmentName)}&date=${date}`)
        .then((r) => r.json() as Promise<{ roster: DeptRosterEntry[] }>)
        .then((d) => { if (!cancelled) setDeptRoster(d.roster ?? []); })
        .catch(() => { if (!cancelled) setDeptRoster([]); })
        .finally(() => { if (!cancelled) setIsLoadingDeptRoster(false); });
    })();
    return () => { cancelled = true; };
  }, [selectedCollegeId, selectedDepartmentName, date]);

  const selectedCourse = courses.find((c) => c.id === selectedCourseId) ?? null;
  const hodRow = deptRoster.find((r) => r.role === "HOD") ?? null;
  const facultyRows = selectedCourse
    ? deptRoster.filter((r) => r.role !== "HOD" && ((r.courseIds ?? []).length === 0 || (r.courseIds ?? []).includes(selectedCourse.id)))
    : [];

  return (
    <div className="space-y-6">
      <PageHeader title="Attendance" description="Location → College → Principal/Vice Principal → Department → Course → HOD → Faculty" />

      <Card>
        <CardContent className="p-5 space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-2">
              <Label htmlFor="mgmt-date">Date</Label>
              <Input id="mgmt-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-44" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="mgmt-location">Location</Label>
              <Select value={selectedLocationId} onValueChange={(v) => { setSelectedLocationId(v); resetBelowLocation(); }}>
                <SelectTrigger id="mgmt-location" className="w-56">
                  <SelectValue placeholder="Select Location" />
                </SelectTrigger>
                <SelectContent>
                  {locations.map((l) => (
                    <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedLocationId && (
              <div className="space-y-2">
                <Label htmlFor="mgmt-college">College</Label>
                <Select value={selectedCollegeId} onValueChange={(v) => { setSelectedCollegeId(v); resetBelowCollege(); }}>
                  <SelectTrigger id="mgmt-college" className="w-64">
                    <SelectValue placeholder="Select College" />
                  </SelectTrigger>
                  <SelectContent>
                    {collegesForLocation.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {selectedCollegeId && (
              <div className="space-y-2">
                <Label htmlFor="mgmt-principal">Principal</Label>
                <Select
                  value={selectedPrincipalUid}
                  onValueChange={setSelectedPrincipalUid}
                  disabled={isLoadingPrincipal || !principal}
                >
                  <SelectTrigger id="mgmt-principal" className="w-56">
                    <SelectValue placeholder={isLoadingPrincipal ? "Loading…" : principal ? "Select Principal" : "No Principal assigned"} />
                  </SelectTrigger>
                  <SelectContent>
                    {principal && <SelectItem value={principal.uid}>{principal.name}</SelectItem>}
                  </SelectContent>
                </Select>
              </div>
            )}

            {selectedPrincipalUid && (
              <div className="space-y-2">
                <Label htmlFor="mgmt-department">Department</Label>
                <Select value={selectedDepartmentId} onValueChange={(v) => { setSelectedDepartmentId(v); resetBelowDepartment(); }}>
                  <SelectTrigger id="mgmt-department" className="w-56">
                    <SelectValue placeholder="Select Department" />
                  </SelectTrigger>
                  <SelectContent>
                    {departments.map((d) => (
                      <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {selectedDepartmentId && (
              <div className="space-y-2">
                <Label htmlFor="mgmt-course">Course</Label>
                <Select value={selectedCourseId} onValueChange={setSelectedCourseId}>
                  <SelectTrigger id="mgmt-course" className="w-56">
                    <SelectValue placeholder="Select Course" />
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
        </CardContent>
      </Card>

      {!selectedLocationId ? (
        <EmptyState title="Select a location to begin" />
      ) : !selectedCollegeId ? (
        <EmptyState title="Select a college" />
      ) : (
        <div className="space-y-6">
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
              disabled={!selectedDepartmentName || exportingScope !== null}
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
          </div>

          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Principal</h3>
            {principalRow ? (
              <RosterTable rows={[principalRow]} monthlyViewHref={`/management/faculty/${selectedCollegeId}/principal/attendance`} />
            ) : (
              <p className="text-sm text-muted-foreground">
                {isLoadingPrincipal ? "Loading…" : "No Principal assigned to this college."}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Vice Principal</h3>
            {vicePrincipalRow ? (
              <RosterTable rows={[vicePrincipalRow]} monthlyViewHref={`/management/faculty/${selectedCollegeId}/vice-principal/attendance`} />
            ) : (
              <p className="text-sm text-muted-foreground">
                {isLoadingVicePrincipal ? "Loading…" : "No Vice Principal assigned to this college."}
              </p>
            )}
          </div>

          {selectedDepartmentId && !selectedCourse ? (
            <EmptyState title="Select a course to view its HOD and faculty" />
          ) : selectedCourse ? (
            isLoadingDeptRoster ? (
              <div className="h-48 rounded-lg border bg-muted/30 animate-pulse" />
            ) : (
              <>
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">HOD</h3>
                  {hodRow ? (
                    <RosterTable rows={[hodRow]} monthlyViewBasePath={`/management/faculty-attendance/${selectedCollegeId}`} />
                  ) : (
                    <p className="text-sm text-muted-foreground">No HOD assigned for this department.</p>
                  )}
                </div>

                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Faculty · {facultyRows.length}
                  </h3>
                  {facultyRows.length > 0 ? (
                    <RosterTable rows={facultyRows} monthlyViewBasePath={`/management/faculty-attendance/${selectedCollegeId}`} />
                  ) : (
                    <EmptyState title="No faculty found" />
                  )}
                </div>
              </>
            )
          ) : null}
        </div>
      )}
    </div>
  );
}
