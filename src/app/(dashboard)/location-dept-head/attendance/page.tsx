"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  LogIn,
  LogOut,
  Search,
  AlertCircle,
  RefreshCw,
  Clock,
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
import { toast } from "@/hooks/useToast";

const EXTRA_DUTY_SHIFT_ID = "ED";
const EXTRA_DUTY_SHIFT_NAME = "Extra Duty (ED)";
const EMERGENCY_DUTY_SHIFT_ID = "EMERGENCY";
const EMERGENCY_DUTY_SHIFT_NAME = "Emergency Duty (ED)";
import { useActiveLocationDept } from "@/hooks/useActiveLocationDept";
import { istDateKey } from "@/lib/attendance/istTime";
import type {
  LocationStaffMember,
  LocationStaffAttendanceRecord,
  StaffAttendanceStatus,
  LocationShift,
} from "@/types/locationStaff";

interface RosterItem {
  staff: LocationStaffMember;
  attendance: LocationStaffAttendanceRecord | null;
}

interface Summary {
  total: number;
  marked: number;
  present: number;
  late?: number;
  absent: number;
  halfDay: number;
  onLeave: number;
  pending: number;
}

export default function LocationDeptAttendancePage() {
  const { activeDept, activeDeptId } = useActiveLocationDept();

  const [date, setDate] = useState<string>(() => istDateKey());
  const [selectedShiftId, setSelectedShiftId] = useState<string>("ALL");
  const [search, setSearch] = useState("");
  const [shifts, setShifts] = useState<LocationShift[]>([]);
  const [roster, setRoster] = useState<RosterItem[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);

  // Check-in shift picker: which staff row is expanded, and the shift chosen for it.
  const [checkInPromptId, setCheckInPromptId] = useState<string | null>(null);
  const [checkInShiftId, setCheckInShiftId] = useState<string>("");

  // Fetch shifts for active department
  useEffect(() => {
    if (!activeDeptId) return;
    fetch(`/api/location/shifts?departmentId=${activeDeptId}`)
      .then((r) => (r.ok ? r.json() : Promise.resolve({ shifts: [] })))
      .then((d) => setShifts(d.shifts ?? []))
      .catch(() => {});
  }, [activeDeptId]);

  const [refreshKey, setRefreshKey] = useState(0);
  const reload = useCallback(() => setRefreshKey((k) => k + 1), []);
  const loadAttendance = reload;

  // Load attendance data
  useEffect(() => {
    let isCancelled = false;
    if (!activeDeptId) {
      return;
    }

    const params = new URLSearchParams({
      date,
      departmentId: activeDeptId,
    });
    if (selectedShiftId !== "ALL") {
      params.set("shiftId", selectedShiftId);
    }

    fetch(`/api/location/staff-attendance?${params.toString()}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => {
        if (!isCancelled) {
          setRoster(d.roster ?? []);
          setSummary(d.summary ?? null);
        }
      })
      .catch(() => {
        if (!isCancelled) {
          toast({ variant: "destructive", title: "Failed to load attendance" });
        }
      })
      .finally(() => {
        if (!isCancelled) setIsLoading(false);
      });

    return () => {
      isCancelled = true;
    };
  }, [date, activeDeptId, selectedShiftId, refreshKey]);

  // Next / Prev day helpers
  const changeDateByDays = (offset: number) => {
    const [y, m, d] = date.split("-").map(Number);
    const current = new Date(y, m - 1, d);
    current.setDate(current.getDate() + offset);
    const ny = current.getFullYear();
    const nm = String(current.getMonth() + 1).padStart(2, "0");
    const nd = String(current.getDate()).padStart(2, "0");
    setDate(`${ny}-${nm}-${nd}`);
  };

  // Open the shift picker for a row, defaulting to the staff's own assigned shift
  const openCheckInPrompt = (staff: LocationStaffMember) => {
    setCheckInPromptId(staff.id);
    setCheckInShiftId(staff.shiftId || "");
  };

  // Confirm check-in with the chosen shift (or Extra Duty)
  const handleCheckIn = async (staffId: string) => {
    if (!checkInShiftId) {
      toast({ variant: "destructive", title: "Select a shift", description: "Choose the assigned shift, or Extra Duty (ED), to check in." });
      return;
    }
    const isEmergency = checkInShiftId === EMERGENCY_DUTY_SHIFT_ID;
    const shiftName =
      checkInShiftId === EXTRA_DUTY_SHIFT_ID
        ? EXTRA_DUTY_SHIFT_NAME
        : isEmergency
        ? EMERGENCY_DUTY_SHIFT_NAME
        : shifts.find((s) => s.id === checkInShiftId)?.name || "";

    setActionLoadingId(`${staffId}_in`);
    try {
      const res = await fetch(`/api/location/staff-attendance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "CHECK_IN",
          staffId,
          date,
          shiftId: checkInShiftId,
          shiftName,
          isEmergencyDuty: isEmergency,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to check in");

      if (data.record?.isLate) {
        toast({
          variant: "destructive",
          title: "Checked in (Late)",
          description: `Time recorded: ${data.record.checkInTime} — marked as Late.`,
        });
      } else {
        toast({ title: "Checked in", description: `Time recorded: ${data.record.checkInTime}` });
      }
      setCheckInPromptId(null);
      reload();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to check in";
      toast({ variant: "destructive", title: "Check-in failed", description: msg });
    } finally {
      setActionLoadingId(null);
    }
  };

  // Check Out action (1-tap auto time)
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
      if (!res.ok) throw new Error(data.error || "Failed to check out");

      toast({ title: "Checked out", description: `Time recorded: ${data.record.checkOutTime}` });
      reload();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to check out";
      toast({ variant: "destructive", title: "Check-out failed", description: msg });
    } finally {
      setActionLoadingId(null);
    }
  };

  // Set status: PRESENT | ABSENT | HALF_DAY | ON_LEAVE
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
      if (!res.ok) throw new Error(data.error || "Failed to set status");

      toast({ title: "Status updated", description: `Marked as ${status}` });
      reload();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Update failed";
      toast({ variant: "destructive", title: "Update failed", description: msg });
    } finally {
      setActionLoadingId(null);
    }
  };

  // Quick action: Mark all currently unmarked as present
  const handleMarkAllUnmarkedPresent = async () => {
    const unmarkedIds = roster.filter((r) => !r.attendance).map((r) => r.staff.id);
    if (unmarkedIds.length === 0) {
      toast({ title: "All staff already marked" });
      return;
    }

    try {
      const res = await fetch(`/api/location/staff-attendance`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "BULK_MARK",
          staffIds: unmarkedIds,
          status: "PRESENT",
          date,
        }),
      });
      if (!res.ok) throw new Error("Bulk update failed");
      toast({ title: "Success", description: `Marked ${unmarkedIds.length} staff as Present` });
      reload();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Bulk mark failed";
      toast({ variant: "destructive", title: "Bulk mark failed", description: msg });
    }
  };

  // Filter roster by client search
  const filteredRoster = useMemo(() => {
    if (!search.trim()) return roster;
    const q = search.toLowerCase().trim();
    return roster.filter(
      (r) =>
        r.staff.name.toLowerCase().includes(q) ||
        r.staff.role.toLowerCase().includes(q) ||
        r.staff.contactNumber.includes(q) ||
        r.staff.shiftName?.toLowerCase().includes(q)
    );
  }, [roster, search]);

  const isToday = date === istDateKey();

  return (
    <div className="space-y-4 max-w-4xl mx-auto pb-24 md:pb-8">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-card p-3 sm:p-4 rounded-xl border">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="icon" className="h-9 w-9 shrink-0">
            <Link href="/location-dept-head">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg sm:text-xl font-bold text-foreground">Staff Attendance</h1>
              {isToday && (
                <Badge variant="outline" className="text-[10px] text-emerald-600 border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/40">
                  Live Today
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
              <span>{activeDept?.name ?? "Department"}</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-auto">
          <Button variant="outline" size="sm" onClick={loadAttendance} className="h-8 w-8 p-0" title="Refresh">
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* ── Date Navigator & Shift Filter Bar ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 bg-card p-2.5 rounded-xl border shadow-xs">
        {/* Date Selector */}
        <div className="flex items-center justify-between sm:justify-start gap-2">
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" onClick={() => changeDateByDays(-1)} className="h-8 w-8 p-0">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="flex items-center gap-1.5 px-3 py-1 bg-muted/40 rounded-lg border text-xs font-semibold">
              <CalendarIcon className="h-3.5 w-3.5 text-primary" />
              <span>{date}</span>
            </div>
            <Button variant="outline" size="sm" onClick={() => changeDateByDays(1)} className="h-8 w-8 p-0">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          {!isToday && (
            <Button variant="ghost" size="sm" onClick={() => setDate(istDateKey())} className="h-7 text-xs text-primary px-2 font-medium">
              Today
            </Button>
          )}
        </div>

        {/* Shift Filter Tabs & Shift-Wise Link */}
        <div className="flex items-center gap-1 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
          <Button
            asChild
            size="sm"
            variant="secondary"
            className="h-7 text-xs px-2.5 rounded-full shrink-0 font-semibold gap-1 bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20"
          >
            <Link href="/location-dept-head/attendance/shift">
              <Clock className="h-3.5 w-3.5" />
              <span>Shift-Wise View</span>
            </Link>
          </Button>
          <Button
            size="sm"
            variant={selectedShiftId === "ALL" ? "default" : "outline"}
            className="h-7 text-xs px-2.5 rounded-full shrink-0 font-medium"
            onClick={() => setSelectedShiftId("ALL")}
          >
            All Shifts
          </Button>
          {shifts.map((s) => (
            <Button
              key={s.id}
              size="sm"
              variant={selectedShiftId === s.id ? "default" : "outline"}
              className="h-7 text-xs px-2.5 rounded-full shrink-0 font-medium gap-1"
              onClick={() => setSelectedShiftId(s.id)}
            >
              <span>{s.name}</span>
              <span className="text-[10px] opacity-70">({s.startTime})</span>
            </Button>
          ))}
        </div>
      </div>

      {/* ── Attendance Progress & Metrics ── */}
      {summary && (
        <div className="bg-card p-3 rounded-xl border space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-muted-foreground">
              Marked: <strong className="text-foreground">{summary.marked}</strong> of {summary.total}
            </span>
            {summary.pending > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleMarkAllUnmarkedPresent}
                className="h-6 text-[11px] text-primary px-2 hover:bg-primary/10"
              >
                Mark {summary.pending} pending as Present
              </Button>
            )}
          </div>

          {/* Mini Status Breakdown Chips */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-1.5 text-center text-xs">
            <div className="bg-emerald-500/10 border border-emerald-500/20 text-emerald-700 dark:text-emerald-300 py-1 px-1.5 rounded-lg">
              <span className="font-bold">{summary.present}</span> Present
            </div>
            {summary.late !== undefined && summary.late > 0 && (
              <div className="bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-300 py-1 px-1.5 rounded-lg">
                <span className="font-bold">{summary.late}</span> Late
              </div>
            )}
            <div className="bg-red-500/10 border border-red-500/20 text-red-700 dark:text-red-300 py-1 px-1.5 rounded-lg">
              <span className="font-bold">{summary.absent}</span> Absent
            </div>
            <div className="bg-blue-500/10 border border-blue-500/20 text-blue-700 dark:text-blue-300 py-1 px-1.5 rounded-lg">
              <span className="font-bold">{summary.halfDay}</span> Half Day
            </div>
            <div className="bg-purple-500/10 border border-purple-500/20 text-purple-700 dark:text-purple-300 py-1 px-1.5 rounded-lg">
              <span className="font-bold">{summary.onLeave}</span> Leave
            </div>
          </div>
        </div>
      )}

      {/* ── Search Input ── */}
      <div className="relative">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search staff by name or role..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9 h-9 text-xs rounded-xl bg-card"
        />
      </div>

      {/* ── Staff Attendance Cards List (Touch First) ── */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 rounded-xl border bg-card/60 animate-pulse" />
          ))}
        </div>
      ) : filteredRoster.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center bg-card/30">
          <AlertCircle className="h-8 w-8 text-muted-foreground mx-auto mb-2 opacity-50" />
          <p className="font-semibold text-foreground text-sm">No staff members found</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Add staff members in the Staff Roster tab to begin taking attendance.
          </p>
          <Button asChild size="sm" variant="outline" className="mt-3 text-xs rounded-full">
            <Link href="/location-dept-head/staff">Go to Staff Roster</Link>
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredRoster.map(({ staff, attendance }) => {
            const status = attendance?.status;
            const checkIn = attendance?.checkInTime;
            const checkOut = attendance?.checkOutTime;

            return (
              <Card key={staff.id} className="border-border/80 shadow-xs hover:border-primary/40 transition-colors">
                <CardContent className="p-3.5 sm:p-4">
                  <div className="flex items-start justify-between gap-3">
                    {/* Staff Profile Row */}
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="h-11 w-11 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0 overflow-hidden font-bold text-primary text-sm">
                        {staff.photoUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={staff.photoUrl} alt={staff.name} className="h-full w-full object-cover" />
                        ) : (
                          staff.name.slice(0, 2).toUpperCase()
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <h3 className="font-bold text-sm text-foreground truncate">{staff.name}</h3>
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                            {staff.role}
                          </Badge>
                        </div>
                        <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                          {staff.shiftName ? `Shift: ${staff.shiftName}` : "No assigned shift"} · {staff.contactNumber}
                        </p>
                      </div>
                    </div>

                    {/* Current Status Badge */}
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {status === "PRESENT" && !attendance?.isLate && (
                        <Badge className="bg-emerald-600 text-white text-xs px-2 py-0.5 font-semibold">
                          Present
                        </Badge>
                      )}
                      {(status === "LATE" || attendance?.isLate) && (
                        <Badge className="bg-amber-600 text-white text-xs px-2 py-0.5 font-semibold">
                          Late
                        </Badge>
                      )}
                      {status === "ABSENT" && (
                        <Badge variant="destructive" className="text-xs px-2 py-0.5 font-semibold">
                          Absent
                        </Badge>
                      )}
                      {status === "HALF_DAY" && (
                        <Badge className="bg-blue-600 text-white text-xs px-2 py-0.5 font-semibold">
                          Half Day
                        </Badge>
                      )}
                      {status === "ON_LEAVE" && (
                        <Badge className="bg-purple-600 text-white text-xs px-2 py-0.5 font-semibold">
                          Leave
                        </Badge>
                      )}
                      {attendance?.isEmergencyDuty && (
                        <Badge className="bg-amber-600 text-white text-[10px] px-1.5 py-0 font-semibold">
                          🚨 Emergency Duty
                        </Badge>
                      )}
                      {!status && (
                        <Badge variant="outline" className="text-muted-foreground text-xs px-2 py-0.5">
                          Pending
                        </Badge>
                      )}
                    </div>
                  </div>

                  {/* ── 1-Tap Auto Check-In & Check-Out Bar ── */}
                  <div className="grid grid-cols-2 gap-2 mt-3 pt-3 border-t border-border/50">
                    {/* Check In Button */}
                    <Button
                      type="button"
                      size="sm"
                      variant={checkIn ? "secondary" : "outline"}
                      disabled={actionLoadingId === `${staff.id}_in`}
                      onClick={() => openCheckInPrompt(staff)}
                      className={`h-9 text-xs justify-center gap-1.5 font-semibold rounded-lg ${
                        checkIn ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border-emerald-500/30" : "hover:border-emerald-500"
                      }`}
                    >
                      <LogIn className="h-3.5 w-3.5 text-emerald-600" />
                      {checkIn ? (
                        <span>In: <strong className="font-bold">{checkIn}</strong></span>
                      ) : (
                        <span>Tap to Check In</span>
                      )}
                    </Button>

                    {/* Check Out Button */}
                    <Button
                      type="button"
                      size="sm"
                      variant={checkOut ? "secondary" : "outline"}
                      disabled={actionLoadingId === `${staff.id}_out`}
                      onClick={() => handleCheckOut(staff.id)}
                      className={`h-9 text-xs justify-center gap-1.5 font-semibold rounded-lg ${
                        checkOut ? "bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/30" : "hover:border-blue-500"
                      }`}
                    >
                      <LogOut className="h-3.5 w-3.5 text-blue-600" />
                      {checkOut ? (
                        <span>Out: <strong className="font-bold">{checkOut}</strong></span>
                      ) : (
                        <span>Tap to Check Out</span>
                      )}
                    </Button>
                  </div>

                  {/* ── Check-In Shift Picker (required before confirming) ── */}
                  {checkInPromptId === staff.id && (
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 mt-2 p-2.5 rounded-lg border border-primary/30 bg-primary/5">
                      <Select value={checkInShiftId} onValueChange={setCheckInShiftId}>
                        <SelectTrigger className="h-8 text-xs flex-1">
                          <SelectValue placeholder="Select shift for check-in" />
                        </SelectTrigger>
                        <SelectContent>
                          {shifts.map((s) => (
                            <SelectItem key={s.id} value={s.id}>
                              {s.name} ({s.startTime} - {s.endTime})
                            </SelectItem>
                          ))}
                          <SelectItem value={EMERGENCY_DUTY_SHIFT_ID} className="text-amber-600 font-semibold">
                            🚨 {EMERGENCY_DUTY_SHIFT_NAME}
                          </SelectItem>
                          {!staff.shiftId && (
                            <SelectItem value={EXTRA_DUTY_SHIFT_ID}>{EXTRA_DUTY_SHIFT_NAME}</SelectItem>
                          )}
                        </SelectContent>
                      </Select>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-8 text-xs"
                          onClick={() => setCheckInPromptId(null)}
                        >
                          Cancel
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          className="h-8 text-xs"
                          disabled={actionLoadingId === `${staff.id}_in`}
                          onClick={() => handleCheckIn(staff.id)}
                        >
                          Confirm Check-In
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* ── Status Toggles Row ── */}
                  <div className="flex items-center justify-between gap-1 mt-2.5">
                    <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                      Status:
                    </span>
                    <div className="inline-flex rounded-lg border p-0.5 bg-muted/30 gap-0.5">
                      <Button
                        size="sm"
                        variant={status === "PRESENT" ? "default" : "ghost"}
                        className="h-6 text-[11px] px-2 font-medium"
                        onClick={() => handleSetStatus(staff.id, "PRESENT")}
                      >
                        Present
                      </Button>
                      <Button
                        size="sm"
                        variant={status === "ABSENT" ? "destructive" : "ghost"}
                        className="h-6 text-[11px] px-2 font-medium"
                        onClick={() => handleSetStatus(staff.id, "ABSENT")}
                      >
                        Absent
                      </Button>
                      <Button
                        size="sm"
                        variant={status === "HALF_DAY" ? "secondary" : "ghost"}
                        className="h-6 text-[11px] px-2 font-medium"
                        onClick={() => handleSetStatus(staff.id, "HALF_DAY")}
                      >
                        Half
                      </Button>
                      <Button
                        size="sm"
                        variant={status === "ON_LEAVE" ? "secondary" : "ghost"}
                        className="h-6 text-[11px] px-2 font-medium"
                        onClick={() => handleSetStatus(staff.id, "ON_LEAVE")}
                      >
                        Leave
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
