"use client";

import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Clock,
  Plus,
  Trash2,
  Users,
  Globe,
  Link2,
  Edit2,
  ChevronRight,
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
  const [shiftToDelete, setShiftToDelete] = useState<{ id: string; name: string } | null>(null);
  const handleDeleteShift = (shiftId: string, shiftName: string) => setShiftToDelete({ id: shiftId, name: shiftName });
  const deleteShift = async (shiftId: string, shiftName: string) => {
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
    return shifts.filter((s) => {
      if (s.isCampusWide || s.departmentId === "ALL" || (Array.isArray(s.departmentIds) && s.departmentIds.includes("ALL"))) {
        return true;
      }
      if (s.departmentId === selectedDeptId) return true;
      if (Array.isArray(s.departmentIds) && s.departmentIds.includes(selectedDeptId)) return true;
      return false;
    });
  }, [shifts, selectedDeptId]);

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-24 md:pb-12 animate-in fade-in duration-300">
      {/* ── Google Enterprise Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-card/90 backdrop-blur-sm p-5 sm:p-6 rounded-3xl border border-border/60 shadow-xs">
        <div className="flex items-center gap-3.5">
          <Button asChild variant="ghost" size="icon" className="h-10 w-10 rounded-full hover:bg-muted/80 shrink-0">
            <Link aria-label="Back" href="/location-staff-admin">
              <ArrowLeft className="h-5 w-5 text-foreground" />
            </Link>
          </Button>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20 text-[11px] font-semibold px-2.5 py-0.5 rounded-full">
                Shift Management
              </Badge>
              <span className="text-xs text-muted-foreground hidden sm:inline">
                {shifts.length} Active {shifts.length === 1 ? "Shift" : "Shifts"}
              </span>
            </div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">
              Campus Shifts Configuration
            </h1>
            <p className="text-xs sm:text-sm text-muted-foreground mt-0.5">
              Create and manage shift duty hours, grace windows, and multi-department assignments across campus.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <Button
            asChild
            size="default"
            className="rounded-full gap-2 h-10 text-xs font-semibold px-5 shadow-xs hover:shadow transition-all bg-primary text-primary-foreground hover:bg-primary/95"
          >
            <Link href="/location-staff-admin/shifts/new">
              <Plus className="h-4 w-4" />
              <span>Create Shift</span>
            </Link>
          </Button>
        </div>
      </div>

      {/* ── Google Filter Bar ── */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-card/80 backdrop-blur-sm p-3.5 sm:p-4 rounded-3xl border border-border/60 shadow-xs">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-muted-foreground ml-1">Filter by Department:</span>
          <Select value={selectedDeptId} onValueChange={setSelectedDeptId}>
            <SelectTrigger className="h-10 w-52 sm:w-64 text-xs rounded-full border-border/60 bg-muted/30 focus:bg-background">
              <SelectValue placeholder="All Departments" />
            </SelectTrigger>
            <SelectContent className="rounded-2xl">
              <SelectItem value="ALL">All Departments ({shifts.length} Shifts)</SelectItem>
              {departments.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <span className="text-xs text-muted-foreground px-2">
          Showing {filteredShifts.length} of {shifts.length} shifts
        </span>
      </div>

      {/* ── Shifts Grid ── */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-44 rounded-3xl border border-border/50 bg-card/60 animate-pulse" />
          ))}
        </div>
      ) : filteredShifts.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-border/80 p-12 text-center bg-card/40">
          <div className="h-14 w-14 rounded-2xl bg-muted/60 text-muted-foreground flex items-center justify-center mx-auto mb-3">
            <Clock className="h-7 w-7 opacity-70" />
          </div>
          <h3 className="font-bold text-foreground text-base">No shifts found</h3>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1 max-w-sm mx-auto">
            Create shifts for campus departments to begin organizing staff schedules.
          </p>
          <Button asChild size="sm" className="mt-4 text-xs font-semibold rounded-full px-5">
            <Link href="/location-staff-admin/shifts/new">
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              Create First Shift
            </Link>
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredShifts.map((shift) => {
            const assignedMembers = staffList.filter((s) => s.shiftId === shift.id);
            const isCampusWide = !!shift.isCampusWide || shift.departmentId === "ALL" || (Array.isArray(shift.departmentIds) && shift.departmentIds.includes("ALL"));
            const isShared = !isCampusWide && Array.isArray(shift.departmentIds) && shift.departmentIds.length > 1;

            return (
              <Card key={shift.id} className="rounded-3xl border-border/60 shadow-xs hover:shadow-md hover:border-primary/40 transition-all duration-200 bg-card overflow-hidden flex flex-col justify-between group">
                <CardContent className="p-5 space-y-3.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="h-11 w-11 rounded-2xl bg-primary/10 text-primary flex items-center justify-center font-bold text-sm shrink-0 shadow-xs group-hover:scale-105 transition-transform">
                        <Clock className="h-5 w-5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <h3 className="font-bold text-base text-foreground truncate">{shift.name}</h3>
                          {isCampusWide ? (
                            <Badge className="bg-purple-500/10 text-purple-600 border-purple-500/20 text-[10px] px-2 py-0.5 rounded-full gap-1">
                              <Globe className="h-2.5 w-2.5" />
                              <span>Campus-Wide</span>
                            </Badge>
                          ) : isShared ? (
                            <Badge className="bg-blue-500/10 text-blue-600 border-blue-500/20 text-[10px] px-2 py-0.5 rounded-full gap-1">
                              <Link2 className="h-2.5 w-2.5" />
                              <span>Shared ({shift.departmentIds?.length})</span>
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px] px-2 py-0.5 rounded-full text-muted-foreground bg-muted/40">
                              {shift.departmentName || "Dedicated"}
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-1.5">
                          <Badge variant="outline" className="text-xs font-mono font-semibold bg-primary/5 text-primary border-primary/20 px-2 py-0.5 rounded-full">
                            {shift.startTime} – {shift.endTime}
                          </Badge>
                          <span className="text-[11px] text-muted-foreground">
                            Grace: {shift.gracePeriodMinutes ?? 15}m
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-0.5 shrink-0 opacity-80 group-hover:opacity-100 transition-opacity">
                      <Button
                        asChild
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted"
                        title="Edit Shift"
                      >
                        <Link href={`/location-staff-admin/shifts/${shift.id}/edit`}>
                          <Edit2 className="h-3.5 w-3.5" />
                        </Link>
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDeleteShift(shift.id, shift.name)}
                        className="h-8 w-8 rounded-full text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                        title="Delete Shift"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>

                  {/* Assigned Members Summary */}
                  <div className="pt-3 border-t border-border/40 flex items-center justify-between gap-2 text-xs">
                    <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground bg-muted/40 px-3 py-1 rounded-full border border-border/40">
                      <Users className="h-3.5 w-3.5 text-primary" />
                      <span>{assignedMembers.length} Assigned Staff</span>
                    </div>

                    <Button
                      asChild
                      size="sm"
                      variant="ghost"
                      className="h-8 text-xs font-semibold rounded-full px-3 text-primary hover:bg-primary/10 gap-1"
                    >
                      <Link href={`/location-staff-admin/shifts/${shift.id}/staff`}>
                        <span>View Staff</span>
                        <ChevronRight className="h-3.5 w-3.5" />
                      </Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
      <ConfirmDialog
        open={!!shiftToDelete}
        onOpenChange={(o) => { if (!o) setShiftToDelete(null); }}
        title={`Delete shift "${shiftToDelete?.name ?? ""}"?`}
        description="This cannot be undone."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={async () => {
          const target = shiftToDelete;
          setShiftToDelete(null);
          if (target) await deleteShift(target.id, target.name);
        }}
      />
    </div>
  );
}

