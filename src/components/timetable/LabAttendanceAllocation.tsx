"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { EmptyState } from "@/components/shared/EmptyState";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import { ordinalYear } from "@/lib/timetable/gridModel";
import type { LabAttendanceDateRange } from "@/types";

// "Allocate attendance faculty": pick a LAB (PRACTICAL subject), the faculty
// teaching it (asked only when more than one does), and the date ranges on
// which that faculty may mark the lab's student attendance. On those dates the
// faculty's Mark Attendance page opens the lab's periods for them (see
// lib/studentAttendance/labAllocation.ts). Used by the HOD / Sub-HOD timetable
// page and the Timetable Incharge workspace; each hands in the teaching
// assignments it is allowed to see, so the screen itself holds no scope rules.
export interface AllocAssignment {
  id: string;
  subjectId: string;
  subjectName: string;
  subjectCode?: string;
  subjectType?: string;
  facultyName: string;
  sectionName?: string;
  courseName?: string;
  year?: number;
  isPast?: boolean;
  accessLevel?: string;
}

interface StoredAllocation { id: string; ranges: LabAttendanceDateRange[] }

const EMPTY_RANGE: LabAttendanceDateRange = { from: "", to: "" };

function dmy(d: string) {
  const [y, m, day] = d.split("-");
  return `${day}-${m}-${y}`;
}

