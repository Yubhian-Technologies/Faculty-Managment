"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Building2,
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  Edit2,
  FileBarChart,
  Mail,
  Phone,
  Plus,
  RefreshCw,
  Search,
  Shield,
  User,
  Users,
  UsersRound,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Globe,
  Link2,
  Unlink,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import { istDateKey } from "@/lib/attendance/istTime";
import type {
  LocationDepartment,
  LocationStaffMember,
  LocationShift,
  LocationStaffAttendanceRecord,
} from "@/types/locationStaff";

type TabKey = "staff" | "shifts" | "attendance" | "reports";

interface DepartmentDetailResponse {
  department: LocationDepartment;
  headUser?: {
    id: string;
    name: string;
    email: string;
    phone?: string;
    role: string;
    locationDeptIds?: string[];
  } | null;
  otherManagedDepts?: Array<{ id: string; name: string }>;
  stats?: {
    staffCount: number;
    shiftCount: number;
  };
}

interface RosterItem {
  staff: LocationStaffMember;
  attendance: LocationStaffAttendanceRecord | null;
}

interface AttendanceSummary {
  total: number;
  marked: number;
  present: number;
  late?: number;
  absent: number;
  halfDay: number;
  onLeave: number;
  pending: number;
}

interface StaffReportRow {
  staffId: string;
  staffName: string;
  role: string;
  departmentName: string;
  shiftName: string;
  present: number;
  late: number;
  absent: number;
  halfDay: number;
  onLeave: number;
  marked: number;
  attendancePercent: number;
}

function firstOfMonth(): string {
  const today = istDateKey();
  const [y, m] = today.split("-");
  return `${y}-${m}-01`;
}

