"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, Clock, Globe, Building2, Check } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/useToast";
import type { LocationDepartment } from "@/types/locationStaff";

export default function LocationStaffAdminNewShiftPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const targetDeptId = searchParams.get("departmentId") || "";

  const [departments, setDepartments] = useState<LocationDepartment[]>([]);
  const [isCampusWide, setIsCampusWide] = useState(false);
  const [selectedDeptIds, setSelectedDeptIds] = useState<string[]>(targetDeptId ? [targetDeptId] : []);
  const [name, setName] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("17:00");
  const [gracePeriodMinutes, setGracePeriodMinutes] = useState(15);
  const [description, setDescription] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fallbackHref = targetDeptId
    ? `/location-staff-admin/departments/${targetDeptId}?tab=shifts`
    : "/location-staff-admin/departments";

  useEffect(() => {
    fetch("/api/location/departments")
      .then((r) => (r.ok ? r.json() : Promise.resolve({ departments: [] })))
      .then((d) => {
        const list = (d.departments as LocationDepartment[] | undefined) ?? [];
        setDepartments(list);
        if (targetDeptId) {
          setSelectedDeptIds([targetDeptId]);
        } else if (list.length > 0 && selectedDeptIds.length === 0) {
          setSelectedDeptIds([list[0].id]);
        }
      })
      .catch(() => {});
  }, [targetDeptId]);

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
      const res = await fetch("/api/location/shifts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          isCampusWide,
          departmentIds: isCampusWide ? ["ALL"] : selectedDeptIds,
          departmentId: isCampusWide ? "ALL" : selectedDeptIds[0] || "",
          name: name.trim(),
          startTime,
          endTime,
          gracePeriodMinutes,
          description: description.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create shift");

      toast({
        title: "Shift Created",
        description: isCampusWide
          ? `${name} is created campus-wide for all departments.`
          : `${name} is created and available to ${selectedDeptIds.length} department(s).`,
      });

      const redirectDept = targetDeptId || selectedDeptIds[0];
      router.push(
        redirectDept
          ? `/location-staff-admin/departments/${redirectDept}?tab=shifts`
          : "/location-staff-admin/departments"
      );
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to create shift";
      toast({ variant: "destructive", title: "Error", description: msg });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-4 max-w-lg mx-auto pb-24 md:pb-8">
      {/* ── Header ── */}
      <div className="flex items-center gap-3 bg-card p-3 sm:p-4 rounded-xl border">
        <Button asChild variant="ghost" size="icon" className="h-9 w-9 shrink-0">
          <Link aria-label="Back" href={fallbackHref}>
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div>
          <h1 className="text-lg sm:text-xl font-bold text-foreground">Create Campus Shift</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Configure shift timings with options to reuse across multiple departments or campus-wide.
          </p>
        </div>
      </div>

      <Card className="border-border/80 shadow-xs">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-bold flex items-center gap-2">
            <Clock className="h-4 w-4 text-primary" />
            <span>Shift Configuration & Scope</span>
          </CardTitle>
          <CardDescription className="text-xs">
            Staff assigned to this shift will use these hours for automatic on-time/late validation.
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
                      Make available to ALL departments across campus (reusable everywhere).
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
                placeholder="e.g. Morning Shift, General Duty, Night Patrol"
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
                placeholder="e.g. Shared campus shift for front office & facilities"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="h-9 text-xs"
              />
            </div>

            <div className="pt-2 flex items-center justify-end gap-2 border-t">
              <Button asChild type="button" variant="ghost" size="sm" className="text-xs">
                <Link href={fallbackHref}>Cancel</Link>
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={isSubmitting}
                className="text-xs font-semibold rounded-full px-5"
              >
                {isSubmitting ? "Creating..." : "Save Shift"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
