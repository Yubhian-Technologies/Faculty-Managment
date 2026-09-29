"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Clock, Save, Trash2, Globe, Building2, Check } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/hooks/useToast";
import type { LocationDepartment, LocationShift } from "@/types/locationStaff";

export default function LocationStaffAdminEditShiftPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = use(params);
  const shiftId = resolvedParams.id;
  const router = useRouter();

  const [shift, setShift] = useState<LocationShift | null>(null);
  const [departments, setDepartments] = useState<LocationDepartment[]>([]);
  const [isCampusWide, setIsCampusWide] = useState(false);
  const [selectedDeptIds, setSelectedDeptIds] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("17:00");
  const [gracePeriodMinutes, setGracePeriodMinutes] = useState(15);
  const [description, setDescription] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    let isCancelled = false;
    Promise.all([
      fetch(`/api/location/shifts`).then((r) => (r.ok ? r.json() : Promise.resolve({ shifts: [] }))),
      fetch(`/api/location/departments`).then((r) => (r.ok ? r.json() : Promise.resolve({ departments: [] }))),
    ])
      .then(([shiftsData, deptsData]) => {
        if (isCancelled) return;
        const depts = (deptsData.departments as LocationDepartment[] | undefined) ?? [];
        setDepartments(depts);

        const shifts = (shiftsData.shifts as LocationShift[] | undefined) ?? [];
        const found = shifts.find((s) => s.id === shiftId);
        if (found) {
          setShift(found);
          setName(found.name);
          setStartTime(found.startTime);
          setEndTime(found.endTime);
          setGracePeriodMinutes(found.gracePeriodMinutes ?? 15);
          setDescription(found.description ?? "");
          setIsActive(found.isActive !== false);

          const campusWide = !!found.isCampusWide || found.departmentId === "ALL" || (Array.isArray(found.departmentIds) && found.departmentIds.includes("ALL"));
          setIsCampusWide(campusWide);

          if (!campusWide) {
            const ids = Array.isArray(found.departmentIds) && found.departmentIds.length > 0
              ? found.departmentIds
              : found.departmentId && found.departmentId !== "ALL"
              ? [found.departmentId]
              : [];
            setSelectedDeptIds(ids);
          }
        } else {
          toast({ variant: "destructive", title: "Shift not found" });
        }
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
  }, [shiftId]);

  const toggleDept = (deptId: string) => {
    setSelectedDeptIds((prev) =>
      prev.includes(deptId) ? prev.filter((id) => id !== deptId) : [...prev, deptId]
    );
  };

  const handleSelectAllDepts = () => {
    if (selectedDeptIds.length === departments.length) {
      setSelectedDeptIds([]);
    } else {
      setSelectedDeptIds(departments.map((d) => d.id));
    }
  };

  const fallbackHref = shift?.departmentId && shift.departmentId !== "ALL"
    ? `/location-staff-admin/departments/${shift.departmentId}?tab=shifts`
    : selectedDeptIds[0]
    ? `/location-staff-admin/departments/${selectedDeptIds[0]}?tab=shifts`
    : "/location-staff-admin/departments";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!isCampusWide && selectedDeptIds.length === 0) {
      toast({
        variant: "destructive",
        title: "Department required",
        description: "Please select at least one department or enable 'Campus-Wide'.",
      });
      return;
    }

    if (!name.trim() || !startTime || !endTime) {
      toast({
        variant: "destructive",
        title: "Missing fields",
        description: "Shift name, start time, and end time are required.",
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/location/shifts/${shiftId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          startTime,
          endTime,
          gracePeriodMinutes,
          description: description.trim(),
          isActive,
          isCampusWide,
          departmentIds: isCampusWide ? ["ALL"] : selectedDeptIds,
          departmentId: isCampusWide ? "ALL" : selectedDeptIds[0] || "",
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to update shift");
      }

      toast({ title: "Shift Updated", description: `${name} has been updated successfully.` });
      router.push(fallbackHref);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to update shift";
      toast({ variant: "destructive", title: "Error", description: msg });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Are you sure you want to delete shift "${name}"? Any assigned staff will be unassigned.`)) {
      return;
    }

    setIsDeleting(true);
    try {
      const res = await fetch(`/api/location/shifts/${shiftId}`, {
        method: "DELETE",
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to delete shift");
      }

      toast({ title: "Shift Deleted", description: `${name} has been removed.` });
      router.push(fallbackHref);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to delete shift";
      toast({ variant: "destructive", title: "Error", description: msg });
    } finally {
      setIsDeleting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="max-w-lg mx-auto p-8 space-y-4">
        <div className="h-10 bg-muted/40 rounded-xl animate-pulse" />
        <div className="h-64 bg-muted/20 rounded-xl animate-pulse border" />
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-lg mx-auto pb-24 md:pb-8">
      {/* ── Header ── */}
      <div className="flex items-center justify-between gap-3 bg-card p-3 sm:p-4 rounded-xl border">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="icon" className="h-9 w-9 shrink-0">
            <Link href={fallbackHref}>
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div>
            <h1 className="text-lg sm:text-xl font-bold text-foreground">Edit Shift</h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              {isCampusWide
                ? "Campus-Wide (Reusable across all departments)"
                : `Used by ${selectedDeptIds.length} department(s)`}
            </p>
          </div>
        </div>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={handleDelete}
          disabled={isDeleting}
          className="text-destructive hover:bg-destructive/10 text-xs gap-1"
        >
          <Trash2 className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Delete</span>
        </Button>
      </div>

      <Card className="border-border/80 shadow-xs">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            <Clock className="h-4 w-4 text-primary" />
            <span>Shift Timings & Scope</span>
          </CardTitle>
          <CardDescription className="text-xs">
            Manage reusable shift configuration and department access.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Campus-Wide Scope Toggle */}
            <div className="p-3 rounded-xl border bg-muted/20 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Globe className="h-4 w-4 text-purple-600" />
                  <div>
                    <Label className="text-xs font-bold text-foreground cursor-pointer">
                      Campus-Wide Shift
                    </Label>
                    <p className="text-[11px] text-muted-foreground">
                      Available to ALL departments across campus (reusable everywhere).
                    </p>
                  </div>
                </div>
                <Switch checked={isCampusWide} onCheckedChange={setIsCampusWide} />
              </div>
            </div>

            {/* Department Multi-Select (if not campus-wide) */}
            {!isCampusWide && (
              <div className="space-y-2 p-3 rounded-xl border bg-card">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold flex items-center gap-1.5">
                    <Building2 className="h-3.5 w-3.5 text-primary" />
                    <span>Applicable Departments ({selectedDeptIds.length} selected) *</span>
                  </Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleSelectAllDepts}
                    className="h-6 text-[10px] px-2 text-primary"
                  >
                    {selectedDeptIds.length === departments.length ? "Deselect All" : "Select All"}
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Select which departments can assign their staff to this shift:
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-48 overflow-y-auto pt-1">
                  {departments.map((d) => {
                    const isSelected = selectedDeptIds.includes(d.id);
                    return (
                      <button
                        key={d.id}
                        type="button"
                        onClick={() => toggleDept(d.id)}
                        className={`flex items-center justify-between p-2 rounded-lg border text-left text-xs transition-colors ${
                          isSelected
                            ? "bg-primary/10 border-primary/40 text-foreground font-medium"
                            : "hover:bg-muted/50 border-border/70 text-muted-foreground"
                        }`}
                      >
                        <span className="truncate pr-2">{d.name}</span>
                        {isSelected && (
                          <span className="h-4 w-4 rounded-full bg-primary text-primary-foreground flex items-center justify-center shrink-0">
                            <Check className="h-2.5 w-2.5" />
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="space-y-1">
              <Label className="text-xs font-semibold">Shift Name *</Label>
              <Input
                required
                placeholder="e.g. Morning Shift, Night Patrol, General Duty"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-9 text-xs"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs font-semibold">Start Time (24h) *</Label>
                <Input
                  type="time"
                  required
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="h-9 text-xs font-mono"
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-semibold">End Time (24h) *</Label>
                <Input
                  type="time"
                  required
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="h-9 text-xs font-mono"
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-semibold">Grace Period (Minutes)</Label>
              <Input
                type="number"
                min={0}
                max={60}
                value={gracePeriodMinutes}
                onChange={(e) => setGracePeriodMinutes(parseInt(e.target.value, 10) || 0)}
                className="h-9 text-xs"
              />
              <p className="text-[11px] text-muted-foreground">
                Check-ins up to {gracePeriodMinutes} minutes after start time are marked on time; later check-ins are flagged as Late.
              </p>
            </div>

            <div className="space-y-1">
              <Label className="text-xs font-semibold">Description (Optional)</Label>
              <Input
                placeholder="e.g. Main gate & perimeter security"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="h-9 text-xs"
              />
            </div>

            <div className="flex items-center justify-between p-3 rounded-lg border bg-muted/20">
              <div>
                <Label className="text-xs font-semibold text-foreground">Shift Active Status</Label>
                <p className="text-[11px] text-muted-foreground">
                  Inactive shifts will not be available for new staff assignments.
                </p>
              </div>
              <Switch checked={isActive} onCheckedChange={setIsActive} />
            </div>

            <div className="pt-2 flex items-center justify-end gap-2 border-t">
              <Button asChild type="button" variant="ghost" size="sm" className="text-xs">
                <Link href={fallbackHref}>Cancel</Link>
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={isSubmitting}
                className="text-xs font-semibold rounded-full px-5 gap-1.5"
              >
                <Save className="h-3.5 w-3.5" />
                <span>{isSubmitting ? "Saving..." : "Save Changes"}</span>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