export default function DepartmentDetailPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const deptId = params.id;

  const initialTab = (searchParams.get("tab") as TabKey) || "staff";
  const [activeTab, setActiveTab] = useState<TabKey>(initialTab);

  // Department metadata
  const [deptData, setDeptData] = useState<DepartmentDetailResponse | null>(null);
  const [isLoadingDept, setIsLoadingDept] = useState(true);

  // Staff tab state
  const [staffList, setStaffList] = useState<LocationStaffMember[]>([]);
  const [isLoadingStaff, setIsLoadingStaff] = useState(false);
  const [staffSearch, setStaffSearch] = useState("");
  const [selectedStaffRole, setSelectedStaffRole] = useState("ALL");
  const [selectedStaffShift, setSelectedStaffShift] = useState("ALL");

  // Shifts tab state
  const [shifts, setShifts] = useState<LocationShift[]>([]);
  const [isLoadingShifts, setIsLoadingShifts] = useState(false);

  // Live Attendance tab state
  const [attendanceDate, setAttendanceDate] = useState<string>(() => istDateKey());
  const [attendanceShiftFilter, setAttendanceShiftFilter] = useState("ALL");
  const [roster, setRoster] = useState<RosterItem[]>([]);
  const [attendanceSummary, setAttendanceSummary] = useState<AttendanceSummary | null>(null);
  const [isLoadingAttendance, setIsLoadingAttendance] = useState(false);

  // Reports tab state
  const [reportFrom, setReportFrom] = useState(firstOfMonth);
  const [reportTo, setReportTo] = useState(istDateKey);
  const [reportShiftFilter, setReportShiftFilter] = useState("ALL");
  const [reportRows, setReportRows] = useState<StaffReportRow[]>([]);
  const [isLoadingReports, setIsLoadingReports] = useState(false);

  // 1. Fetch Department Details
  const fetchDeptDetails = useCallback(() => {
    if (!deptId) return;
    setIsLoadingDept(true);
    fetch(`/api/location/departments/${deptId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data: DepartmentDetailResponse) => {
        setDeptData(data);
      })
      .catch(() => {
        toast({ variant: "destructive", title: "Failed to load department details" });
      })
      .finally(() => setIsLoadingDept(false));
  }, [deptId]);

  useEffect(() => {
    fetchDeptDetails();
  }, [fetchDeptDetails]);

  // 2. Fetch Shifts for this Department
  const fetchShifts = useCallback(() => {
    if (!deptId) return;
    setIsLoadingShifts(true);
    fetch(`/api/location/shifts?departmentId=${deptId}`)
      .then((r) => (r.ok ? r.json() : Promise.resolve({ shifts: [] })))
      .then((data) => {
        setShifts(data.shifts ?? []);
      })
      .catch(() => {})
      .finally(() => setIsLoadingShifts(false));
  }, [deptId]);

  useEffect(() => {
    fetchShifts();
  }, [fetchShifts]);

  const [allCampusShifts, setAllCampusShifts] = useState<LocationShift[]>([]);
  const [isLinkShiftModalOpen, setIsLinkShiftModalOpen] = useState(false);
  const [isLinkingShift, setIsLinkingShift] = useState(false);

  const fetchCampusShifts = useCallback(() => {
    fetch("/api/location/shifts")
      .then((r) => (r.ok ? r.json() : Promise.resolve({ shifts: [] })))
      .then((d) => setAllCampusShifts(d.shifts ?? []))
      .catch(() => {});
  }, []);

  const availableShiftsToReuse = useMemo(() => {
    return allCampusShifts.filter((s) => {
      if (s.isCampusWide || s.departmentId === "ALL" || (Array.isArray(s.departmentIds) && s.departmentIds.includes("ALL"))) {
        return false;
      }
      if (s.departmentId === deptId || (Array.isArray(s.departmentIds) && s.departmentIds.includes(deptId))) {
        return false;
      }
      return true;
    });
  }, [allCampusShifts, deptId]);

  const handleLinkShift = async (shiftToLink: LocationShift) => {
    setIsLinkingShift(true);
    try {
      const res = await fetch(`/api/location/shifts/${shiftToLink.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ linkDepartmentId: deptId }),
      });
      if (!res.ok) throw new Error("Failed to link shift");
      toast({
        title: "Shift Linked Successfully",
        description: `${shiftToLink.name} is now available in this department.`,
      });
      fetchShifts();
      fetchCampusShifts();
      setIsLinkShiftModalOpen(false);
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Failed to link shift." });
    } finally {
      setIsLinkingShift(false);
    }
  };

  const handleUnlinkShift = async (shiftToUnlink: LocationShift) => {
    if (!confirm(`Unlink "${shiftToUnlink.name}" from this department? Staff assigned in other departments will not be affected.`)) {
      return;
    }
    try {
      const res = await fetch(`/api/location/shifts/${shiftToUnlink.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ unlinkDepartmentId: deptId }),
      });
      if (!res.ok) throw new Error("Failed to unlink shift");
      toast({
        title: "Shift Unlinked",
        description: `Removed ${shiftToUnlink.name} from this department.`,
      });
      fetchShifts();
      fetchCampusShifts();
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Failed to unlink shift." });
    }
  };

  // 3. Fetch Staff for this Department
  const fetchStaff = useCallback(() => {
    if (!deptId) return;
    setIsLoadingStaff(true);
    fetch(`/api/location/staff?departmentId=${deptId}&status=ALL`)
      .then((r) => (r.ok ? r.json() : Promise.resolve({ staff: [] })))
      .then((data) => {
        setStaffList(data.staff ?? []);
      })
      .catch(() => {})
      .finally(() => setIsLoadingStaff(false));
  }, [deptId]);

  useEffect(() => {
    fetchStaff();
  }, [fetchStaff]);

  // 4. Fetch Attendance for selected date
  const fetchAttendance = useCallback(() => {
    if (!deptId) return;
    setIsLoadingAttendance(true);
    const q = new URLSearchParams({
      date: attendanceDate,
      departmentId: deptId,
    });
    if (attendanceShiftFilter !== "ALL") {
      q.set("shiftId", attendanceShiftFilter);
    }

    fetch(`/api/location/staff-attendance?${q.toString()}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => {
        setRoster(data.roster ?? []);
        setAttendanceSummary(data.summary ?? null);
      })
      .catch(() => {
        toast({ variant: "destructive", title: "Failed to load attendance" });
      })
      .finally(() => setIsLoadingAttendance(false));
  }, [deptId, attendanceDate, attendanceShiftFilter]);

  useEffect(() => {
    if (activeTab === "attendance") {
      fetchAttendance();
    }
  }, [activeTab, fetchAttendance]);

  // 5. Fetch Attendance Reports
  const fetchReports = useCallback(() => {
    if (!deptId) return;
    setIsLoadingReports(true);
    const q = new URLSearchParams({
      from: reportFrom,
      to: reportTo,
      departmentId: deptId,
    });
    if (reportShiftFilter !== "ALL") {
      q.set("shiftId", reportShiftFilter);
    }

    fetch(`/api/location/staff-attendance/report?${q.toString()}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => {
        setReportRows(data.rows ?? []);
      })
      .catch(() => {
        toast({ variant: "destructive", title: "Failed to load attendance report" });
      })
      .finally(() => setIsLoadingReports(false));
  }, [deptId, reportFrom, reportTo, reportShiftFilter]);

  useEffect(() => {
    if (activeTab === "reports") {
      fetchReports();
    }
  }, [activeTab, fetchReports]);

  // Filter staff list
  const filteredStaff = useMemo(() => {
    const term = staffSearch.toLowerCase().trim();
    return staffList.filter((s) => {
      const matchSearch =
        !term ||
        s.name.toLowerCase().includes(term) ||
        s.fatherName?.toLowerCase().includes(term) ||
        s.role.toLowerCase().includes(term) ||
        s.contactNumber.includes(term) ||
        s.aadhaar.includes(term) ||
        s.payeeVoucher?.toLowerCase().includes(term);

      const matchRole = selectedStaffRole === "ALL" || s.role === selectedStaffRole;
      const matchShift = selectedStaffShift === "ALL" || s.shiftId === selectedStaffShift;

      return matchSearch && matchRole && matchShift;
    });
  }, [staffList, staffSearch, selectedStaffRole, selectedStaffShift]);

  // Unique roles for staff filter
  const distinctRoles = useMemo(() => {
    return Array.from(new Set(staffList.map((s) => s.role))).filter(Boolean);
  }, [staffList]);

  // Shift map for quick name lookup
  const shiftMap = useMemo(() => {
    const m = new Map<string, LocationShift>();
    for (const sh of shifts) m.set(sh.id, sh);
    return m;
  }, [shifts]);

  // CSV Export for Reports
  const handleDownloadCsv = () => {
    if (reportRows.length === 0) {
      toast({ variant: "destructive", title: "No data to export", description: "Select a range with attendance records." });
      return;
    }

    const deptName = deptData?.department.name || "Department";
    const headers = [
      "Staff Name",
      "Role",
      "Department",
      "Shift",
      "Present Days",
      "Late Days",
      "Absent Days",
      "Half Days",
      "Leave Days",
      "Total Marked Days",
      "Attendance %",
    ];

    const rows = reportRows.map((r) => [
      `"${r.staffName.replace(/"/g, '""')}"`,
      `"${r.role.replace(/"/g, '""')}"`,
      `"${(r.departmentName || deptName).replace(/"/g, '""')}"`,
      `"${(r.shiftName || "Unassigned").replace(/"/g, '""')}"`,
      r.present,
      r.late,
      r.absent,
      r.halfDay,
      r.onLeave,
      r.marked,
      `"${r.attendancePercent}%"`,
    ]);

    const csvContent = [headers.join(","), ...rows.map((row) => row.join(","))].join("\r\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const filename = `${deptName.replace(/[^a-zA-Z0-9_-]/g, "_")}_attendance_${reportFrom}_to_${reportTo}.csv`;
    link.setAttribute("href", url);
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    toast({
      title: "Report Downloaded",
      description: `Saved as ${filename}`,
    });
  };

  // Date shifting for attendance
  const shiftAttendanceDate = (days: number) => {
    const d = new Date(attendanceDate);
    d.setDate(d.getDate() + days);
    const formatted = d.toISOString().split("T")[0];
    setAttendanceDate(formatted);
  };

  const dept = deptData?.department;
  const head = deptData?.headUser;
  const otherDepts = deptData?.otherManagedDepts ?? [];

  return (
    <div className="space-y-4 max-w-6xl mx-auto pb-24 md:pb-8">
      {/* ── Top Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-card p-4 rounded-xl border">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="icon" className="h-9 w-9 shrink-0">
            <Link href="/location-staff-admin/departments">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Badge variant="outline" className="text-primary border-primary/30 text-[10px] font-semibold px-1.5 py-0">
                Location Department Hub
              </Badge>
              {dept?.code && (
                <Badge variant="outline" className="text-[10px] font-mono px-1.5 py-0">
                  {dept.code}
                </Badge>
              )}
              {dept?.isActive !== undefined && (
                <Badge
                  className={
                    dept.isActive
                      ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20 text-[10px] px-1.5 py-0"
                      : "bg-muted text-muted-foreground text-[10px] px-1.5 py-0"
                  }
                >
                  {dept.isActive ? "Active" : "Inactive"}
                </Badge>
              )}
            </div>
            <h1 className="text-xl sm:text-2xl font-bold text-foreground">
              {isLoadingDept ? "Loading Department..." : dept?.name || "Department"}
            </h1>
            {dept?.description && (
              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                {dept.description}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <Button size="sm" asChild variant="outline" className="h-9 text-xs rounded-xl gap-1.5">
            <Link href={`/location-staff-admin/departments/${deptId}/edit`}>
              <Edit2 className="h-3.5 w-3.5" />
              <span>Edit Department</span>
            </Link>
          </Button>
        </div>
      </div>

      {/* ── Department Head Profile Card ── */}
      <Card className="border-border/80 shadow-xs bg-linear-to-r from-card via-card to-primary/5">
        <CardContent className="p-4 sm:p-5">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-start sm:items-center gap-3.5">
              <div className="h-12 w-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center font-bold text-lg shrink-0 border border-primary/20">
                {dept?.headName ? dept.headName.charAt(0).toUpperCase() : <Shield className="h-6 w-6" />}
              </div>
              <div className="space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-semibold text-muted-foreground uppercase flex items-center gap-1">
                    <Shield className="h-3.5 w-3.5 text-primary" />
                    <span>Department Head</span>
                  </span>
                  {dept?.headUid ? (
                    <Badge className="bg-primary/10 text-primary border-primary/20 text-[10px] px-1.5 py-0">
                      Assigned
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-amber-600 border-amber-500/30 text-[10px] px-1.5 py-0">
                      Unassigned
                    </Badge>
                  )}
                </div>

                {dept?.headName ? (
                  <div>
                    <h2 className="text-base sm:text-lg font-bold text-foreground">{dept.headName}</h2>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap mt-0.5">
                      {(dept.headEmail || head?.email) && (
                        <span className="flex items-center gap-1">
                          <Mail className="h-3.5 w-3.5" />
                          <span>{dept.headEmail || head?.email}</span>
                        </span>
                      )}
                      {(dept.headPhone || head?.phone) && (
                        <span className="flex items-center gap-1">
                          <Phone className="h-3.5 w-3.5" />
                          <span>{dept.headPhone || head?.phone}</span>
                        </span>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground italic">
                    No Department Head appointed yet. Click &apos;Edit Department&apos; to assign one.
                  </p>
                )}
              </div>
            </div>

            {/* Multi-Department Alert Badge */}
            {otherDepts.length > 0 && (
              <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs md:max-w-xs shrink-0 space-y-1">
                <div className="flex items-center gap-1.5 font-semibold text-primary text-[11px]">
                  <ExternalLink className="h-3.5 w-3.5" />
                  <span>Heads Multiple Departments</span>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Also appointed head of:{" "}
                  {otherDepts.map((od, idx) => (
                    <Link
                      key={od.id}
                      href={`/location-staff-admin/departments/${od.id}`}
                      className="font-medium text-foreground hover:underline inline-block mr-1"
                    >
                      {od.name}
                      {idx < otherDepts.length - 1 ? "," : ""}
                    </Link>
                  ))}
                </p>
              </div>
            )}
          </div>

          {/* Quick Stats Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-4 mt-4 border-t border-border/60">
            <div className="bg-muted/40 p-2.5 rounded-lg text-center">
              <p className="text-[11px] text-muted-foreground">Department Staff</p>
              <p className="text-lg font-bold text-foreground">{staffList.length}</p>
            </div>
            <div className="bg-muted/40 p-2.5 rounded-lg text-center">
              <p className="text-[11px] text-muted-foreground">Active Shifts</p>
              <p className="text-lg font-bold text-foreground">{shifts.length}</p>
            </div>
            <div className="bg-muted/40 p-2.5 rounded-lg text-center">
              <p className="text-[11px] text-muted-foreground">Today Present</p>
              <p className="text-lg font-bold text-emerald-600">
                {attendanceSummary?.present ?? 0}
              </p>
            </div>
            <div className="bg-muted/40 p-2.5 rounded-lg text-center">
              <p className="text-[11px] text-muted-foreground">Late / Emergency</p>
              <p className="text-lg font-bold text-amber-600">
                {(attendanceSummary?.late ?? 0)}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Navigation Tabs ── */}
      <div
        role="tablist"
        aria-label="Department sections"
        className="flex items-center gap-1 p-1 bg-muted/60 rounded-xl border border-border/80 overflow-x-auto"
      >
        <button
          type="button"
          role="tab"
          id="tab-staff"
          aria-selected={activeTab === "staff"}
          aria-controls="panel-staff"
          onClick={() => setActiveTab("staff")}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
            activeTab === "staff"
              ? "bg-card text-foreground shadow-xs border"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Users className="h-4 w-4" />
          <span>Staff ({staffList.length})</span>
        </button>

        <button
          type="button"
          role="tab"
          id="tab-shifts"
          aria-selected={activeTab === "shifts"}
          aria-controls="panel-shifts"
          onClick={() => setActiveTab("shifts")}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
            activeTab === "shifts"
              ? "bg-card text-foreground shadow-xs border"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <Clock className="h-4 w-4" />
          <span>Shifts ({shifts.length})</span>
        </button>

        <button
          type="button"
          role="tab"
          id="tab-attendance"
          aria-selected={activeTab === "attendance"}
          aria-controls="panel-attendance"
          onClick={() => setActiveTab("attendance")}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
            activeTab === "attendance"
              ? "bg-card text-foreground shadow-xs border"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <CheckCircle2 className="h-4 w-4" />
          <span>Current Attendance</span>
        </button>

        <button
          type="button"
          role="tab"
          id="tab-reports"
          aria-selected={activeTab === "reports"}
          aria-controls="panel-reports"
          onClick={() => setActiveTab("reports")}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold whitespace-nowrap transition-all ${
            activeTab === "reports"
              ? "bg-card text-foreground shadow-xs border"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <FileBarChart className="h-4 w-4" />
          <span>Attendance Reports</span>
        </button>
      </div>

      {/* ═════════════════════════════════════════════════════════════════════ */}
      {/* ── TAB 1: STAFF ─────────────────────────────────────────────────── */}
      {/* ═════════════════════════════════════════════════════════════════════ */}
      {activeTab === "staff" && (
        <div role="tabpanel" id="panel-staff" aria-labelledby="tab-staff" className="space-y-4">
          {/* Staff Filters & Actions */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 bg-card p-3 rounded-xl border">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search staff by name, role, phone, Aadhaar, voucher..."
                value={staffSearch}
                onChange={(e) => setStaffSearch(e.target.value)}
                className="pl-9 h-9 text-xs rounded-xl"
              />
            </div>

            <div className="flex items-center gap-2">
              <Select value={selectedStaffRole} onValueChange={setSelectedStaffRole}>
                <SelectTrigger className="h-9 text-xs w-[130px] rounded-xl">
                  <SelectValue placeholder="All Roles" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Roles</SelectItem>
                  {distinctRoles.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={selectedStaffShift} onValueChange={setSelectedStaffShift}>
                <SelectTrigger className="h-9 text-xs w-[130px] rounded-xl">
                  <SelectValue placeholder="All Shifts" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Shifts</SelectItem>
                  {shifts.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button asChild size="sm" className="h-9 text-xs rounded-xl gap-1.5 shrink-0">
                <Link href={`/location-staff-admin/staff/new?departmentId=${deptId}`}>
                  <Plus className="h-3.5 w-3.5" />
                  <span>Add Staff</span>
                </Link>
              </Button>
            </div>
          </div>

          {/* Staff Roster Cards */}
          {isLoadingStaff ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-36 rounded-xl border bg-card/60 animate-pulse" />
              ))}
            </div>
          ) : filteredStaff.length === 0 ? (
            <div className="rounded-xl border border-dashed p-8 text-center bg-card/30">
              <UsersRound className="h-8 w-8 text-muted-foreground mx-auto mb-2 opacity-50" />
              <p className="font-semibold text-foreground text-sm">No staff members found</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {staffSearch || selectedStaffRole !== "ALL" || selectedStaffShift !== "ALL"
                  ? "Try clearing filters to see all department staff."
                  : "Add staff members to this department to track assignments and attendance."}
              </p>
              <Button size="sm" asChild variant="outline" className="mt-3 text-xs rounded-full">
                <Link href={`/location-staff-admin/staff/new?departmentId=${deptId}`}>
                  Add First Staff Member
                </Link>
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {filteredStaff.map((staff) => {
                const assignedShift = staff.shiftId ? shiftMap.get(staff.shiftId) : null;
                return (
                  <Card key={staff.id} className="border-border/80 shadow-xs hover:border-primary/40 transition-colors">
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="h-10 w-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-sm shrink-0">
                            {staff.name.charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <h3 className="font-bold text-sm text-foreground truncate">{staff.name}</h3>
                            <p className="text-[11px] text-muted-foreground truncate">
                              {staff.fatherName ? `S/o ${staff.fatherName}` : "Staff Member"}
                            </p>
                          </div>
                        </div>

                        <Badge
                          className={
                            staff.status === "ACTIVE"
                              ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20 text-[10px] px-1.5 py-0"
                              : "bg-muted text-muted-foreground text-[10px] px-1.5 py-0"
                          }
                        >
                          {staff.status}
                        </Badge>
                      </div>

                      <div className="space-y-1.5 text-xs">
                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground text-[11px]">Role / Designation:</span>
                          <Badge variant="outline" className="text-[10px] font-medium px-1.5 py-0">
                            {staff.role}
                          </Badge>
                        </div>

                        <div className="flex items-center justify-between">
                          <span className="text-muted-foreground text-[11px]">Assigned Shift:</span>
                          {assignedShift ? (
                            <Badge className="bg-primary/10 text-primary border-primary/20 text-[10px] px-1.5 py-0">
                              {assignedShift.name} ({assignedShift.startTime} - {assignedShift.endTime})
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-muted-foreground text-[10px] px-1.5 py-0">
                              No Shift Assigned
                            </Badge>
                          )}
                        </div>

                        <div className="flex items-center justify-between pt-1 border-t border-border/40 text-[11px]">
                          <span className="text-muted-foreground flex items-center gap-1">
                            <Phone className="h-3 w-3" />
                            <span>{staff.contactNumber}</span>
                          </span>
                          {staff.aadhaar && (
                            <span className="font-mono text-muted-foreground">
                              Aadhaar: •••• {staff.aadhaar.slice(-4)}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="pt-2 border-t border-border/40 flex items-center justify-between text-xs">
                        <span className="text-[11px] text-muted-foreground">
                          {staff.payeeVoucher ? `Voucher: ${staff.payeeVoucher}` : "Regular"}
                        </span>
                        <Button asChild size="sm" variant="ghost" className="h-7 text-xs text-primary px-2">
                          <Link href={`/location-staff-admin/staff/${staff.id}`}>
                            View Profile →
                          </Link>
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ═════════════════════════════════════════════════════════════════════ */}
      {/* ── TAB 2: SHIFTS ────────────────────────────────────────────────── */}
      {/* ═════════════════════════════════════════════════════════════════════ */}
      {activeTab === "shifts" && (
        <div role="tabpanel" id="panel-shifts" aria-labelledby="tab-shifts" className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-card p-3 rounded-xl border">
            <div>
              <h2 className="text-sm font-bold text-foreground">Department Shifts</h2>
              <p className="text-xs text-muted-foreground">
                Work shifts available for {dept?.name || "this department"} (dedicated, shared, and campus-wide).
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  fetchCampusShifts();
                  setIsLinkShiftModalOpen(true);
                }}
                className="h-8 text-xs rounded-xl gap-1.5"
              >
                <Link2 className="h-3.5 w-3.5 text-primary" />
                <span>Reuse Campus Shift</span>
              </Button>

              <Button asChild size="sm" className="h-8 text-xs rounded-xl gap-1.5">
                <Link href={`/location-staff-admin/shifts/new?departmentId=${deptId}`}>
                  <Plus className="h-3.5 w-3.5" />
                  <span>Create Shift</span>
                </Link>
              </Button>
            </div>
          </div>

          {isLoadingShifts ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {[1, 2].map((i) => (
                <div key={i} className="h-36 rounded-xl border bg-card/60 animate-pulse" />
              ))}
            </div>
          ) : shifts.length === 0 ? (
            <div className="rounded-xl border border-dashed p-8 text-center bg-card/30 space-y-3">
              <Clock className="h-8 w-8 text-muted-foreground mx-auto opacity-50" />
              <div>
                <p className="font-semibold text-foreground text-sm">No shifts configured for this department</p>
                <p className="text-xs text-muted-foreground mt-0.5 max-w-sm mx-auto">
                  Create a new dedicated shift, or reuse an existing shift already configured for another campus department.
                </p>
              </div>
              <div className="flex items-center justify-center gap-2 pt-1">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    fetchCampusShifts();
                    setIsLinkShiftModalOpen(true);
                  }}
                  className="text-xs rounded-full gap-1.5"
                >
                  <Link2 className="h-3.5 w-3.5 text-primary" />
                  <span>Reuse Existing Shift</span>
                </Button>
                <Button size="sm" asChild className="text-xs rounded-full gap-1.5">
                  <Link href={`/location-staff-admin/shifts/new?departmentId=${deptId}`}>
                    <Plus className="h-3.5 w-3.5" />
                    <span>Create New Shift</span>
                  </Link>
                </Button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {shifts.map((shift) => {
                const isCampusWide = !!shift.isCampusWide || shift.departmentId === "ALL" || (Array.isArray(shift.departmentIds) && shift.departmentIds.includes("ALL"));
                const isShared = !isCampusWide && Array.isArray(shift.departmentIds) && shift.departmentIds.length > 1;

                return (
                  <Card key={shift.id} className="border-border/80 shadow-xs hover:border-primary/40 transition-colors">
                    <CardContent className="p-4 space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="flex items-center gap-1.5">
                            <h3 className="font-bold text-base text-foreground">{shift.name}</h3>
                            {isCampusWide ? (
                              <Badge className="bg-purple-500/10 text-purple-600 border-purple-500/20 text-[10px] px-1.5 py-0 gap-1">
                                <Globe className="h-3 w-3" />
                                <span>Campus-Wide</span>
                              </Badge>
                            ) : isShared ? (
                              <Badge className="bg-blue-500/10 text-blue-600 border-blue-500/20 text-[10px] px-1.5 py-0 gap-1">
                                <Link2 className="h-3 w-3" />
                                <span>Shared ({shift.departmentIds?.length})</span>
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-muted-foreground">
                                Dedicated
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <Clock className="h-3.5 w-3.5 text-primary" />
                            <span className="text-xs font-mono font-semibold text-foreground">
                              {shift.startTime} – {shift.endTime}
                            </span>
                          </div>
                        </div>
                        <Badge
                          className={
                            shift.isActive
                              ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20 text-[10px] px-1.5 py-0"
                              : "bg-muted text-muted-foreground text-[10px] px-1.5 py-0"
                          }
                        >
                          {shift.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </div>

                      <div className="p-2.5 rounded-lg bg-muted/40 border border-border/50 text-xs space-y-1">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-muted-foreground">Grace Period:</span>
                          <span className="font-medium text-foreground">{shift.gracePeriodMinutes ?? 15} mins</span>
                        </div>
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-muted-foreground">Assigned Staff:</span>
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-semibold">
                            {isCampusWide || isShared
                              ? `${shift.deptAssignedStaffCount ?? 0} in this Dept (${shift.assignedStaffCount ?? 0} total)`
                              : `${shift.assignedStaffCount ?? 0} Staff`}
                          </Badge>
                        </div>
                        {shift.description && (
                          <p className="text-[11px] text-muted-foreground pt-1 border-t border-border/40 line-clamp-2">
                            {shift.description}
                          </p>
                        )}
                      </div>

                      <div className="pt-2 border-t border-border/50 flex items-center justify-between text-xs">
                        <div className="flex items-center gap-1">
                          <Button asChild size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground hover:text-foreground px-2">
                            <Link href={`/location-staff-admin/shifts/${shift.id}/edit`}>
                              <Edit2 className="h-3 w-3 mr-1" />
                              Edit
                            </Link>
                          </Button>

                          {isShared && (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() => handleUnlinkShift(shift)}
                              className="h-7 text-xs text-destructive hover:bg-destructive/10 px-2 gap-1"
                              title="Remove shift from this department"
                            >
                              <Unlink className="h-3 w-3" />
                              <span>Unlink</span>
                            </Button>
                          )}
                        </div>

                        <Button asChild size="sm" variant="ghost" className="h-7 text-xs text-primary px-2">
                          <Link href={`/location-staff-admin/shifts/${shift.id}/staff?departmentId=${deptId}`}>
                            Staff ({shift.deptAssignedStaffCount ?? shift.assignedStaffCount ?? 0}) →
                          </Link>
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          {/* ── Link Existing Shift Dialog ── */}
          <Dialog open={isLinkShiftModalOpen} onOpenChange={setIsLinkShiftModalOpen}>
            <DialogContent className="sm:max-w-md p-5 bg-card border shadow-xl">
              <DialogHeader className="pb-2">
                <DialogTitle className="text-base font-bold flex items-center gap-2">
                  <Link2 className="h-4 w-4 text-primary" />
                  <span>Reuse Campus Shift</span>
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground">
                  Select an existing shift configured in another department to reuse in {dept?.name || "this department"}.
                </DialogDescription>
              </DialogHeader>

              {availableShiftsToReuse.length === 0 ? (
                <div className="py-6 text-center space-y-2">
                  <Clock className="h-8 w-8 text-muted-foreground mx-auto opacity-40" />
                  <p className="text-xs font-semibold text-foreground">No other reusable shifts found</p>
                  <p className="text-[11px] text-muted-foreground max-w-xs mx-auto">
                    All other shifts on campus are already linked to this department or are configured as campus-wide.
                  </p>
                  <Button asChild size="sm" className="text-xs mt-2" onClick={() => setIsLinkShiftModalOpen(false)}>
                    <Link href={`/location-staff-admin/shifts/new?departmentId=${deptId}`}>
                      Create New Shift
                    </Link>
                  </Button>
                </div>
              ) : (
                <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  {availableShiftsToReuse.map((s) => (
                    <div
                      key={s.id}
                      className="flex items-center justify-between p-3 rounded-xl border bg-muted/20 hover:bg-muted/40 transition-colors"
                    >
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-xs text-foreground">{s.name}</span>
                          <Badge variant="outline" className="text-[10px] font-mono px-1 py-0">
                            {s.startTime} – {s.endTime}
                          </Badge>
                        </div>
                        <p className="text-[10px] text-muted-foreground">
                          Used by: {s.departmentName || "Another department"} • Grace: {s.gracePeriodMinutes ?? 15}m
                        </p>
                      </div>
                      <Button
                        size="sm"
                        disabled={isLinkingShift}
                        onClick={() => handleLinkShift(s)}
                        className="h-8 text-xs font-semibold rounded-lg gap-1 shrink-0"
                      >
                        <Plus className="h-3 w-3" />
                        <span>Reuse</span>
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </DialogContent>
          </Dialog>
        </div>
      )}

      {/* ═════════════════════════════════════════════════════════════════════ */}
      {/* ── TAB 3: CURRENT ATTENDANCE ────────────────────────────────────── */}
      {/* ═════════════════════════════════════════════════════════════════════ */}
      {activeTab === "attendance" && (
        <div role="tabpanel" id="panel-attendance" aria-labelledby="tab-attendance" className="space-y-4">
          {/* Date & Shift Controls */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 bg-card p-3 rounded-xl border">
            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => shiftAttendanceDate(-1)}
                title="Previous Day"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>

              <div className="relative">
                <Input
                  type="date"
                  value={attendanceDate}
                  onChange={(e) => setAttendanceDate(e.target.value)}
                  className="h-8 text-xs font-semibold px-2 w-[140px]"
                />
              </div>

              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => shiftAttendanceDate(1)}
                title="Next Day"
              >
                <ChevronRight className="h-4 w-4" />
              </Button>

              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs px-2"
                onClick={() => setAttendanceDate(istDateKey())}
              >
                Today
              </Button>
            </div>

            <div className="flex items-center gap-2">
              <Select value={attendanceShiftFilter} onValueChange={setAttendanceShiftFilter}>
                <SelectTrigger className="h-8 text-xs w-[140px]">
                  <SelectValue placeholder="All Shifts" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Shifts</SelectItem>
                  {shifts.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={fetchAttendance}
                disabled={isLoadingAttendance}
                title="Refresh Attendance"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isLoadingAttendance ? "animate-spin" : ""}`} />
              </Button>
            </div>
          </div>

          {/* Attendance KPI Summary Chips */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
            <div className="bg-card p-2.5 rounded-xl border text-center">
              <span className="text-[10px] text-muted-foreground uppercase font-semibold">Total Staff</span>
              <p className="text-base font-bold text-foreground mt-0.5">{attendanceSummary?.total ?? 0}</p>
            </div>
            <div className="bg-emerald-500/10 border border-emerald-500/20 p-2.5 rounded-xl text-center">
              <span className="text-[10px] text-emerald-600 uppercase font-semibold">Present</span>
              <p className="text-base font-bold text-emerald-700 dark:text-emerald-400 mt-0.5">
                {attendanceSummary?.present ?? 0}
              </p>
            </div>
            <div className="bg-amber-500/10 border border-amber-500/20 p-2.5 rounded-xl text-center">
              <span className="text-[10px] text-amber-600 uppercase font-semibold">Late</span>
              <p className="text-base font-bold text-amber-700 dark:text-amber-400 mt-0.5">
                {attendanceSummary?.late ?? 0}
              </p>
            </div>
            <div className="bg-red-500/10 border border-red-500/20 p-2.5 rounded-xl text-center">
              <span className="text-[10px] text-red-600 uppercase font-semibold">Absent</span>
              <p className="text-base font-bold text-red-700 dark:text-red-400 mt-0.5">
                {attendanceSummary?.absent ?? 0}
              </p>
            </div>
            <div className="bg-blue-500/10 border border-blue-500/20 p-2.5 rounded-xl text-center">
              <span className="text-[10px] text-blue-600 uppercase font-semibold">On Leave</span>
              <p className="text-base font-bold text-blue-700 dark:text-blue-400 mt-0.5">
                {attendanceSummary?.onLeave ?? 0}
              </p>
            </div>
            <div className="bg-muted/60 border p-2.5 rounded-xl text-center">
              <span className="text-[10px] text-muted-foreground uppercase font-semibold">Half Day</span>
              <p className="text-base font-bold text-foreground mt-0.5">{attendanceSummary?.halfDay ?? 0}</p>
            </div>
            <div className="bg-muted/60 border p-2.5 rounded-xl text-center">
              <span className="text-[10px] text-muted-foreground uppercase font-semibold">Pending</span>
              <p className="text-base font-bold text-foreground mt-0.5">{attendanceSummary?.pending ?? 0}</p>
            </div>
          </div>

          {/* Attendance Roster Table & Responsive Mobile Cards */}
          <Card className="border-border/80 shadow-xs">
            <CardHeader className="p-4 pb-2">
              <CardTitle className="text-sm font-bold flex items-center justify-between">
                <span>Roster for {attendanceDate}</span>
                <span className="text-xs font-normal text-muted-foreground">
                  {roster.length} Staff in Department
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {isLoadingAttendance ? (
                <div className="p-8 text-center text-xs text-muted-foreground">
                  Loading attendance records...
                </div>
              ) : roster.length === 0 ? (
                <div className="p-8 text-center text-xs text-muted-foreground">
                  No staff roster found for this department.
                </div>
              ) : (
                <>
                  {/* Desktop Table View */}
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/40 border-b border-border/80 text-muted-foreground text-[11px]">
                        <tr>
                          <th className="text-left font-semibold p-3 pl-4">Staff Member</th>
                          <th className="text-left font-semibold p-3">Duty Shift</th>
                          <th className="text-left font-semibold p-3">Status</th>
                          <th className="text-left font-semibold p-3">Check-In</th>
                          <th className="text-left font-semibold p-3">Check-Out</th>
                          <th className="text-left font-semibold p-3 pr-4">Details & Notes</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/60">
                        {roster.map(({ staff, attendance }) => {
                          const shift = staff.shiftId ? shiftMap.get(staff.shiftId) : null;
                          const isLate = attendance?.isLate || attendance?.isLateCheckIn;
                          const isEmergency = attendance?.isEmergencyDuty;

                          return (
                            <tr key={staff.id} className="hover:bg-muted/20 transition-colors">
                              <td className="p-3 pl-4">
                                <div className="font-semibold text-foreground">{staff.name}</div>
                                <div className="text-[11px] text-muted-foreground">{staff.role}</div>
                              </td>

                              <td className="p-3">
                                {attendance?.shiftName ? (
                                  <Badge variant="outline" className="text-[10px] font-medium px-1.5 py-0">
                                    {attendance.shiftName}
                                  </Badge>
                                ) : shift ? (
                                  <Badge variant="outline" className="text-[10px] font-medium px-1.5 py-0">
                                    {shift.name}
                                  </Badge>
                                ) : (
                                  <span className="text-muted-foreground text-[11px]">Unassigned</span>
                                )}
                              </td>

                              <td className="p-3">
                                {!attendance ? (
                                  <Badge variant="outline" className="text-muted-foreground text-[10px] px-1.5 py-0">
                                    Not Marked
                                  </Badge>
                                ) : attendance.status === "PRESENT" ? (
                                  <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 text-[10px] px-1.5 py-0">
                                    Present
                                  </Badge>
                                ) : attendance.status === "LATE" ? (
                                  <Badge className="bg-amber-500/10 text-amber-600 border-amber-500/20 text-[10px] px-1.5 py-0">
                                    Late
                                  </Badge>
                                ) : attendance.status === "ABSENT" ? (
                                  <Badge className="bg-red-500/10 text-red-600 border-red-500/20 text-[10px] px-1.5 py-0">
                                    Absent
                                  </Badge>
                                ) : attendance.status === "ON_LEAVE" ? (
                                  <Badge className="bg-blue-500/10 text-blue-600 border-blue-500/20 text-[10px] px-1.5 py-0">
                                    On Leave
                                  </Badge>
                                ) : (
                                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                                    {attendance.status}
                                  </Badge>
                                )}
                              </td>

                              <td className="p-3">
                                {attendance?.checkInTime ? (
                                  <div className="space-y-0.5">
                                    <span className="font-mono font-medium text-foreground">
                                      {attendance.checkInTime}
                                    </span>
                                    {isLate && (
                                      <Badge className="ml-1.5 bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30 text-[9px] px-1 py-0">
                                        Late
                                      </Badge>
                                    )}
                                  </div>
                                ) : (
                                  <span className="text-muted-foreground">—</span>
                                )}
                              </td>

                              <td className="p-3">
                                {attendance?.checkOutTime ? (
                                  <div className="space-y-0.5">
                                    <span className="font-mono font-medium text-foreground">
                                      {attendance.checkOutTime}
                                    </span>
                                    {attendance.isOutOfTimeCheckOut && (
                                      <Badge className="ml-1.5 bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/30 text-[9px] px-1 py-0">
                                        Early/Out of Time
                                      </Badge>
                                    )}
                                  </div>
                                ) : (
                                  <span className="text-muted-foreground">—</span>
                                )}
                              </td>

                              <td className="p-3 pr-4">
                                <div className="space-y-1">
                                  {isEmergency && (
                                    <div className="flex items-center gap-1">
                                      <Badge className="bg-purple-500/10 text-purple-700 dark:text-purple-300 border-purple-500/20 text-[10px] px-1.5 py-0">
                                        Emergency Duty
                                      </Badge>
                                      {attendance.emergencyReason && (
                                        <span className="text-[10px] text-muted-foreground italic truncate max-w-[140px]">
                                          &ldquo;{attendance.emergencyReason}&rdquo;
                                        </span>
                                      )}
                                    </div>
                                  )}
                                  {attendance?.notes && (
                                    <p className="text-[10px] text-muted-foreground line-clamp-1">
                                      Note: {attendance.notes}
                                    </p>
                                  )}
                                  {!isEmergency && !attendance?.notes && (
                                    <span className="text-muted-foreground text-[10px]">—</span>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile Stacked Card View */}
                  <div className="block md:hidden divide-y divide-border/60">
                    {roster.map(({ staff, attendance }) => {
                      const isLate = attendance?.isLate || attendance?.isLateCheckIn;
                      const isEmergency = attendance?.isEmergencyDuty;

                      return (
                        <div key={staff.id} className="p-3.5 space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <p className="font-bold text-sm text-foreground">{staff.name}</p>
                              <p className="text-[11px] text-muted-foreground">{staff.role}</p>
                            </div>
                            <div>
                              {!attendance ? (
                                <Badge variant="outline" className="text-muted-foreground text-[10px] px-1.5 py-0">
                                  Not Marked
                                </Badge>
                              ) : attendance.status === "PRESENT" ? (
                                <Badge className="bg-emerald-500/10 text-emerald-600 border-emerald-500/20 text-[10px] px-1.5 py-0">
                                  Present
                                </Badge>
                              ) : attendance.status === "LATE" ? (
                                <Badge className="bg-amber-500/10 text-amber-600 border-amber-500/20 text-[10px] px-1.5 py-0">
                                  Late
                                </Badge>
                              ) : attendance.status === "ABSENT" ? (
                                <Badge className="bg-red-500/10 text-red-600 border-red-500/20 text-[10px] px-1.5 py-0">
                                  Absent
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                                  {attendance.status}
                                </Badge>
                              )}
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-2 text-xs bg-muted/30 p-2 rounded-lg border border-border/40">
                            <div>
                              <span className="text-[10px] text-muted-foreground block">Check-In:</span>
                              <span className="font-mono font-medium text-foreground">
                                {attendance?.checkInTime || "—"}
                              </span>
                              {isLate && (
                                <Badge className="ml-1 bg-amber-500/15 text-amber-700 text-[8px] px-1 py-0">
                                  Late
                                </Badge>
                              )}
                            </div>
                            <div>
                              <span className="text-[10px] text-muted-foreground block">Check-Out:</span>
                              <span className="font-mono font-medium text-foreground">
                                {attendance?.checkOutTime || "—"}
                              </span>
                              {attendance?.isOutOfTimeCheckOut && (
                                <Badge className="ml-1 bg-orange-500/15 text-orange-700 text-[8px] px-1 py-0">
                                  Early
                                </Badge>
                              )}
                            </div>
                          </div>

                          {isEmergency && (
                            <div className="bg-purple-500/10 border border-purple-500/20 p-2 rounded-lg text-xs space-y-0.5">
                              <Badge className="bg-purple-500/20 text-purple-700 border-purple-500/30 text-[9px] px-1 py-0">
                                Emergency Duty
                              </Badge>
                              {attendance.emergencyReason && (
                                <p className="text-[11px] text-purple-800 dark:text-purple-300 italic">
                                  &ldquo;{attendance.emergencyReason}&rdquo;
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ═════════════════════════════════════════════════════════════════════ */}
      {/* ── TAB 4: ATTENDANCE REPORTS ────────────────────────────────────── */}
      {/* ═════════════════════════════════════════════════════════════════════ */}
      {activeTab === "reports" && (
        <div role="tabpanel" id="panel-reports" aria-labelledby="tab-reports" className="space-y-4">
          {/* Range & Filters bar */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 bg-card p-3 rounded-xl border shadow-xs items-end">
            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">From Date</Label>
              <Input
                type="date"
                value={reportFrom}
                max={reportTo}
                onChange={(e) => setReportFrom(e.target.value)}
                className="h-9 text-xs"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">To Date</Label>
              <Input
                type="date"
                value={reportTo}
                min={reportFrom}
                max={istDateKey()}
                onChange={(e) => setReportTo(e.target.value)}
                className="h-9 text-xs"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-[11px] text-muted-foreground">Filter Shift</Label>
              <Select value={reportShiftFilter} onValueChange={setReportShiftFilter}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="All Shifts" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Shifts</SelectItem>
                  {shifts.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-1 col-span-2 sm:col-span-2">
              <Button
                variant="outline"
                size="sm"
                className="h-9 text-xs flex-1"
                onClick={() => {
                  setReportFrom(istDateKey());
                  setReportTo(istDateKey());
                }}
              >
                Today
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-9 text-xs flex-1"
                onClick={() => {
                  const d = new Date();
                  d.setDate(d.getDate() - 7);
                  setReportFrom(d.toISOString().split("T")[0]);
                  setReportTo(istDateKey());
                }}
              >
                7 Days
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-9 text-xs flex-1"
                onClick={() => {
                  setReportFrom(firstOfMonth());
                  setReportTo(istDateKey());
                }}
              >
                This Month
              </Button>

              <Button
                size="sm"
                onClick={handleDownloadCsv}
                disabled={reportRows.length === 0}
                className="h-9 text-xs gap-1.5 bg-primary text-primary-foreground font-semibold px-3"
                title="Download CSV Report"
              >
                <Download className="h-3.5 w-3.5" />
                <span>Export CSV</span>
              </Button>
            </div>
          </div>

          {/* Report Summary Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="bg-card p-3 rounded-xl border">
              <span className="text-[11px] text-muted-foreground">Staff Members</span>
              <p className="text-xl font-bold text-foreground mt-0.5">{reportRows.length}</p>
            </div>
            <div className="bg-card p-3 rounded-xl border">
              <span className="text-[11px] text-muted-foreground">Avg Attendance %</span>
              <p className="text-xl font-bold text-primary mt-0.5">
                {reportRows.length > 0
                  ? Math.round(
                      reportRows.reduce((acc, r) => acc + r.attendancePercent, 0) / reportRows.length
                    )
                  : 0}
                %
              </p>
            </div>
            <div className="bg-card p-3 rounded-xl border">
              <span className="text-[11px] text-muted-foreground">Total Present Count</span>
              <p className="text-xl font-bold text-emerald-600 mt-0.5">
                {reportRows.reduce((acc, r) => acc + r.present, 0)}
              </p>
            </div>
            <div className="bg-card p-3 rounded-xl border">
              <span className="text-[11px] text-muted-foreground">Total Late Count</span>
              <p className="text-xl font-bold text-amber-600 mt-0.5">
                {reportRows.reduce((acc, r) => acc + r.late, 0)}
              </p>
            </div>
          </div>

          {/* Report Table & Responsive Mobile Cards */}
          <Card className="border-border/80 shadow-xs">
            <CardHeader className="p-4 pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-bold">
                Attendance Breakdown ({reportFrom} to {reportTo})
              </CardTitle>
              <Button
                variant="outline"
                size="sm"
                onClick={handleDownloadCsv}
                disabled={reportRows.length === 0}
                className="h-8 text-xs gap-1.5"
              >
                <Download className="h-3.5 w-3.5" />
                <span>Download Report (.csv)</span>
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              {isLoadingReports ? (
                <div className="p-8 text-center text-xs text-muted-foreground">
                  Generating attendance report...
                </div>
              ) : reportRows.length === 0 ? (
                <div className="p-8 text-center text-xs text-muted-foreground">
                  No attendance records found for this date range.
                </div>
              ) : (
                <>
                  {/* Desktop Table View */}
                  <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/40 border-b border-border/80 text-muted-foreground text-[11px]">
                        <tr>
                          <th className="text-left font-semibold p-3 pl-4">Staff Member</th>
                          <th className="text-left font-semibold p-3">Role</th>
                          <th className="text-left font-semibold p-3">Shift</th>
                          <th className="text-center font-semibold p-3">Present</th>
                          <th className="text-center font-semibold p-3">Late</th>
                          <th className="text-center font-semibold p-3">Absent</th>
                          <th className="text-center font-semibold p-3">Leave</th>
                          <th className="text-center font-semibold p-3">Marked</th>
                          <th className="text-center font-semibold p-3 pr-4">Attendance %</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/60">
                        {reportRows.map((r) => (
                          <tr key={r.staffId} className="hover:bg-muted/20 transition-colors">
                            <td className="p-3 pl-4 font-semibold text-foreground">{r.staffName}</td>
                            <td className="p-3 text-muted-foreground">{r.role}</td>
                            <td className="p-3 font-mono text-[11px] text-muted-foreground">{r.shiftName || "—"}</td>
                            <td className="p-3 text-center font-semibold text-emerald-600">{r.present}</td>
                            <td className="p-3 text-center font-semibold text-amber-600">{r.late}</td>
                            <td className="p-3 text-center font-semibold text-red-600">{r.absent}</td>
                            <td className="p-3 text-center text-blue-600">{r.onLeave}</td>
                            <td className="p-3 text-center font-medium text-foreground">{r.marked}</td>
                            <td className="p-3 pr-4 text-center">
                              <Badge
                                variant="outline"
                                className={
                                  r.attendancePercent >= 90
                                    ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20 text-[10px]"
                                    : r.attendancePercent >= 75
                                    ? "bg-amber-500/10 text-amber-600 border-amber-500/20 text-[10px]"
                                    : "bg-red-500/10 text-red-600 border-red-500/20 text-[10px]"
                                }
                              >
                                {r.attendancePercent}%
                              </Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Mobile Stacked Card View */}
                  <div className="block md:hidden divide-y divide-border/60">
                    {reportRows.map((r) => (
                      <div key={r.staffId} className="p-3.5 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="font-bold text-sm text-foreground">{r.staffName}</p>
                            <p className="text-[11px] text-muted-foreground">{r.role} {r.shiftName ? `· ${r.shiftName}` : ""}</p>
                          </div>
                          <Badge
                            variant="outline"
                            className={
                              r.attendancePercent >= 90
                                ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20 text-[10px]"
                                : r.attendancePercent >= 75
                                ? "bg-amber-500/10 text-amber-600 border-amber-500/20 text-[10px]"
                                : "bg-red-500/10 text-red-600 border-red-500/20 text-[10px]"
                            }
                          >
                            {r.attendancePercent}% Attended
                          </Badge>
                        </div>

                        <div className="grid grid-cols-4 gap-1.5 text-center text-xs bg-muted/30 p-2 rounded-lg border border-border/40">
                          <div>
                            <span className="text-[10px] text-emerald-600 font-semibold block">Present</span>
                            <span className="font-bold text-foreground">{r.present}</span>
                          </div>
                          <div>
                            <span className="text-[10px] text-amber-600 font-semibold block">Late</span>
                            <span className="font-bold text-foreground">{r.late}</span>
                          </div>
                          <div>
                            <span className="text-[10px] text-red-600 font-semibold block">Absent</span>
                            <span className="font-bold text-foreground">{r.absent}</span>
                          </div>
                          <div>
                            <span className="text-[10px] text-blue-600 font-semibold block">Leave</span>
                            <span className="font-bold text-foreground">{r.onLeave}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
