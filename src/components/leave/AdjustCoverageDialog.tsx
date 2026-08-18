"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import { formatDate } from "@/lib/utils";
import type { LeaveRequest, PeriodSubstitution } from "@/types/leave";

interface PeriodCoverageEntry {
  date: string;
  day: string;
  periodNumber: number;
  timetableSlotId: string;
  sectionName?: string;
  subjectName: string;
  candidates: { facultyId: string; facultyName: string }[];
}

// Every substitute pick is a snapshot taken at decision time (submission, or
// an HOD's override while approving - see applications/[id]/route.ts). If
// the section's timetable is edited/republished afterward - a new period
// added to what this faculty member teaches on a day within the leave range
// - that period was never part of the snapshot and silently shows no
// coverage on the timetable, with no way to fix it once the request is
// already APPROVED. This dialog re-fetches the CURRENT required periods
// (buildPeriodCoverage picks up any newly-added one automatically) and lets
// an HOD/Principal re-pick coverage for any of them, pre-filled with
// whatever's already recorded.
export function AdjustCoverageDialog({
  request,
  onOpenChange,
  onUpdated,
}: {
  request: LeaveRequest | null;
  onOpenChange: (open: boolean) => void;
  onUpdated: (id: string, periodSubstitutions: PeriodSubstitution[]) => void;
}) {
  const [periods, setPeriods] = useState<PeriodCoverageEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!request) return;
    const seeded: Record<string, string> = {};
    for (const p of request.periodSubstitutions ?? []) seeded[`${p.date}|${p.timetableSlotId}`] = p.substituteFacultyId;
    setPicks(seeded);
    setIsLoading(true);
    setPeriods([]);
    fetch(`/api/leave/period-coverage?requestId=${request.id}`)
      .then((r) => r.json() as Promise<{ periods?: PeriodCoverageEntry[] }>)
      .then((d) => setPeriods(d.periods ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load affected periods" }))
      .finally(() => setIsLoading(false));
  }, [request]);

  async function handleSave() {
    if (!request) return;
    const submitted = periods
      .filter((p) => picks[`${p.date}|${p.timetableSlotId}`])
      .map((p) => ({
        date: p.date,
        timetableSlotId: p.timetableSlotId,
        substituteFacultyId: picks[`${p.date}|${p.timetableSlotId}`],
      }));
    if (submitted.length === 0) {
      toast({ variant: "destructive", title: "Pick a substitute for at least one period" });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/leave/applications/${request.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "ADJUST_COVERAGE", periodSubstitutions: submitted }),
      });
      const data = (await res.json()) as { error?: string; periodSubstitutions?: PeriodSubstitution[] };
      if (!res.ok) throw new Error(data.error ?? "Failed to update coverage");
      toast({ variant: "success", title: "Coverage updated" });
      onUpdated(request.id, data.periodSubstitutions ?? []);
      onOpenChange(false);
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to update coverage" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={!!request} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Adjust coverage</DialogTitle>
          <DialogDescription>
            {request && (
              <>
                {request.employeeName}&rsquo;s approved leave, {formatDate(request.fromDate)} &ndash; {formatDate(request.toDate)}.
                Re-pick a substitute for any period below, including one added to the timetable after this leave was approved.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="h-24 rounded-lg bg-muted animate-pulse" />
        ) : periods.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">No teaching periods fall within this leave range.</p>
        ) : (
          <div className="max-h-80 space-y-2 overflow-y-auto rounded-lg border p-2.5">
            {periods.map((p) => {
              const key = `${p.date}|${p.timetableSlotId}`;
              return (
                <div key={key} className="flex items-center justify-between gap-3 flex-wrap">
                  <span className="text-sm">
                    {p.subjectName}{p.sectionName ? ` · ${p.sectionName}` : ""} · {formatDate(new Date(p.date))} P{p.periodNumber}
                  </span>
                  <Select
                    value={picks[key] ?? ""}
                    onValueChange={(v) => setPicks((prev) => ({ ...prev, [key]: v }))}
                  >
                    <SelectTrigger className="w-44">
                      <SelectValue placeholder="Not covered" />
                    </SelectTrigger>
                    <SelectContent>
                      {p.candidates.map((c) => (
                        <SelectItem key={c.facultyId} value={c.facultyId}>{c.facultyName}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              );
            })}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSave} loading={saving} disabled={isLoading || periods.length === 0}>
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
