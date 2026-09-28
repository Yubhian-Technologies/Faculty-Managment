"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Check, UserPlus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/useToast";
import type { LocationShift, LocationStaffMember } from "@/types/locationStaff";

export default function LocationStaffAdminAssignShiftPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();

  const [shift, setShift] = useState<LocationShift | null>(null);
  const [staffList, setStaffList] = useState<LocationStaffMember[]>([]);
  const [selectedStaffIds, setSelectedStaffIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let isCancelled = false;

    Promise.all([
      fetch("/api/location/shifts")
        .then((r) => (r.ok ? r.json() : Promise.resolve({ shifts: [] })))
        .then((d) => (d.shifts as LocationShift[] | undefined) ?? []),
      fetch("/api/location/staff?status=ACTIVE")
        .then((r) => (r.ok ? r.json() : Promise.resolve({ staff: [] })))
        .then((d) => (d.staff as LocationStaffMember[] | undefined) ?? []),
    ])
      .then(([shifts, staff]) => {
        if (isCancelled) return;
        const found = shifts.find((s) => s.id === params.id) ?? null;
        setShift(found);

        // Filter staff of the shift's departments (or all staff if campus-wide / no department)
        const isCampus = !!found?.isCampusWide || found?.departmentId === "ALL" || (Array.isArray(found?.departmentIds) && found.departmentIds.includes("ALL"));
        const shiftDepts = Array.isArray(found?.departmentIds) && found.departmentIds.length > 0
          ? found.departmentIds
          : found?.departmentId
          ? [found.departmentId]
          : [];

        const relevantStaff = isCampus
          ? staff
          : shiftDepts.length > 0
          ? staff.filter((s) => shiftDepts.includes(s.departmentId))
          : staff;

        setStaffList(relevantStaff);
        setSelectedStaffIds(relevantStaff.filter((s) => s.shiftId === params.id).map((s) => s.id));
      })
      .catch(() => {
        if (!isCancelled) toast({ variant: "destructive", title: "Failed to load shift" });
      })
      .finally(() => {
        if (!isCancelled) setIsLoading(false);
      });

    return () => {
      isCancelled = true;
    };
  }, [params.id]);

  const toggleStaffSelection = (id: string) => {
    setSelectedStaffIds((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]));
  };

  const handleSave = async () => {
    if (!shift) return;
    setIsSaving(true);
    try {
      const previouslyAssigned = staffList.filter((s) => s.shiftId === shift.id).map((s) => s.id);
      const unassigned = previouslyAssigned.filter((id) => !selectedStaffIds.includes(id));

      const res = await fetch(`/api/location/shifts/${shift.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assignedStaffIds: selectedStaffIds,
          unassignedStaffIds: unassigned,
        }),
      });
      if (!res.ok) throw new Error("Failed to update assignments");

      toast({ title: "Updated", description: `Assigned ${selectedStaffIds.length} staff to ${shift.name}` });
      router.push(`/location-staff-admin/shifts/${shift.id}/staff`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to update assignments";
      toast({ variant: "destructive", title: "Error", description: msg });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-4 max-w-lg mx-auto pb-24 md:pb-8">
      {/* ── Header ── */}
      <div className="flex items-center gap-3 bg-card p-3 sm:p-4 rounded-xl border">
        <Button asChild variant="ghost" size="icon" className="h-9 w-9 shrink-0">
          <Link href={`/location-staff-admin/shifts/${params.id}/staff`}>
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div>
          <h1 className="text-lg sm:text-xl font-bold text-foreground">Assign Staff to Shift</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {shift ? `${shift.name} · ${shift.startTime} – ${shift.endTime}` : "Loading shift..."}
          </p>
        </div>
      </div>

      <Card className="border-border/80 shadow-xs">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-bold flex items-center justify-between">
            <span className="flex items-center gap-2">
              <UserPlus className="h-4 w-4 text-primary" />
              <span>Select Staff Members</span>
            </span>
            <Badge variant="outline" className="text-xs">
              {selectedStaffIds.length} selected
            </Badge>
          </CardTitle>
          <CardDescription className="text-xs">
            Tap a staff member to toggle their assignment to this shift.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <div className="space-y-2 py-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-12 rounded-lg bg-card/60 animate-pulse border" />
              ))}
            </div>
          ) : staffList.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-xs">
              No staff members found in this department.
            </div>
          ) : (
            <div className="divide-y border rounded-xl overflow-hidden max-h-[60vh] overflow-y-auto">
              {staffList.map((staff) => {
                const isSelected = selectedStaffIds.includes(staff.id);
                return (
                  <button
                    key={staff.id}
                    type="button"
                    onClick={() => toggleStaffSelection(staff.id)}
                    className={`w-full p-3 text-left flex items-center justify-between gap-3 transition-colors ${
                      isSelected ? "bg-primary/10 hover:bg-primary/15" : "hover:bg-muted/40"
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground truncate">{staff.name}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {staff.role} {staff.shiftName && staff.shiftId !== params.id ? `(Current: ${staff.shiftName})` : ""}
                      </p>
                    </div>

                    <div
                      className={`h-5 w-5 rounded-md border flex items-center justify-center shrink-0 transition-colors ${
                        isSelected
                          ? "bg-primary border-primary text-primary-foreground"
                          : "border-muted-foreground/30 bg-transparent"
                      }`}
                    >
                      {isSelected && <Check className="h-3.5 w-3.5 stroke-[3]" />}
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          <div className="pt-2 flex items-center justify-end gap-2">
            <Button asChild variant="ghost" size="sm" className="text-xs">
              <Link href={`/location-staff-admin/shifts/${params.id}/staff`}>Cancel</Link>
            </Button>
            <Button
              size="sm"
              disabled={isSaving || isLoading}
              onClick={handleSave}
              className="text-xs font-semibold rounded-full px-5"
            >
              {isSaving ? "Saving..." : "Save Assignments"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