export function LabAttendanceAllocation({ loadAssignments }: { loadAssignments: () => Promise<AllocAssignment[]> }) {
  const [rows, setRows] = useState<AllocAssignment[]>([]);
  const [allocations, setAllocations] = useState<Record<string, LabAttendanceDateRange[]>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [labId, setLabId] = useState("");
  const [pickedAssignmentId, setPickedAssignmentId] = useState("");
  const [ranges, setRanges] = useState<LabAttendanceDateRange[]>([{ ...EMPTY_RANGE }]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      // Only current, section-wise lab assignments the caller can manage.
      const all = (await loadAssignments()).filter((a) => a.subjectType === "PRACTICAL" && !a.isPast && a.accessLevel !== "secondary");
      setRows(all);
      if (all.length > 0) {
        const res = await fetch(`/api/college/lab-attendance-allocations?assignmentIds=${all.map((a) => a.id).join(",")}`);
        const json = (await res.json()) as { allocations?: StoredAllocation[] };
        setAllocations(Object.fromEntries((json.allocations ?? []).map((a) => [a.id, a.ranges])));
      } else {
        setAllocations({});
      }
    } catch {
      toast({ variant: "destructive", title: "Failed to load labs" });
    } finally {
      setIsLoading(false);
    }
  }, [loadAssignments]);

  useEffect(() => {
    // Awaited in a wrapper so the loader's setState calls aren't reachable
    // synchronously from the effect body (react-hooks/set-state-in-effect).
    void (async () => { await load(); })();
  }, [load]);

  const labs = useMemo(() => {
    const map = new Map<string, { id: string; label: string }>();
    for (const a of rows) {
      if (map.has(a.subjectId)) continue;
      const where = a.courseName ? ` · ${a.courseName}${a.year ? ` ${ordinalYear(a.year)}` : ""}` : "";
      map.set(a.subjectId, { id: a.subjectId, label: `${a.subjectName}${a.subjectCode ? ` (${a.subjectCode})` : ""}${where}` });
    }
    return Array.from(map.values()).sort((x, y) => x.label.localeCompare(y.label));
  }, [rows]);

  const facultyOptions = useMemo(() => rows.filter((a) => a.subjectId === labId), [rows, labId]);
  // One faculty for the lab: nothing to choose, so it is picked for them.
  const onlyOne = facultyOptions.length === 1;
  const assignmentId = onlyOne ? facultyOptions[0].id : pickedAssignmentId;

  function pickLab(id: string) {
    setLabId(id);
    setPickedAssignmentId("");
    const options = rows.filter((a) => a.subjectId === id);
    setRanges(options.length === 1 ? rangesFor(options[0].id) : [{ ...EMPTY_RANGE }]);
  }

  function pickFaculty(id: string) {
    setPickedAssignmentId(id);
    setRanges(rangesFor(id));
  }

  function rangesFor(id: string): LabAttendanceDateRange[] {
    const existing = allocations[id];
    return existing && existing.length > 0 ? existing.map((r) => ({ ...r })) : [{ ...EMPTY_RANGE }];
  }

  function setRange(i: number, patch: Partial<LabAttendanceDateRange>) {
    setRanges((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  async function save(id: string, next: LabAttendanceDateRange[]) {
    setSaving(true);
    try {
      const res = await fetch("/api/college/lab-attendance-allocations", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignmentId: id, ranges: next }),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string; ranges?: LabAttendanceDateRange[] };
      if (!res.ok) {
        toast({ variant: "destructive", title: "Could not save", description: json.error });
        return false;
      }
      toast({
        variant: "success",
        title: next.length === 0 ? "Allocation removed" : "Faculty allocated",
        description: next.length === 0 ? undefined : "Their Mark Attendance page is open for these dates.",
      });
      await load();
      return true;
    } catch {
      toast({ variant: "destructive", title: "Could not save" });
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function handleAssign() {
    const filled = ranges.filter((r) => r.from || r.to);
    if (filled.some((r) => !r.from || !r.to)) {
      toast({ variant: "destructive", title: "Fill both From and To for every date range" });
      return;
    }
    if (filled.length === 0) {
      toast({ variant: "destructive", title: "Add at least one date range" });
      return;
    }
    await save(assignmentId, filled);
  }

  const allocated = rows.filter((a) => (allocations[a.id]?.length ?? 0) > 0);

  if (isLoading) return <div className="h-48 rounded-lg border bg-muted/30 animate-pulse" />;

  if (rows.length === 0) {
    return (
      <EmptyState
        title="No labs with an assigned faculty yet"
        description="Assign a faculty to a lab (PRACTICAL) subject in Teaching Assignments first, then allocate attendance here."
      />
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Allocate attendance faculty</CardTitle>
          <CardDescription>
            Pick a lab, its faculty and the dates. On those dates the faculty can open the lab&apos;s Student Attendance and mark it, at any time of day.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Lab</Label>
              <Select value={labId} onValueChange={pickLab}>
                <SelectTrigger><SelectValue placeholder="Select lab" /></SelectTrigger>
                <SelectContent>
                  {labs.map((l) => <SelectItem key={l.id} value={l.id}>{l.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Faculty</Label>
              <Select value={assignmentId} onValueChange={pickFaculty} disabled={!labId || onlyOne}>
                <SelectTrigger>
                  <SelectValue placeholder={!labId ? "Pick a lab first" : "Select faculty"} />
                </SelectTrigger>
                <SelectContent>
                  {facultyOptions.map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.facultyName}{a.sectionName ? ` · Section ${a.sectionName}` : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {onlyOne && <p className="text-xs text-muted-foreground">Only one faculty teaches this lab, so they are selected.</p>}
            </div>
          </div>

          {assignmentId && (
            <div className="space-y-3">
              <Label>Dates</Label>
              {ranges.map((r, i) => (
                <div key={i} className="flex flex-wrap items-end gap-2">
                  <div className="space-y-1">
                    <span className="text-xs text-muted-foreground">From</span>
                    <input type="date" className="block h-10 rounded-md border bg-background px-2 text-sm" value={r.from} onChange={(e) => setRange(i, { from: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <span className="text-xs text-muted-foreground">To</span>
                    <input type="date" className="block h-10 rounded-md border bg-background px-2 text-sm" min={r.from || undefined} value={r.to} onChange={(e) => setRange(i, { to: e.target.value })} />
                  </div>
                  {ranges.length > 1 && (
                    <Button type="button" size="icon" variant="ghost" title="Remove this range" onClick={() => setRanges((prev) => prev.filter((_, idx) => idx !== i))}>
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => setRanges((prev) => [...prev, { ...EMPTY_RANGE }])}>
                  <Plus className="mr-1.5 h-4 w-4" />Add another date range
                </Button>
                <Button type="button" onClick={() => void handleAssign()} loading={saving}>Assign</Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base">Current allocations</CardTitle></CardHeader>
        <CardContent>
          {allocated.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">No lab attendance has been allocated yet.</p>
          ) : (
            <div className="divide-y rounded-md border">
              {allocated.map((a) => (
                <div key={a.id} className="flex items-start justify-between gap-3 px-3 py-2.5">
                  <div className="text-sm">
                    <p className="font-medium">{a.subjectName}{a.subjectCode ? ` (${a.subjectCode})` : ""} · {a.facultyName}</p>
                    <p className="text-xs text-muted-foreground">
                      {a.courseName}{a.year ? ` ${ordinalYear(a.year)}` : ""}{a.sectionName ? ` · Section ${a.sectionName}` : ""}
                    </p>
                    <p className="text-xs">
                      {(allocations[a.id] ?? []).map((r) => (r.from === r.to ? dmy(r.from) : `${dmy(r.from)} to ${dmy(r.to)}`)).join(", ")}
                    </p>
                  </div>
                  <Button size="sm" variant="ghost" title="Remove allocation" disabled={saving} onClick={() => void save(a.id, [])}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// Two views of the Timetable page: the timetable grid itself, and this screen.
export type TimetableView = "timetable" | "labs";

export function TimetableViewSwitch({ value, onChange }: { value: TimetableView; onChange: (v: TimetableView) => void }) {
  const items: { id: TimetableView; label: string }[] = [
    { id: "timetable", label: "Timetable" },
    { id: "labs", label: "Allocate Attendance Faculty" },
  ];
  return (
    <div className="inline-flex rounded-lg border bg-muted/40 p-1" role="tablist">
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          role="tab"
          aria-selected={value === it.id}
          onClick={() => onChange(it.id)}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
            value === it.id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}
