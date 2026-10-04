"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Clock,
  Users,
  UserPlus,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/useToast";
import { useActiveLocationDept } from "@/hooks/useActiveLocationDept";
import type { LocationShift, LocationStaffMember } from "@/types/locationStaff";

export default function LocationShiftsPage() {
  const { activeDept, activeDeptId } = useActiveLocationDept();

  const [shifts, setShifts] = useState<LocationShift[]>([]);
  const [staffList, setStaffList] = useState<LocationStaffMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [refreshKey, setRefreshKey] = useState(0);
  const reload = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    let isCancelled = false;
    if (!activeDeptId) {
      return;
    }

    Promise.all([
      fetch(`/api/location/shifts?departmentId=${activeDeptId}`)
        .then((r) => (r.ok ? r.json() : Promise.resolve({ shifts: [] })))
        .then((d) => {
          if (!isCancelled) setShifts(d.shifts ?? []);
        }),
      fetch(`/api/location/staff?departmentId=${activeDeptId}&status=ACTIVE`)
        .then((r) => (r.ok ? r.json() : Promise.resolve({ staff: [] })))
        .then((d) => {
          if (!isCancelled) setStaffList(d.staff ?? []);
        }),
    ])
      .catch(() => {
        if (!isCancelled) toast({ variant: "destructive", title: "Failed to load shifts" });
      })
      .finally(() => {
        if (!isCancelled) setIsLoading(false);
      });

    return () => {
      isCancelled = true;
    };
  }, [activeDeptId, refreshKey]);

  return (
    <div className="space-y-4 max-w-4xl mx-auto pb-24 md:pb-8">
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-card p-3 sm:p-4 rounded-xl border">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="icon" className="h-9 w-9 shrink-0">
            <Link aria-label="Back" href="/location-dept-head">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div>
            <h1 className="text-lg sm:text-xl font-bold text-foreground">Department Shift Schedule</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              <span>{activeDept?.name ?? "Department"}</span> · Assign staff members and take attendance for campus-configured shifts.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-end sm:self-auto">
          <Button
            asChild
            size="sm"
            variant="outline"
            className="rounded-full gap-1.5 h-9 text-xs font-semibold px-3"
          >
            <Link href="/location-dept-head/shifts/roster">
              <Users className="h-4 w-4" />
              <span>Rotate Roster</span>
            </Link>
          </Button>
          <Button
            asChild
            size="sm"
            variant="outline"
            className="rounded-full gap-1.5 h-9 text-xs font-semibold px-3"
          >
            <Link href="/location-dept-head/attendance/shift">
              <Clock className="h-4 w-4 text-primary" />
              <span>Shift Attendance</span>
            </Link>
          </Button>
        </div>
      </div>

      {/* ── Shifts List ── */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[1, 2].map((i) => (
            <div key={i} className="h-32 rounded-xl border bg-card/60 animate-pulse" />
          ))}
        </div>
      ) : shifts.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center bg-card/30">
          <Clock className="h-8 w-8 text-muted-foreground mx-auto mb-2 opacity-50" />
          <p className="font-semibold text-foreground text-sm">No shifts configured for this department</p>
          <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
            Shifts are configured and scheduled by the Location Staff Admin. Once created, they will automatically appear here for staff assignment, roster rotation, and attendance.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {shifts.map((shift) => {
            const assignedMembers = staffList.filter((s) => s.shiftId === shift.id);

            return (
              <Card key={shift.id} className="border-border/80 shadow-xs flex flex-col justify-between">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="font-bold text-base text-foreground flex items-center gap-1.5">
                        <Clock className="h-4 w-4 text-primary" />
                        <span>{shift.name}</span>
                      </h3>
                      <div className="flex items-center gap-2 mt-1">
                        <Badge variant="outline" className="text-xs font-mono font-semibold bg-primary/5 text-primary border-primary/20">
                          {shift.startTime} – {shift.endTime}
                        </Badge>
                        <span className="text-[11px] text-muted-foreground">
                          Grace: {shift.gracePeriodMinutes ?? 15}m
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Assigned Members Summary & Action Links */}
                  <div className="pt-2 border-t border-border/50 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <Link
                      href={`/location-dept-head/shifts/${shift.id}/staff`}
                      className="font-medium text-primary hover:underline flex items-center gap-1"
                    >
                      <Users className="h-3.5 w-3.5" />
                      <span>{assignedMembers.length} Staff (View List)</span>
                    </Link>

                    <div className="flex items-center gap-1.5">
                      <Button
                        asChild
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs rounded-full px-2 text-muted-foreground hover:text-foreground"
                      >
                        <Link href={`/location-dept-head/attendance/shift?shiftId=${shift.id}`}>
                          <span>Attendance</span>
                        </Link>
                      </Button>
                      <Button
                        asChild
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs rounded-full gap-1 px-2.5"
                      >
                        <Link href={`/location-dept-head/shifts/${shift.id}/assign`}>
                          <UserPlus className="h-3 w-3" />
                          <span>Assign</span>
                        </Link>
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
