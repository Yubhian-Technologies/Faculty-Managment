"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRightLeft,
  CheckSquare,
  Clock,
  Filter,
  RefreshCw,
  Search,
  Square,
  Users,
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
import type { LocationDepartment, LocationShift, LocationStaffMember } from "@/types/locationStaff";

interface ShiftRotationRosterViewProps {
  departmentId?: string;
  departmentName?: string;
  backHref: string;
  manageShiftsHref: string;
}

export function ShiftRotationRosterView({
  departmentId,
  departmentName,
  backHref,
  manageShiftsHref,
}: ShiftRotationRosterViewProps) {
  const [shifts, setShifts] = useState<LocationShift[]>([]);
  const [staffList, setStaffList] = useState<LocationStaffMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState("");
  const [selectedShiftFilter, setSelectedShiftFilter] = useState("ALL");

  // Selection for bulk rotation
  const [selectedStaffIds, setSelectedStaffIds] = useState<string[]>([]);
  const [bulkTargetShiftId, setBulkTargetShiftId] = useState<string>("");
  const [isRotating, setIsRotating] = useState(false);
  const [singleRotatingId, setSingleRotatingId] = useState<string | null>(null);

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
      .then(([sList, stList]) => {
        if (isCancelled) return;
        setShifts(sList);
        setStaffList(stList);
      })
      .catch(() => {
        if (!isCancelled) toast({ variant: "destructive", title: "Failed to load staff roster" });
      })
      .finally(() => {
        if (!isCancelled) setIsLoading(false);
      });

    return () => {
      isCancelled = true;
    };
  }, [departmentId, refreshKey]);

  // Filtered staff list
  const filteredStaff = useMemo(() => {
    return staffList.filter((s) => {
      if (selectedShiftFilter === "UNASSIGNED" && s.shiftId) return false;
      if (selectedShiftFilter !== "ALL" && selectedShiftFilter !== "UNASSIGNED" && s.shiftId !== selectedShiftFilter) {
        return false;
      }
      if (search.trim()) {
        const q = search.toLowerCase().trim();
        return (
          s.name.toLowerCase().includes(q) ||
          s.role?.toLowerCase().includes(q) ||
          s.contactNumber?.includes(q)
        );
      }
      return true;
    });
  }, [staffList, selectedShiftFilter, search]);

  // Toggle selection
  const toggleSelectAll = () => {
    if (selectedStaffIds.length === filteredStaff.length) {
      setSelectedStaffIds([]);
    } else {
      setSelectedStaffIds(filteredStaff.map((s) => s.id));
    }
  };

  const toggleSelectOne = (id: string) => {
    setSelectedStaffIds((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  // Perform single rotation
  const handleSingleRotate = async (staffId: string, targetShiftId: string) => {
    setSingleRotatingId(staffId);
    try {
      const res = await fetch(`/api/location/shifts/rotate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ staffId, targetShiftId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to switch shift");

      toast({
        title: "Shift Updated",
        description: `Staff reassigned to ${data.targetShiftName}.`,
      });
      reload();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to switch shift";
      toast({ variant: "destructive", title: "Error", description: msg });
    } finally {
      setSingleRotatingId(null);
    }
  };

  // Perform bulk rotation
  const handleBulkRotate = async () => {
    if (selectedStaffIds.length === 0 || !bulkTargetShiftId) {
      toast({ variant: "destructive", title: "Select staff and target shift" });
      return;
    }

    setIsRotating(true);
    try {
      const res = await fetch(`/api/location/shifts/rotate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          staffIds: selectedStaffIds,
          targetShiftId: bulkTargetShiftId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Bulk rotation failed");

      toast({
        title: "Bulk Rotation Complete",
        description: `Rotated ${data.count} staff members to ${data.targetShiftName}.`,
      });
      setSelectedStaffIds([]);
      setBulkTargetShiftId("");
      reload();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Bulk rotation failed";
      toast({ variant: "destructive", title: "Error", description: msg });
    } finally {
      setIsRotating(false);
    }
  };

  return (
    <div className="space-y-4 max-w-5xl mx-auto pb-24 md:pb-8">
      {/* ── Top Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-card p-4 rounded-xl border shadow-xs">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="icon" className="h-9 w-9 shrink-0">
            <Link aria-label="Back" href={backHref}>
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div>
            <h1 className="text-lg sm:text-xl font-bold text-foreground flex items-center gap-2">
              <ArrowRightLeft className="h-5 w-5 text-primary" />
              <span>Shift Rotation & Assignment Roster</span>
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              <span>{departmentName || "All Departments"}</span> · Easily switch, reassign, or bulk-rotate staff between shifts.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button asChild size="sm" variant="outline" className="rounded-full gap-1.5 text-xs font-semibold">
            <Link href={manageShiftsHref}>
              <Clock className="h-4 w-4" />
              <span>Manage Shift Timings</span>
            </Link>
          </Button>
        </div>
      </div>

      {/* ── Bulk Rotation Action Bar (When Selected) ── */}
      {selectedStaffIds.length > 0 && (
        <Card className="border-primary/40 bg-primary/5 shadow-xs animate-in fade-in-50">
          <CardContent className="p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Badge className="bg-primary text-primary-foreground font-bold text-xs px-2.5 py-0.5">
                {selectedStaffIds.length} Staff Selected
              </Badge>
              <span className="text-xs text-muted-foreground">
                Choose a new shift to rotate selected staff:
              </span>
            </div>

            <div className="flex items-center gap-2">
              <Select value={bulkTargetShiftId} onValueChange={setBulkTargetShiftId}>
                <SelectTrigger className="h-9 w-44 sm:w-56 text-xs bg-card">
                  <SelectValue placeholder="Select target shift..." />
                </SelectTrigger>
                <SelectContent>
                  {shifts.map((s) => (
                    <SelectItem key={s.id} value={s.id} className="text-xs">
                      {s.name} ({s.startTime}–{s.endTime})
                    </SelectItem>
                  ))}
                  <SelectItem value="__unassigned__" className="text-xs text-destructive">
                    Unassign from Shift
                  </SelectItem>
                </SelectContent>
              </Select>

              <Button
                size="sm"
                onClick={handleBulkRotate}
                disabled={!bulkTargetShiftId || isRotating}
                className="h-9 rounded-full text-xs font-semibold px-4 shadow-xs"
              >
                {isRotating ? "Rotating..." : "Apply Rotation"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setSelectedStaffIds([])}
                className="h-9 text-xs"
              >
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Filters & Controls ── */}
      <Card className="border shadow-xs">
        <CardContent className="p-4 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 w-full sm:w-auto">
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search staff name or role..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-8 h-9 text-xs"
                />
              </div>

              <Select value={selectedShiftFilter} onValueChange={setSelectedShiftFilter}>
                <SelectTrigger className="h-9 w-full sm:w-48 text-xs">
                  <SelectValue placeholder="Filter by shift" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Shifts ({staffList.length})</SelectItem>
                  {shifts.map((s) => {
                    const count = staffList.filter((st) => st.shiftId === s.id).length;
                    return (
                      <SelectItem key={s.id} value={s.id} className="text-xs">
                        {s.name} ({count})
                      </SelectItem>
                    );
                  })}
                  <SelectItem value="UNASSIGNED">
                    Unassigned ({staffList.filter((st) => !st.shiftId).length})
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={toggleSelectAll}
                className="h-9 text-xs gap-1.5"
              >
                {selectedStaffIds.length === filteredStaff.length && filteredStaff.length > 0 ? (
                  <>
                    <CheckSquare className="h-4 w-4 text-primary" />
                    <span>Deselect All</span>
                  </>
                ) : (
                  <>
                    <Square className="h-4 w-4 text-muted-foreground" />
                    <span>Select All</span>
                  </>
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={reload}
                className="h-9 w-9 text-muted-foreground"
                title="Refresh"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* ── Staff Table ── */}
          {isLoading ? (
            <div className="space-y-2 py-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-16 rounded-xl border bg-muted/30 animate-pulse" />
              ))}
            </div>
          ) : filteredStaff.length === 0 ? (
            <div className="rounded-xl border border-dashed p-8 text-center bg-card/30">
              <Users className="h-8 w-8 text-muted-foreground mx-auto mb-2 opacity-50" />
              <p className="font-semibold text-foreground text-sm">No staff found</p>
              <p className="text-xs text-muted-foreground mt-1">Try clearing filters or search terms.</p>
            </div>
          ) : (
            <div className="divide-y border rounded-xl overflow-hidden bg-card">
              {filteredStaff.map((staff) => {
                const isSelected = selectedStaffIds.includes(staff.id);
                const assignedShift = shifts.find((s) => s.id === staff.shiftId);

                return (
                  <div
                    key={staff.id}
                    className={`p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors ${
                      isSelected ? "bg-primary/5" : "hover:bg-muted/30"
                    }`}
                  >
                    {/* Left: Checkbox + Staff Info */}
                    <div className="flex items-center gap-3 min-w-0">
                      <button
                        type="button"
                        onClick={() => toggleSelectOne(staff.id)}
                        className="text-muted-foreground hover:text-foreground shrink-0 focus:outline-hidden"
                      >
                        {isSelected ? (
                          <CheckSquare className="h-4 w-4 text-primary" />
                        ) : (
                          <Square className="h-4 w-4" />
                        )}
                      </button>

                      <div className="h-10 w-10 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0 overflow-hidden font-bold text-primary text-xs">
                        {staff.photoUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={staff.photoUrl} alt={staff.name} className="h-full w-full object-cover" />
                        ) : (
                          staff.name.slice(0, 2).toUpperCase()
                        )}
                      </div>

                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-sm text-foreground truncate">{staff.name}</span>
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 border-primary/30 text-primary">
                            {staff.role}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 truncate">
                          <span>📱 {staff.contactNumber}</span>
                          {staff.departmentName && <span> · {staff.departmentName}</span>}
                        </p>
                      </div>
                    </div>

                    {/* Right: Current Shift Badge & Switch Shift Dropdown */}
                    <div className="flex items-center gap-2.5 self-end sm:self-auto shrink-0">
                      {assignedShift ? (
                        <div className="text-right">
                          <Badge className="bg-primary/10 text-primary border-primary/20 text-xs font-semibold">
                            {assignedShift.name}
                          </Badge>
                          <p className="text-[11px] font-mono text-muted-foreground mt-0.5">
                            {assignedShift.startTime} – {assignedShift.endTime}
                          </p>
                        </div>
                      ) : (
                        <Badge variant="outline" className="text-xs text-muted-foreground border-dashed">
                          No Shift
                        </Badge>
                      )}

                      <Select
                        value={staff.shiftId || "__unassigned__"}
                        onValueChange={(val) => handleSingleRotate(staff.id, val)}
                        disabled={singleRotatingId === staff.id}
                      >
                        <SelectTrigger className="h-8 w-36 sm:w-44 text-xs">
                          <SelectValue placeholder="Switch Shift..." />
                        </SelectTrigger>
                        <SelectContent>
                          {shifts.map((s) => (
                            <SelectItem key={s.id} value={s.id} className="text-xs">
                              {s.name} ({s.startTime}–{s.endTime})
                            </SelectItem>
                          ))}
                          <SelectItem value="__unassigned__" className="text-xs text-destructive">
                            Unassigned
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
