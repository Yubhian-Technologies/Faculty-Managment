"use client";

import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/shared/EmptyState";
import { isLateCheckIn } from "@/lib/attendance/lateStatus";
import { ATTENDANCE_STATUS_LABELS } from "@/types";
import type { Location, College, Department, Course, AttendanceStatus, AttendanceRecord } from "@/types";

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

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

interface Row {
  uid: string;
  name: string;
  status: string;
  checkIn: string | null;
  checkOut: string | null;
  checkInVerified?: boolean;
  checkOutVerified?: boolean;
}

interface DeptRosterEntry extends Row {
  role: "PANEL_MEMBER" | "HOD";
  courseIds?: string[];
}

function RosterTable({ rows }: { rows: Row[] }) {
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
                <td className="px-4 py-3 whitespace-nowrap">
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
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Location -> College -> Principal -> Department -> Course -> HOD -> Faculty,
// each level appearing only once its parent is picked, and each fetch scoped
// by the previous selection - so only records belonging to the selected
// hierarchy are ever shown. Every attendance value (status, check-in/out,
// verified badge, the red Late badge) comes from the exact same
// attendanceRecords data and isLateCheckIn 9:15 rule the Faculty/HOD/
// Principal's own attendance pages use - this page only adds read-only,
// cross-college navigation on top, never a second attendance mechanism.
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

  const [departments, setDepartments] = useState<Department[]>([]);
  const [selectedDepartmentId, setSelectedDepartmentId] = useState("");

  const [courses, setCourses] = useState<Course[]>([]);
  const [selectedCourseId, setSelectedCourseId] = useState("");

  const [deptRoster, setDeptRoster] = useState<DeptRosterEntry[]>([]);
  const [isLoadingDeptRoster, setIsLoadingDeptRoster] = useState(false);

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

  // Principal + department list, once a College is selected.
  useEffect(() => {
    void (async () => {
      if (!selectedCollegeId) return;
      setIsLoadingPrincipal(true);
      fetch(`/api/management/colleges/${selectedCollegeId}/staff?role=PRINCIPAL`)
        .then((r) => r.json() as Promise<{ profile: { uid?: string; name?: string } | null }>)
        .then((d) => {
          const p = d.profile?.uid ? { uid: d.profile.uid, name: d.profile.name ?? "" } : null;
          setPrincipal(p);
          setSelectedPrincipalUid(p ? p.uid : "");
        })
        .catch(() => setPrincipal(null))
        .finally(() => setIsLoadingPrincipal(false));

      fetch(`/api/management/colleges/${selectedCollegeId}/departments`)
        .then((r) => r.json() as Promise<{ departments: Department[] }>)
        .then((d) => setDepartments((d.departments ?? []).filter((dep) => dep.isActive)))
        .catch(() => { /* non-critical - the Department select will just stay empty */ });
    })();
  }, [selectedCollegeId]);

  // Principal's own attendance for the selected date.
  useEffect(() => {
    void (async () => {
      if (!selectedCollegeId || !selectedPrincipalUid || !principal) { setPrincipalRow(null); return; }
      const [y, m] = date.split("-").map(Number);
      fetch(`/api/management/colleges/${selectedCollegeId}/principal-attendance?year=${y}&month=${m}`)
        .then((r) => r.json() as Promise<{ records: (AttendanceRecord & { id: string })[] }>)
        .then((d) => {
          const rec = (d.records ?? []).find((r) => {
            const raw = r.date as unknown as { toDate?: () => Date; seconds?: number; _seconds?: number } | null;
            const rd = raw
              ? typeof raw.toDate === "function" ? raw.toDate() : new Date(((raw._seconds ?? raw.seconds) ?? 0) * 1000)
              : null;
            return rd ? dateKey(rd) === date : false;
          });
          setPrincipalRow({
            uid: principal.uid,
            name: principal.name,
            status: rec?.status ?? "NOT_MARKED",
            checkIn: rec?.checkIn ?? null,
            checkOut: rec?.checkOut ?? null,
            checkInVerified: rec?.checkInVerified,
            checkOutVerified: rec?.checkOutVerified,
          });
        })
        .catch(() => setPrincipalRow(null));
    })();
  }, [selectedCollegeId, selectedPrincipalUid, principal, date]);

  const selectedDepartment = departments.find((d) => d.id === selectedDepartmentId) ?? null;
  const selectedDepartmentName = selectedDepartment?.name ?? "";

  // Courses, once a Department is selected.
  useEffect(() => {
    void (async () => {
      if (!selectedCollegeId || !selectedDepartmentId) { setCourses([]); return; }
      fetch(`/api/management/colleges/${selectedCollegeId}/courses?departmentId=${selectedDepartmentId}`)
        .then((r) => r.json() as Promise<{ courses: Course[] }>)
        .then((d) => setCourses((d.courses ?? []).filter((c) => c.isActive).sort((a, b) => a.name.localeCompare(b.name))))
        .catch(() => { /* non-critical - the Course select will just stay empty */ });
    })();
  }, [selectedCollegeId, selectedDepartmentId]);

  // HOD + Faculty roster for the selected department, on the selected date.
  useEffect(() => {
    void (async () => {
      if (!selectedCollegeId || !selectedDepartmentName) { setDeptRoster([]); return; }
      setIsLoadingDeptRoster(true);
      fetch(`/api/management/colleges/${selectedCollegeId}/department-attendance?department=${encodeURIComponent(selectedDepartmentName)}&date=${date}`)
        .then((r) => r.json() as Promise<{ roster: DeptRosterEntry[] }>)
        .then((d) => setDeptRoster(d.roster ?? []))
        .catch(() => setDeptRoster([]))
        .finally(() => setIsLoadingDeptRoster(false));
    })();
  }, [selectedCollegeId, selectedDepartmentName, date]);

  const selectedCourse = courses.find((c) => c.id === selectedCourseId) ?? null;
  const hodRow = deptRoster.find((r) => r.role === "HOD") ?? null;
  const facultyRows = selectedCourse
    ? deptRoster.filter((r) => r.role !== "HOD" && ((r.courseIds ?? []).length === 0 || (r.courseIds ?? []).includes(selectedCourse.id)))
    : [];

  return (
    <div className="space-y-6">
      <PageHeader title="Attendance" description="Location → College → Principal → Department → Course → HOD → Faculty" />

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
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Principal</h3>
            {principalRow ? (
              <RosterTable rows={[principalRow]} />
            ) : (
              <p className="text-sm text-muted-foreground">
                {isLoadingPrincipal ? "Loading…" : "No Principal assigned to this college."}
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
                    <RosterTable rows={[hodRow]} />
                  ) : (
                    <p className="text-sm text-muted-foreground">No HOD assigned for this department.</p>
                  )}
                </div>

                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Faculty · {facultyRows.length}
                  </h3>
                  {facultyRows.length > 0 ? (
                    <RosterTable rows={facultyRows} />
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
