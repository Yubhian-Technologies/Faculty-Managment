"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRightLeft,
  Clock,
  Plus,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import type { LocationDepartment, LocationShift, LocationStaffMember } from "@/types/locationStaff";

export default function LocationStaffAdminShiftsPage() {
  const [departments, setDepartments] = useState<LocationDepartment[]>([]);
  const [selectedDeptId, setSelectedDeptId] = useState<string>("ALL");
  const [shifts, setShifts] = useState<LocationShift[]>([]);
  const [staffList, setStaffList] = useState<LocationStaffMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [refreshKey, setRefreshKey] = useState(0);
  const reload = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    let isCancelled = false;

    Promise.all([
      fetch("/api/location/departments")
        .then((r) => (r.ok ? r.json() : Promise.resolve({ departments: [] })))
        .then((d) => (d.departments as LocationDepartment[] | undefined) ?? []),
      fetch("/api/location/shifts")
        .then((r) => (r.ok ? r.json() : Promise.resolve({ shifts: [] })))
        .then((d) => (d.shifts as LocationShift[] | undefined) ?? []),
      fetch("/api/location/staff?status=ACTIVE")
        .then((r) => (r.ok ? r.json() : Promise.resolve({ staff: [] })))
        .then((d) => (d.staff as LocationStaffMember[] | undefined) ?? []),
    ])
      .then(([deptData, shiftData, staffData]) => {
        if (isCancelled) return;
        setDepartments(deptData);
        setShifts(shiftData);
        setStaffList(staffData);
      })
      .catch(() => {
        if (!isCancelled) toast({ variant: "destructive", title: "Failed to load shifts" });
      })
      .finally(() => {
        if (!isCancelled) setIsLoading(false);
      });

    return () => {
      isCancelled = true;
    };
  }, [refreshKey]);

  // Delete shift
  const handleDeleteShift = async (shiftId: string, shiftName: string) => {
    if (!confirm(`Are you sure you want to delete shift "${shiftName}"?`)) return;

    try {
      const res = await fetch(`/api/location/shifts/${shiftId}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete shift");

      toast({ title: "Deleted", description: `Removed shift ${shiftName}` });
      reload();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to delete shift";
      toast({ variant: "destructive", title: "Error", description: msg });
    }
  };

  const filteredShifts = useMemo(() => {
    if (selectedDeptId === "ALL") return shifts;
    return shifts.filter((s) => s.departmentId === selectedDeptId);
  }, [shifts, selectedDeptId]);

  return (
    <div className="space-y-4 max-w-5xl mx-auto pb-24 md:pb-8">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-card p-4 rounded-xl border shadow-xs">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="icon" className="h-9 w-9 shrink-0">
            <Link href="/location-staff-admin">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div>
            <h1 className="text-lg sm:text-xl font-bold text-foreground flex items-center gap-2">
              <Clock className="h-5 w-5 text-primary" />
              <span>Campus Shifts Configuration</span>
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Create and manage shift working hours and grace periods for campus departments. Department Heads assign staff and manage rosters.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-auto">
          <Button
            asChild
            size="sm"
            className="rounded-full gap-1.5 h-9 text-xs font-semibold px-4 shadow-xs"
          >
            <Link href="/location-staff-admin/shifts/new">
              <Plus className="h-4 w-4" />
              <span>Create Shift</span>
            </Link>
          </Button>
        </div>
      </div>

      {/* ── Filter Bar ── */}
      <div className="flex items-center justify-between gap-3 bg-card p-3 rounded-xl border">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-muted-foreground">Department:</span>
          <Select value={selectedDeptId} onValueChange={setSelectedDeptId}>
            <SelectTrigger className="h-8 w-44 sm:w-56 text-xs">
              <SelectValue placeholder="All Departments" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All Departments ({shifts.length} Shifts)</SelectItem>
              {departments.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <span className="text-xs text-muted-foreground">
          Showing {filteredShifts.length} of {shifts.length} shifts
        </span>
      </div>

      {/* ── Shifts List ── */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-36 rounded-xl border bg-card/60 animate-pulse" />
          ))}
        </div>
      ) : filteredShifts.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center bg-card/30">
          <Clock className="h-8 w-8 text-muted-foreground mx-auto mb-2 opacity-50" />
          <p className="font-semibold text-foreground text-sm">No shifts found</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Create shifts for campus departments to begin organizing staff schedules.
          </p>
          <Button asChild size="sm" variant="outline" className="mt-3 text-xs rounded-full">
            <Link href="/location-staff-admin/shifts/new">Create First Shift</Link>
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {filteredShifts.map((shift) => {
            const assignedMembers = staffList.filter((s) => s.shiftId === shift.id);

            return (
              <Card key={shift.id} className="border-border/80 shadow-xs flex flex-col justify-between">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-bold text-base text-foreground flex items-center gap-1.5">
                          <Clock className="h-4 w-4 text-primary" />
                          <span>{shift.name}</span>
                        </h3>
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                          {shift.departmentName || "General"}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2 mt-1.5">
                        <Badge variant="outline" className="text-xs font-mono font-semibold bg-primary/5 text-primary border-primary/20">
                          {shift.startTime} – {shift.endTime}
                        </Badge>
                        <span className="text-[11px] text-muted-foreground">
                          Grace: {shift.gracePeriodMinutes ?? 15}m
                        </span>
                      </div>
                    </div>

                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDeleteShift(shift.id, shift.name)}
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      title="Delete shift"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>

                  {/* Assigned Members Summary (Managed by Dept Head) */}
                  <div className="pt-2 border-t border-border/50 flex items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <Users className="h-3.5 w-3.5 text-primary" />
                      <span>{assignedMembers.length} Staff assigned by Dept Head</span>
                    </div>

                    <Button
                      asChild
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs rounded-full px-2.5 text-muted-foreground hover:text-foreground"
                    >
                      <Link href={`/location-staff-admin/shifts/${shift.id}/staff`}>
                        <span>View Staff</span>
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
  );
}
