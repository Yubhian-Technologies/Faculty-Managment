"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Check, UserPlus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/useToast";
import { useActiveLocationDept } from "@/hooks/useActiveLocationDept";
import type { LocationShift, LocationStaffMember } from "@/types/locationStaff";

export default function AssignShiftStaffPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { activeDeptId } = useActiveLocationDept();

  const [shift, setShift] = useState<LocationShift | null>(null);
  const [staffList, setStaffList] = useState<LocationStaffMember[]>([]);
  const [selectedStaffIds, setSelectedStaffIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let isCancelled = false;
    if (!activeDeptId) return;

    Promise.all([
      fetch(`/api/location/shifts?departmentId=${activeDeptId}`)
        .then((r) => (r.ok ? r.json() : Promise.resolve({ shifts: [] })))
        .then((d) => (d.shifts as LocationShift[] | undefined) ?? []),
      fetch(`/api/location/staff?departmentId=${activeDeptId}&status=ACTIVE`)
        .then((r) => (r.ok ? r.json() : Promise.resolve({ staff: [] })))
        .then((d) => (d.staff as LocationStaffMember[] | undefined) ?? []),
    ])
      .then(([shifts, staff]) => {
        if (isCancelled) return;
        const found = shifts.find((s) => s.id === params.id) ?? null;
        setShift(found);
        setStaffList(staff);
        setSelectedStaffIds(staff.filter((s) => s.shiftId === params.id).map((s) => s.id));
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
  }, [activeDeptId, params.id]);

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
      router.push("/location-dept-head/shifts");
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
          <Link aria-label="Back" href="/location-dept-head/shifts">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div>
          <h1 className="text-lg sm:text-xl font-bold text-foreground">Assign Staff</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            {shift ? `${shift.name} · ${shift.startTime} – ${shift.endTime}` : "Loading shift..."}
          </p>
        </div>
      </div>

      <Card className="border-border/80 shadow-xs">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            <UserPlus className="h-4 w-4 text-primary" />
            <span>Select Staff Members</span>
          </CardTitle>
          <CardDescription className="text-xs">
            Choose which staff members are assigned to this shift.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {isLoading ? (
            <div className="space-y-1.5">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-12 rounded-lg border bg-muted/30 animate-pulse" />
              ))}
            </div>
          ) : staffList.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">No active staff members.</p>
          ) : (
            staffList.map((staff) => {
              const isSelected = selectedStaffIds.includes(staff.id);
              const isDifferentShift = staff.shiftId && staff.shiftId !== shift?.id;

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
                    className={`h-5 w-5 rounded-full border flex items-center justify-center shrink-0 ${
                      isSelected ? "bg-primary border-primary text-primary-foreground" : "border-muted-foreground/40"
                    }`}
                  >
                    {isSelected && <Check className="h-3 w-3" />}
                  </div>
                </div>
              );
            })
          )}

          <div className="flex items-center justify-end gap-2 pt-3 border-t mt-3">
            <Button asChild type="button" variant="outline" size="sm">
              <Link href="/location-dept-head/shifts">Cancel</Link>
            </Button>
            <Button size="sm" onClick={handleSave} disabled={isSaving || !shift}>
              {isSaving ? "Saving..." : `Assign (${selectedStaffIds.length})`}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
