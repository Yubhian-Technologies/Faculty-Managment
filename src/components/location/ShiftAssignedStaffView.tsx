"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Clock,
  UserPlus,
  Users,
  ClipboardCheck,
  Search,
  ArrowRightLeft,
  UserX,
  ExternalLink,
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
import { getShiftCurrentState } from "@/lib/location/shiftTiming";
import type { LocationShift, LocationStaffMember } from "@/types/locationStaff";

interface ShiftAssignedStaffViewProps {
  shiftId: string;
  departmentId?: string;
  backHref: string;
  takeAttendanceHref?: string;
  assignMoreHref?: string;
  rosterRotationHref?: string;
  staffProfileBasePath: string;
  readOnly?: boolean;
}

export function ShiftAssignedStaffView({
  shiftId,
  departmentId,
  backHref,
  takeAttendanceHref,
  assignMoreHref,
  rosterRotationHref,
  staffProfileBasePath,
  readOnly = false,
}: ShiftAssignedStaffViewProps) {
  const [shift, setShift] = useState<LocationShift | null>(null);
  const [allShifts, setAllShifts] = useState<LocationShift[]>([]);
  const [staffList, setStaffList] = useState<LocationStaffMember[]>([]);
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isRotatingId, setIsRotatingId] = useState<string | null>(null);

  const [refreshKey, setRefreshKey] = useState(0);
  const reload = useCallback(() => setRefreshKey((k) => k + 1), []);

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
      .then(([shifts, staff]) => {
        if (isCancelled) return;
        setAllShifts(shifts);
        const current = shifts.find((s) => s.id === shiftId) ?? null;
        setShift(current);
        // Filter staff assigned to this shift
        setStaffList(staff.filter((s) => s.shiftId === shiftId));
      })
      .catch(() => {
        if (!isCancelled) toast({ variant: "destructive", title: "Failed to load shift details" });
      })
      .finally(() => {
        if (!isCancelled) setIsLoading(false);
      });

    return () => {
      isCancelled = true;
    };
  }, [shiftId, departmentId, refreshKey]);

  // Handle single staff switch / rotation
  const handleRotateStaff = async (staffId: string, targetShiftId: string) => {
    setIsRotatingId(staffId);
    try {
      const res = await fetch(`/api/location/shifts/rotate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          staffId,
          targetShiftId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to switch shift");

      toast({
        title: "Shift Updated",
        description: `Staff member moved to ${data.targetShiftName}.`,
      });
      reload();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to switch shift";
      toast({ variant: "destructive", title: "Error", description: msg });
    } finally {
      setIsRotatingId(null);
    }
  };

  // Filtered staff by search
  const filteredStaff = useMemo(() => {
    if (!search.trim()) return staffList;
    const q = search.toLowerCase().trim();
    return staffList.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.role?.toLowerCase().includes(q) ||
        s.contactNumber?.includes(q) ||
        s.aadhaar?.includes(q)
    );
  }, [staffList, search]);

  const shiftStatus = shift ? getShiftCurrentState(shift.startTime, shift.endTime) : "ACTIVE";

  return (
    <div className="space-y-4 max-w-5xl mx-auto pb-24 md:pb-8">
      {/* ── Top Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-card p-4 rounded-xl border shadow-xs">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="icon" className="h-9 w-9 shrink-0">
            <Link href={backHref}>
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg sm:text-xl font-bold text-foreground">
                {shift?.name ?? "Shift Roster"}
              </h1>
              {shiftStatus === "ACTIVE" && (
                <Badge className="bg-emerald-600 text-white text-[11px] gap-1 px-2 py-0.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />
                  Active Shift Now
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2">
              <span>{shift?.departmentName || "Department"}</span>
              <span>•</span>
              <span className="font-mono font-medium">{shift?.startTime} – {shift?.endTime}</span>
              <span>•</span>
              <span>Grace: {shift?.gracePeriodMinutes ?? 15}m</span>
            </p>
          </div>
        </div>

        {!readOnly && (
          <div className="flex flex-wrap items-center gap-2">
            {takeAttendanceHref && (
              <Button asChild size="sm" variant="default" className="rounded-full gap-1.5 text-xs font-semibold shadow-xs">
                <Link href={takeAttendanceHref}>
                  <ClipboardCheck className="h-4 w-4" />
                  <span>Take Attendance</span>
                </Link>
              </Button>
            )}
            {assignMoreHref && (
              <Button asChild size="sm" variant="outline" className="rounded-full gap-1.5 text-xs font-semibold">
                <Link href={assignMoreHref}>
                  <UserPlus className="h-4 w-4" />
                  <span>Assign More Staff</span>
                </Link>
              </Button>
            )}
            {rosterRotationHref && (
              <Button asChild size="sm" variant="outline" className="rounded-full gap-1.5 text-xs font-semibold">
                <Link href={rosterRotationHref}>
                  <ArrowRightLeft className="h-4 w-4" />
                  <span>Rotate Roster</span>
                </Link>
              </Button>
            )}
          </div>
        )}
      </div>

      {/* ── Shift Summary Card ── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="border shadow-xs">
          <CardContent className="p-3 sm:p-4">
            <span className="text-[11px] font-semibold text-muted-foreground uppercase">Assigned Staff</span>
            <p className="text-2xl font-bold text-foreground mt-1">{staffList.length}</p>
          </CardContent>
        </Card>
        <Card className="border shadow-xs">
          <CardContent className="p-3 sm:p-4">
            <span className="text-[11px] font-semibold text-muted-foreground uppercase">Shift Hours</span>
            <p className="text-base font-bold font-mono text-foreground mt-1.5">
              {shift ? `${shift.startTime} – ${shift.endTime}` : "—"}
            </p>
          </CardContent>
        </Card>
        <Card className="border shadow-xs">
          <CardContent className="p-3 sm:p-4">
            <span className="text-[11px] font-semibold text-muted-foreground uppercase">On-Time Cutoff</span>
            <p className="text-sm font-semibold text-foreground mt-1.5">
              +{shift?.gracePeriodMinutes ?? 15} mins grace
            </p>
          </CardContent>
        </Card>
        <Card className="border shadow-xs">
          <CardContent className="p-3 sm:p-4">
            <span className="text-[11px] font-semibold text-muted-foreground uppercase">Department</span>
            <p className="text-sm font-semibold text-foreground mt-1.5 truncate">
              {shift?.departmentName || "All Departments"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* ── Search & Staff List ── */}
      <Card className="border shadow-xs">
        <CardContent className="p-4 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search staff by name or role..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 h-9 text-xs"
              />
            </div>
            <span className="text-xs text-muted-foreground">
              Showing {filteredStaff.length} of {staffList.length} assigned staff
            </span>
          </div>

          {isLoading ? (
            <div className="space-y-2 py-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-16 rounded-xl border bg-muted/30 animate-pulse" />
              ))}
            </div>
          ) : filteredStaff.length === 0 ? (
            <div className="rounded-xl border border-dashed p-8 text-center bg-card/30">
              <Users className="h-8 w-8 text-muted-foreground mx-auto mb-2 opacity-50" />
              <p className="font-semibold text-foreground text-sm">
                {search ? "No matching staff found" : "No staff assigned to this shift yet"}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Assign campus staff members to this shift or rotate them from other shifts.
              </p>
              {!readOnly && assignMoreHref && (
                <Button asChild size="sm" variant="outline" className="mt-3 text-xs rounded-full gap-1.5">
                  <Link href={assignMoreHref}>
                    <UserPlus className="h-3.5 w-3.5" />
                    <span>Assign Staff Now</span>
                  </Link>
                </Button>
              )}
            </div>
          ) : (
            <div className="divide-y border rounded-xl overflow-hidden bg-card">
              {filteredStaff.map((staff) => (
                <div
                  key={staff.id}
                  className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-muted/30 transition-colors"
                >
                  {/* Left: Avatar & Info */}
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
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm text-foreground truncate">{staff.name}</span>
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-primary/30 text-primary">
                          {staff.role}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">
                        <span>📱 {staff.contactNumber}</span>
                        {staff.aadhaar && <span> · Aadhaar: ••••{staff.aadhaar.slice(-4)}</span>}
                        {staff.payeeVoucher && <span> · {staff.payeeVoucher}</span>}
                      </p>
                    </div>
                  </div>

                  {/* Right: Quick Switch Shift & View Profile */}
                  <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
                    {!readOnly ? (
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] text-muted-foreground whitespace-nowrap hidden lg:inline">
                          Switch Shift:
                        </span>
                        <Select
                          value={staff.shiftId || shiftId}
                          onValueChange={(val) => handleRotateStaff(staff.id, val)}
                          disabled={isRotatingId === staff.id}
                        >
                          <SelectTrigger className="h-8 w-36 sm:w-44 text-xs">
                            <SelectValue placeholder="Rotate to..." />
                          </SelectTrigger>
                          <SelectContent>
                            {allShifts.map((s) => (
                              <SelectItem key={s.id} value={s.id} className="text-xs">
                                {s.name} ({s.startTime}–{s.endTime})
                              </SelectItem>
                            ))}
                            <SelectItem value="__unassigned__" className="text-xs text-destructive">
                              Remove from Shift
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    ) : (
                      <Badge variant="outline" className="text-xs bg-muted/40 font-mono">
                        {shift?.name}
                      </Badge>
                    )}

                    <Button asChild variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" title="View Profile">
                      <Link href={`${staffProfileBasePath}/${staff.id}`}>
                        <ExternalLink className="h-4 w-4" />
                      </Link>
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
