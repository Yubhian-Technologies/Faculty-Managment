"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Clock,
  Plus,
  Users,
  Trash2,
  UserPlus,
  Check,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import { useActiveLocationDept } from "@/hooks/useActiveLocationDept";
import { LocationDeptSwitcher } from "@/components/layout/LocationDeptSwitcher";
import type { LocationShift, LocationStaffMember } from "@/types/locationStaff";

export default function LocationShiftsPage() {
  const { activeDept, activeDeptId } = useActiveLocationDept();

  const [shifts, setShifts] = useState<LocationShift[]>([]);
  const [staffList, setStaffList] = useState<LocationStaffMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Create shift modal
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [name, setName] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("17:00");
  const [gracePeriod, setGracePeriod] = useState("15");
  const [description, setDescription] = useState("");

  // Assign staff modal
  const [assignShift, setAssignShift] = useState<LocationShift | null>(null);
  const [selectedStaffIds, setSelectedStaffIds] = useState<string[]>([]);
  const [isAssigning, setIsAssigning] = useState(false);

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

  // Create shift
  const handleCreateShift = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeDeptId) return;

    if (!name.trim() || !startTime || !endTime) {
      toast({ variant: "destructive", title: "Missing fields", description: "Name, start time, and end time are required." });
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/location/shifts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          departmentId: activeDeptId,
          name: name.trim(),
          startTime,
          endTime,
          gracePeriodMinutes: Number(gracePeriod) || 15,
          description: description.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create shift");

      toast({ title: "Shift created", description: `${name} has been added.` });
      setIsCreateOpen(false);
      setName("");
      setDescription("");
      reload();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to create shift";
      toast({ variant: "destructive", title: "Error", description: msg });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Open assign modal
  const openAssignModal = (shift: LocationShift) => {
    setAssignShift(shift);
    // Find all staff currently assigned to this shift
    const assigned = staffList.filter((s) => s.shiftId === shift.id).map((s) => s.id);
    setSelectedStaffIds(assigned);
  };

  // Toggle staff selection for assignment
  const toggleStaffSelection = (id: string) => {
    setSelectedStaffIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  // Save shift assignments
  const handleSaveAssignments = async () => {
    if (!assignShift) return;

    setIsAssigning(true);
    try {
      // Find staff previously assigned who were unchecked
      const previouslyAssigned = staffList.filter((s) => s.shiftId === assignShift.id).map((s) => s.id);
      const unassigned = previouslyAssigned.filter((id) => !selectedStaffIds.includes(id));

      const res = await fetch(`/api/location/shifts/${assignShift.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assignedStaffIds: selectedStaffIds,
          unassignedStaffIds: unassigned,
        }),
      });

      if (!res.ok) throw new Error("Failed to update assignments");

      toast({ title: "Updated", description: `Assigned ${selectedStaffIds.length} staff to ${assignShift.name}` });
      setAssignShift(null);
      reload();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to update assignments";
      toast({ variant: "destructive", title: "Error", description: msg });
    } finally {
      setIsAssigning(false);
    }
  };

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
            <h1 className="text-lg sm:text-xl font-bold text-foreground">Shift Schedule</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              <span>{activeDept?.name ?? "Department"}</span> · {shifts.length} Active Shifts
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-auto">
          <LocationDeptSwitcher />
          <Button
            size="sm"
            onClick={() => setIsCreateOpen(true)}
            className="rounded-full gap-1.5 h-9 text-xs font-semibold px-4 shadow-sm"
          >
            <Plus className="h-4 w-4" />
            <span>Create Shift</span>
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
          <p className="font-semibold text-foreground text-sm">No shifts configured</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Create shifts (e.g. Morning, General, Night) and assign staff members to schedule attendance.
          </p>
          <Button size="sm" variant="outline" onClick={() => setIsCreateOpen(true)} className="mt-3 text-xs rounded-full">
            Create First Shift
          </Button>
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
                        {shift.gracePeriodMinutes && (
                          <span className="text-[11px] text-muted-foreground">
                            +{shift.gracePeriodMinutes}m grace
                          </span>
                        )}
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

                  {shift.description && (
                    <p className="text-xs text-muted-foreground">{shift.description}</p>
                  )}

                  {/* Assigned Members Summary */}
                  <div className="pt-2 border-t border-border/50 flex items-center justify-between text-xs">
                    <span className="font-medium text-muted-foreground flex items-center gap-1">
                      <Users className="h-3.5 w-3.5" />
                      <span>{assignedMembers.length} Staff Assigned</span>
                    </span>

                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => openAssignModal(shift)}
                      className="h-7 text-xs rounded-full gap-1"
                    >
                      <UserPlus className="h-3.5 w-3.5" />
                      <span>Assign Staff</span>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* ── Create Shift Dialog ── */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="max-w-md p-5">
          <DialogHeader>
            <DialogTitle className="text-lg font-bold">Create Shift</DialogTitle>
            <DialogDescription className="text-xs">
              Configure shift timing for {activeDept?.name ?? "Department"}.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateShift} className="space-y-3 pt-2">
            <div className="space-y-1">
              <Label className="text-xs font-semibold">Shift Name *</Label>
              <Input
                required
                placeholder="e.g. Morning Shift, Night Shift"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-9 text-xs"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs font-semibold">Start Time (24h) *</Label>
                <Input
                  required
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="h-9 text-xs"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-semibold">End Time (24h) *</Label>
                <Input
                  required
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="h-9 text-xs"
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-semibold">Grace Period (Minutes)</Label>
              <Input
                type="number"
                min={0}
                max={60}
                value={gracePeriod}
                onChange={(e) => setGracePeriod(e.target.value)}
                className="h-9 text-xs"
              />
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-semibold">Description (Optional)</Label>
              <Input
                placeholder="e.g. Gate 1 and perimeter rotation"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="h-9 text-xs"
              />
            </div>

            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setIsCreateOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={isSubmitting}>
                {isSubmitting ? "Creating..." : "Create Shift"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Assign Staff Dialog ── */}
      <Dialog open={Boolean(assignShift)} onOpenChange={(open) => !open && setAssignShift(null)}>
        <DialogContent className="max-w-md max-h-[85vh] flex flex-col p-5">
          <DialogHeader>
            <DialogTitle className="text-base font-bold">
              Assign Staff · {assignShift?.name}
            </DialogTitle>
            <DialogDescription className="text-xs">
              Select which staff members are assigned to this shift ({assignShift?.startTime} - {assignShift?.endTime}).
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto space-y-1.5 py-2">
            {staffList.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-4">No active staff members.</p>
            ) : (
              staffList.map((staff) => {
                const isSelected = selectedStaffIds.includes(staff.id);
                const isDifferentShift = staff.shiftId && staff.shiftId !== assignShift?.id;

                return (
                  <div
                    key={staff.id}
                    onClick={() => toggleStaffSelection(staff.id)}
                    className={`flex items-center justify-between p-2.5 rounded-lg border cursor-pointer transition-colors text-xs ${
                      isSelected
                        ? "bg-primary/10 border-primary font-semibold"
                        : "hover:bg-muted/40 border-border/70"
                    }`}
                  >
                    <div>
                      <p className="font-semibold text-foreground">{staff.name}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {staff.role} {isDifferentShift && `· Currently: ${staff.shiftName}`}
                      </p>
                    </div>

                    <div
                      className={`h-5 w-5 rounded-full border flex items-center justify-center ${
                        isSelected ? "bg-primary border-primary text-primary-foreground" : "border-muted-foreground/40"
                      }`}
                    >
                      {isSelected && <Check className="h-3 w-3" />}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <DialogFooter className="pt-2">
            <Button variant="outline" size="sm" onClick={() => setAssignShift(null)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleSaveAssignments} disabled={isAssigning}>
              {isAssigning ? "Saving..." : `Assign (${selectedStaffIds.length})`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
