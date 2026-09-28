"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowLeft,
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Clock,
  LogIn,
  LogOut,
  RefreshCw,
  Search,
  ShieldAlert,
  UserCheck,
  UserPlus,
  Users,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import { istDateKey } from "@/lib/attendance/istTime";
import { getShiftCurrentState } from "@/lib/location/shiftTiming";
import type {
  LocationDepartment,
  LocationShift,
  LocationStaffMember,
  LocationStaffAttendanceRecord,
  StaffAttendanceStatus,
} from "@/types/locationStaff";

interface ShiftWiseAttendanceViewProps {
  departmentId?: string;
  departmentName?: string;
  departments?: LocationDepartment[];
  onDepartmentChange?: (deptId: string) => void;
  backHref: string;
  manageShiftsHref: string;
}

interface RosterItem {
  staff: LocationStaffMember;
  attendance: LocationStaffAttendanceRecord | null;
}

export function ShiftWiseAttendanceView({
  departmentId,
  departmentName,
  departments,
  onDepartmentChange,
  backHref,
  manageShiftsHref,
}: ShiftWiseAttendanceViewProps) {
  const [date, setDate] = useState<string>(() => istDateKey());
  const [shifts, setShifts] = useState<LocationShift[]>([]);
  const [selectedShiftId, setSelectedShiftId] = useState<string>("");
  const [departmentStaff, setDepartmentStaff] = useState<LocationStaffMember[]>([]);
  const [roster, setRoster] = useState<RosterItem[]>([]);
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  // Emergency Duty Entry state
  const [emergencyDialogOpen, setEmergencyDialogOpen] = useState(false);
  const [emergencyStaffId, setEmergencyStaffId] = useState("");
  const [emergencyReason, setEmergencyReason] = useState("");
  const [isSubmittingEmergency, setIsSubmittingEmergency] = useState(false);

  const [refreshKey, setRefreshKey] = useState(0);
  const reload = useCallback(() => setRefreshKey((k) => k + 1), []);

  // Fetch shifts for the department
  useEffect(() => {
    let isCancelled = false;
    const deptQuery = departmentId ? `?departmentId=${departmentId}` : "";

    Promise.all([
      fetch(`/api/location/shifts${deptQuery}`)
        .then((r) => (r.ok ? r.json() : Promise.resolve({ shifts: [] })))
        .then((d) => (d.shifts as LocationShift[] | undefined) ?? []),
      fetch(`/api/location/staff?status=ACTIVE${departmentId ? `&departmentId=${departmentId}` : ""}`)
        .then((r) => (r.ok ? r.json() : Promise.resolve({ staff: [] })))
        .then((d) => (d.staff as LocationStaffMember[] | undefined) ?? []),
    ])
      .then(([shiftsList, staffList]) => {
        if (isCancelled) return;
        setShifts(shiftsList);
        setDepartmentStaff(staffList);
        // Default to first active shift if not set
        if (!selectedShiftId && shiftsList.length > 0) {
          setSelectedShiftId(shiftsList[0].id);
        }
      })
      .catch(() => {
        if (!isCancelled) toast({ variant: "destructive", title: "Failed to load shifts" });
      });

    return () => {
      isCancelled = true;
    };
  }, [departmentId, refreshKey]);

  // Load attendance data
  useEffect(() => {
    let isCancelled = false;
    setIsLoading(true);

    const params = new URLSearchParams({ date });
    if (departmentId) params.set("departmentId", departmentId);

    fetch(`/api/location/staff-attendance?${params.toString()}`)
      .then((r) => (r.ok ? r.json() : Promise.resolve({ roster: [] })))
      .then((d) => {
        if (isCancelled) return;
        setRoster(d.roster ?? []);
      })
      .catch(() => {
        if (!isCancelled) toast({ variant: "destructive", title: "Failed to load attendance" });
      })
      .finally(() => {
        if (!isCancelled) setIsLoading(false);
      });

    return () => {
      isCancelled = true;
    };
  }, [date, departmentId, refreshKey]);

  const currentShift = shifts.find((s) => s.id === selectedShiftId) ?? null;
  const isEmergencyTab = selectedShiftId === "EMERGENCY";

  // Filter roster for the selected shift or emergency duty
  const shiftRoster = useMemo(() => {
    return roster.filter((item) => {
      if (isEmergencyTab) {
        return item.attendance?.isEmergencyDuty === true;
      }
      // If a regular shift is selected:
      // Show staff who are assigned to this shift, OR who checked into this shift
      const isAssigned = item.staff.shiftId === selectedShiftId;
      const checkedIntoShift = item.attendance?.shiftId === selectedShiftId;
      return isAssigned || checkedIntoShift;
    });
  }, [roster, selectedShiftId, isEmergencyTab]);

  // Filtered by search
  const filteredRoster = useMemo(() => {
    if (!search.trim()) return shiftRoster;
    const q = search.toLowerCase().trim();
    return shiftRoster.filter(
      (r) =>
        r.staff.name.toLowerCase().includes(q) ||
        r.staff.role?.toLowerCase().includes(q) ||
        r.staff.contactNumber?.includes(q)
    );
  }, [shiftRoster, search]);

  // Metrics for this shift
  const metrics = useMemo(() => {
    let present = 0;
    let late = 0;
    let absent = 0;
    let halfDay = 0;
    let onLeave = 0;
    let unmarked = 0;

    for (const item of shiftRoster) {
      if (!item.attendance) {
        unmarked++;
      } else if (item.attendance.status === "PRESENT") {
        present++;
      } else if (item.attendance.status === "LATE") {
        late++;
      } else if (item.attendance.status === "ABSENT") {
        absent++;
      } else if (item.attendance.status === "HALF_DAY") {
        halfDay++;
      } else if (item.attendance.status === "ON_LEAVE") {
        onLeave++;
      }
    }

    return {
      total: shiftRoster.length,
      present,
      late,
      absent,
      halfDay,
      onLeave,
      unmarked,
    };
  }, [shiftRoster]);

  // Date navigation
  const changeDateByDays = (offset: number) => {
    const [y, m, d] = date.split("-").map(Number);
    const current = new Date(y, m - 1, d);
    current.setDate(current.getDate() + offset);
    const ny = current.getFullYear();
    const nm = String(current.getMonth() + 1).padStart(2, "0");
    const nd = String(current.getDate()).padStart(2, "0");
    setDate(`${ny}-${nm}-${nd}`);
  };

  // 1-Click Check In
  const handleCheckIn = async (staffId: string) => {
    if (!currentShift && !isEmergencyTab) return;
    setActionLoadingId(`${staffId}_in`);
    try {
      const res = await fetch(`/api/location/staff-attendance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "CHECK_IN",
          staffId,
          date,
          shiftId: isEmergencyTab ? "EMERGENCY" : currentShift?.id,
          shiftName: isEmergencyTab ? "Emergency Duty (ED)" : currentShift?.name,
          isEmergencyDuty: isEmergencyTab,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Check-in failed");

      if (data.record.isLate) {
        toast({
          variant: "destructive",
          title: "Checked In (Late)",
          description: `Checked in at ${data.record.checkInTime} — marked as Late.`,
        });
      } else {
        toast({
          title: "Checked In (On Time)",
          description: `Checked in at ${data.record.checkInTime}.`,
        });
      }
      reload();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to check in";
      toast({ variant: "destructive", title: "Error", description: msg });
    } finally {
      setActionLoadingId(null);
    }
  };

  // 1-Click Check Out
  const handleCheckOut = async (staffId: string) => {
    setActionLoadingId(`${staffId}_out`);
    try {
      const res = await fetch(`/api/location/staff-attendance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "CHECK_OUT",
          staffId,
          date,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Check-out failed");

      if (data.record.isOutOfTimeCheckOut) {
        toast({
          variant: "destructive",
          title: "Checked Out (Out of Time)",
          description: `Checkout recorded at ${data.record.checkOutTime} — marked out of shift schedule.`,
        });
      } else {
        toast({
          title: "Checked Out",
          description: `Checkout recorded at ${data.record.checkOutTime}.`,
        });
      }
      reload();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to check out";
      toast({ variant: "destructive", title: "Error", description: msg });
    } finally {
      setActionLoadingId(null);
    }
  };

  // Set explicit status
  const handleSetStatus = async (staffId: string, status: StaffAttendanceStatus) => {
    setActionLoadingId(`${staffId}_${status}`);
    try {
      const res = await fetch(`/api/location/staff-attendance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "SET_STATUS",
          staffId,
          status,
          date,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update status");

      toast({ title: "Status Updated", description: `Marked as ${status}` });
      reload();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Update failed";
      toast({ variant: "destructive", title: "Error", description: msg });
    } finally {
      setActionLoadingId(null);
    }
  };

  // Bulk mark all unmarked on shift
  const handleBulkMarkShift = async (status: StaffAttendanceStatus) => {
    const unmarkedIds = shiftRoster.filter((r) => !r.attendance).map((r) => r.staff.id);
    if (unmarkedIds.length === 0) {
      toast({ title: "All shift staff already marked" });
      return;
    }

    try {
      const res = await fetch(`/api/location/staff-attendance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "BULK_MARK",
          staffIds: unmarkedIds,
          status,
          date,
        }),
      });
      if (!res.ok) throw new Error("Bulk update failed");
      toast({ title: "Updated", description: `Marked ${unmarkedIds.length} staff as ${status}` });
      reload();
    } catch {
      toast({ variant: "destructive", title: "Bulk update failed" });
    }
  };

  // Submit Emergency Duty Entry
  const handleSubmitEmergencyDuty = async () => {
    if (!emergencyStaffId) {
      toast({ variant: "destructive", title: "Select a staff member" });
      return;
    }

    setIsSubmittingEmergency(true);
    try {
      const res = await fetch(`/api/location/staff-attendance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "EMERGENCY_ENTRY",
          staffId: emergencyStaffId,
          date,
          emergencyReason: emergencyReason.trim() || "Urgent emergency deployment",
          isEmergencyDuty: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to entry emergency duty");

      toast({
        title: "Emergency Duty Recorded",
        description: `${data.record.staffName} checked in for Emergency Duty at ${data.record.checkInTime}.`,
      });
      setEmergencyDialogOpen(false);
      setEmergencyStaffId("");
      setEmergencyReason("");
      setSelectedShiftId("EMERGENCY");
      reload();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to record emergency duty";
      toast({ variant: "destructive", title: "Error", description: msg });
    } finally {
      setIsSubmittingEmergency(false);
    }
  };

  const shiftStatus = currentShift
    ? getShiftCurrentState(currentShift.startTime, currentShift.endTime)
    : "ACTIVE";

  return (
    <div className="space-y-4 max-w-6xl mx-auto pb-24 md:pb-8">
      {/* ── Top Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-card p-4 rounded-xl border shadow-xs">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="icon" className="h-9 w-9 shrink-0">
            <Link href={backHref}>
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div>
            <h1 className="text-lg sm:text-xl font-bold text-foreground flex items-center gap-2">
              <ClipboardCheck className="h-5 w-5 text-primary" />
              <span>Shift-Wise Attendance</span>
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              <span>{departmentName || "Department"}</span> · Automated timing validation (late check-in / out-of-time check-out).
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {departments && onDepartmentChange && (
            <Select value={departmentId} onValueChange={onDepartmentChange}>
              <SelectTrigger className="h-9 w-44 text-xs bg-background">
                <SelectValue placeholder="Department" />
              </SelectTrigger>
              <SelectContent>
                {departments.map((d) => (
                  <SelectItem key={d.id} value={d.id} className="text-xs">
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {/* Date Picker */}
          <div className="flex items-center gap-1 bg-muted/40 p-1 rounded-lg border">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => changeDateByDays(-1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="relative">
              <Input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="h-7 text-xs border-0 bg-transparent px-2 font-mono font-medium focus-visible:ring-0"
              />
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => changeDateByDays(1)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          <Button
            size="sm"
            onClick={() => setEmergencyDialogOpen(true)}
            className="rounded-full gap-1.5 text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white shadow-xs"
          >
            <ShieldAlert className="h-4 w-4" />
            <span>+ Emergency Duty</span>
          </Button>
        </div>
      </div>

      {/* ── Shift Selection Tabs / Pills ── */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
        {shifts.map((s) => {
          const isSelected = s.id === selectedShiftId;
          const assignedCount = departmentStaff.filter((st) => st.shiftId === s.id).length;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => setSelectedShiftId(s.id)}
              className={`shrink-0 flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all border ${
                isSelected
                  ? "bg-primary text-primary-foreground border-primary shadow-xs"
                  : "bg-card text-foreground hover:bg-muted/50 border-border"
              }`}
            >
              <Clock className="h-3.5 w-3.5" />
              <span>{s.name}</span>
              <span className="font-mono text-[11px] opacity-80">({s.startTime}–{s.endTime})</span>
              <Badge
                variant={isSelected ? "secondary" : "outline"}
                className="text-[10px] px-1.5 py-0 rounded-full"
              >
                {assignedCount}
              </Badge>
            </button>
          );
        })}

        {/* Emergency Duty Tab */}
        <button
          type="button"
          onClick={() => setSelectedShiftId("EMERGENCY")}
          className={`shrink-0 flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all border ${
            isEmergencyTab
              ? "bg-amber-600 text-white border-amber-600 shadow-xs"
              : "bg-card text-amber-700 dark:text-amber-400 hover:bg-amber-500/10 border-amber-500/30"
          }`}
        >
          <ShieldAlert className="h-3.5 w-3.5" />
          <span>🚨 Emergency Duty</span>
          <Badge
            variant={isEmergencyTab ? "secondary" : "outline"}
            className="text-[10px] px-1.5 py-0 rounded-full"
          >
            {roster.filter((r) => r.attendance?.isEmergencyDuty).length}
          </Badge>
        </button>
      </div>

      {/* ── Active Shift Info Banner ── */}
      {currentShift && (
        <Card className="border shadow-xs bg-linear-to-r from-card to-muted/20">
          <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <Clock className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-bold text-base text-foreground">{currentShift.name}</h3>
                  {shiftStatus === "ACTIVE" && (
                    <Badge className="bg-emerald-600 text-white text-[10px] px-2 py-0.5 gap-1">
                      <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />
                      Active Shift Now
                    </Badge>
                  )}
                  {shiftStatus === "UPCOMING" && (
                    <Badge variant="outline" className="text-xs text-muted-foreground">Upcoming Shift</Badge>
                  )}
                  {shiftStatus === "COMPLETED" && (
                    <Badge variant="outline" className="text-xs text-muted-foreground">Shift Ended</Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Shift Timing: <span className="font-mono font-semibold text-foreground">{currentShift.startTime} – {currentShift.endTime}</span> · Grace Period: <span className="font-semibold text-foreground">{currentShift.gracePeriodMinutes ?? 15} minutes</span> (Check-ins after grace marked as <span className="text-destructive font-semibold">Late</span>).
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 self-end sm:self-auto">
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleBulkMarkShift("PRESENT")}
                className="h-8 text-xs font-semibold rounded-full gap-1"
              >
                <UserCheck className="h-3.5 w-3.5 text-emerald-600" />
                <span>Mark Rest Present</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleBulkMarkShift("ABSENT")}
                className="h-8 text-xs font-semibold rounded-full gap-1 text-destructive"
              >
                <span>Mark Rest Absent</span>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── KPI Summary Cards ── */}
      <div className="grid grid-cols-2 sm:grid-cols-6 gap-2.5">
        <Card className="border shadow-xs">
          <CardContent className="p-3">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase">Shift Total</span>
            <p className="text-xl font-bold text-foreground mt-0.5">{metrics.total}</p>
          </CardContent>
        </Card>
        <Card className="border shadow-xs border-emerald-500/30 bg-emerald-500/5">
          <CardContent className="p-3">
            <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 uppercase">Present</span>
            <p className="text-xl font-bold text-emerald-700 dark:text-emerald-300 mt-0.5">{metrics.present}</p>
          </CardContent>
        </Card>
        <Card className="border shadow-xs border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-3">
            <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400 uppercase">Late Check-In</span>
            <p className="text-xl font-bold text-amber-700 dark:text-amber-300 mt-0.5">{metrics.late}</p>
          </CardContent>
        </Card>
        <Card className="border shadow-xs border-destructive/30 bg-destructive/5">
          <CardContent className="p-3">
            <span className="text-[10px] font-semibold text-destructive uppercase">Absent</span>
            <p className="text-xl font-bold text-destructive mt-0.5">{metrics.absent}</p>
          </CardContent>
        </Card>
        <Card className="border shadow-xs border-blue-500/30 bg-blue-500/5">
          <CardContent className="p-3">
            <span className="text-[10px] font-semibold text-blue-600 dark:text-blue-400 uppercase">Half / Leave</span>
            <p className="text-xl font-bold text-blue-700 dark:text-blue-300 mt-0.5">{metrics.halfDay + metrics.onLeave}</p>
          </CardContent>
        </Card>
        <Card className="border shadow-xs border-muted">
          <CardContent className="p-3">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase">Unmarked</span>
            <p className="text-xl font-bold text-muted-foreground mt-0.5">{metrics.unmarked}</p>
          </CardContent>
        </Card>
      </div>

      {/* ── Attendance Roster Table ── */}
      <Card className="border shadow-xs">
        <CardContent className="p-4 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search shift staff..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 h-9 text-xs"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                Showing {filteredRoster.length} staff members for this shift
              </span>
              <Button variant="ghost" size="icon" onClick={reload} className="h-8 w-8 text-muted-foreground" title="Refresh">
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          {isLoading ? (
            <div className="space-y-2 py-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-16 rounded-xl border bg-muted/30 animate-pulse" />
              ))}
            </div>
          ) : filteredRoster.length === 0 ? (
            <div className="rounded-xl border border-dashed p-8 text-center bg-card/30">
              <Users className="h-8 w-8 text-muted-foreground mx-auto mb-2 opacity-50" />
              <p className="font-semibold text-foreground text-sm">
                {isEmergencyTab ? "No staff currently on emergency duty" : "No staff found for this shift"}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                {isEmergencyTab
                  ? "Click '+ Emergency Duty' to call in an off-duty staff member."
                  : "Assign staff to this shift via the Shift Roster."}
              </p>
            </div>
          ) : (
            <div className="divide-y border rounded-xl overflow-hidden bg-card">
              {filteredRoster.map((item) => {
                const { staff, attendance } = item;
                const isPresent = attendance?.status === "PRESENT";
                const isLate = attendance?.status === "LATE" || attendance?.isLate;
                const isAbsent = attendance?.status === "ABSENT";
                const isHalfDay = attendance?.status === "HALF_DAY";
                const isOnLeave = attendance?.status === "ON_LEAVE";
                const isEmergency = attendance?.isEmergencyDuty;

                return (
                  <div
                    key={staff.id}
                    className="p-3.5 flex flex-col lg:flex-row lg:items-center justify-between gap-3 hover:bg-muted/30 transition-colors"
                  >
                    {/* Left: Avatar, Name, Role, Phone */}
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-11 w-11 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0 overflow-hidden font-bold text-primary text-xs">
                        {staff.photoUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={staff.photoUrl} alt={staff.name} className="h-full w-full object-cover" />
                        ) : (
                          staff.name.slice(0, 2).toUpperCase()
                        )}
                      </div>

                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-sm text-foreground truncate">{staff.name}</span>
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-primary/30 text-primary">
                            {staff.role}
                          </Badge>
                          {isEmergency && (
                            <Badge className="bg-amber-600 text-white text-[10px] px-1.5 py-0 gap-1 font-semibold">
                              <ShieldAlert className="h-3 w-3" />
                              Emergency Duty
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">
                          <span>📱 {staff.contactNumber}</span>
                          {attendance?.emergencyReason && (
                            <span className="text-amber-700 dark:text-amber-400 font-medium"> · Reason: {attendance.emergencyReason}</span>
                          )}
                        </p>
                      </div>
                    </div>

                    {/* Middle: Timing & Status Badges */}
                    <div className="flex items-center gap-3 flex-wrap">
                      {/* Check-In indicator */}
                      {attendance?.checkInTime ? (
                        <div className="flex items-center gap-1.5 bg-muted/40 px-2.5 py-1 rounded-lg border text-xs">
                          <LogIn className="h-3.5 w-3.5 text-emerald-600" />
                          <span className="font-mono font-medium">{attendance.checkInTime}</span>
                          {attendance.isLateCheckIn ? (
                            <Badge variant="destructive" className="text-[10px] px-1 py-0">Late</Badge>
                          ) : (
                            <Badge className="bg-emerald-600 text-white text-[10px] px-1 py-0">On Time</Badge>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground italic">No Check-in</span>
                      )}

                      {/* Check-Out indicator */}
                      {attendance?.checkOutTime ? (
                        <div className="flex items-center gap-1.5 bg-muted/40 px-2.5 py-1 rounded-lg border text-xs">
                          <LogOut className="h-3.5 w-3.5 text-blue-600" />
                          <span className="font-mono font-medium">{attendance.checkOutTime}</span>
                          {attendance.isOutOfTimeCheckOut ? (
                            <Badge variant="destructive" className="text-[10px] px-1 py-0">Out of Time</Badge>
                          ) : (
                            <Badge className="bg-blue-600 text-white text-[10px] px-1 py-0">On Time</Badge>
                          )}
                        </div>
                      ) : attendance?.checkInTime ? (
                        <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">On Shift Now</span>
                      ) : null}

                      {/* Overall Status Badge */}
                      {isPresent && !isLate && (
                        <Badge className="bg-emerald-600 text-white text-xs">Present</Badge>
                      )}
                      {isLate && (
                        <Badge className="bg-amber-600 text-white text-xs">Late</Badge>
                      )}
                      {isAbsent && (
                        <Badge variant="destructive" className="text-xs">Absent</Badge>
                      )}
                      {isHalfDay && (
                        <Badge className="bg-blue-600 text-white text-xs">Half Day</Badge>
                      )}
                      {isOnLeave && (
                        <Badge variant="outline" className="text-xs border-blue-400 text-blue-600">On Leave</Badge>
                      )}
                    </div>

                    {/* Right: Actions */}
                    <div className="flex items-center gap-1.5 self-end lg:self-auto shrink-0 flex-wrap">
                      {/* Check-In Button */}
                      {!attendance?.checkInTime ? (
                        <Button
                          size="sm"
                          onClick={() => handleCheckIn(staff.id)}
                          disabled={actionLoadingId === `${staff.id}_in`}
                          className="h-8 text-xs font-semibold rounded-full gap-1 bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs"
                        >
                          <LogIn className="h-3.5 w-3.5" />
                          <span>Check In</span>
                        </Button>
                      ) : null}

                      {/* Check-Out Button */}
                      {attendance?.checkInTime && !attendance?.checkOutTime ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleCheckOut(staff.id)}
                          disabled={actionLoadingId === `${staff.id}_out`}
                          className="h-8 text-xs font-semibold rounded-full gap-1 border-blue-400 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950"
                        >
                          <LogOut className="h-3.5 w-3.5" />
                          <span>Check Out</span>
                        </Button>
                      ) : null}

                      {/* Quick Status Toggles */}
                      <Button
                        size="sm"
                        variant={isAbsent ? "destructive" : "ghost"}
                        onClick={() => handleSetStatus(staff.id, "ABSENT")}
                        disabled={actionLoadingId === `${staff.id}_ABSENT`}
                        className="h-8 text-xs px-2.5 rounded-full"
                        title="Mark Absent"
                      >
                        A
                      </Button>
                      <Button
                        size="sm"
                        variant={isHalfDay ? "default" : "ghost"}
                        onClick={() => handleSetStatus(staff.id, "HALF_DAY")}
                        disabled={actionLoadingId === `${staff.id}_HALF_DAY`}
                        className="h-8 text-xs px-2.5 rounded-full"
                        title="Mark Half Day"
                      >
                        ½
                      </Button>
                      <Button
                        size="sm"
                        variant={isOnLeave ? "default" : "ghost"}
                        onClick={() => handleSetStatus(staff.id, "ON_LEAVE")}
                        disabled={actionLoadingId === `${staff.id}_ON_LEAVE`}
                        className="h-8 text-xs px-2.5 rounded-full"
                        title="Mark Leave"
                      >
                        L
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Emergency Duty Entry Dialog (Separate Action Modal) ── */}
      <Dialog open={emergencyDialogOpen} onOpenChange={setEmergencyDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-600">
              <ShieldAlert className="h-5 w-5" />
              <span>Record Emergency Duty Entry</span>
            </DialogTitle>
            <DialogDescription className="text-xs">
              Call in an employee urgently outside or beyond their scheduled shift. This enters them under Emergency Duty with immediate on-time validation.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground">Select Staff Member *</label>
              <Select value={emergencyStaffId} onValueChange={setEmergencyStaffId}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="Choose an employee..." />
                </SelectTrigger>
                <SelectContent>
                  {departmentStaff.map((st) => (
                    <SelectItem key={st.id} value={st.id} className="text-xs">
                      {st.name} ({st.role}) · {st.shiftName || "No Shift"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground">Emergency Purpose / Reason *</label>
              <Input
                placeholder="e.g. Campus power outage, water pipeline burst, urgent security backup"
                value={emergencyReason}
                onChange={(e) => setEmergencyReason(e.target.value)}
                className="h-9 text-xs"
              />
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setEmergencyDialogOpen(false)}
              className="text-xs"
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleSubmitEmergencyDuty}
              disabled={isSubmittingEmergency || !emergencyStaffId}
              className="bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold"
            >
              {isSubmittingEmergency ? "Recording..." : "Check In on Emergency Duty"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
