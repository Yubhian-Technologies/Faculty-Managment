"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import type { DayOfWeek, DraftSlot, TeachingAssignment } from "@/types";
import { DAY_LABELS } from "@/types";

// Attendance assignee: for the cells picked on the grid, who takes attendance. Subject (only those in the picked
// cells) -> faculty -> batch or whole section -> mid or whole semester. One "assign" call swaps the subject's slots
// in those cells for the chosen faculty, so it works on a published timetable the same way every edit does
// (Edit, change, Publish).

const WHOLE = "__whole__";
const FULL = "__full__";
const STEPS = ["Subject", "Faculty", "Batch", "Mid"] as const;

interface Props {
  onOpenChange: (open: boolean) => void;
  sectionId: string;
  semesterBody: { semester?: number };
  cells: { day: DayOfWeek; period: number }[];
  /** The subjects held by every picked cell. */
  subjects: { id: string; name: string }[];
  /** The assignments this person may place (already narrowed by the editor). */
  assignments: TeachingAssignment[];
  onApplied: (slots: DraftSlot[]) => void;
}

export function AttendanceAssigneeDialog({ onOpenChange, sectionId, semesterBody, cells, subjects, assignments, onApplied }: Props) {
  const [step, setStep] = useState(0);
  const [subjectId, setSubjectId] = useState("");
  const [picked, setPicked] = useState<string[]>([]); // assignment ids
  const [batchBy, setBatchBy] = useState<Record<string, string>>({});
  const [midBy, setMidBy] = useState<Record<string, string>>({});
  const [batches, setBatches] = useState<string[]>([]);
  const [defaultBatch, setDefaultBatch] = useState<Record<string, string>>({}); // facultyId -> configured batch
  const [midCount, setMidCount] = useState(0);
  const [busy, setBusy] = useState(false);

  // The batches configured for this section and the college's mid count.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [b, m] = await Promise.all([
        fetch(`/api/college/section-lab-batch-settings?sectionId=${encodeURIComponent(sectionId)}`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetch("/api/college/exam-mid-settings").then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ]);
      if (cancelled) return;
      setBatches((b as { batches?: string[] } | null)?.batches ?? []);
      const byFaculty: Record<string, string> = {};
      for (const lab of (b as { labs?: { faculty: { facultyId: string; batch: string | null }[] }[] } | null)?.labs ?? []) {
        for (const f of lab.faculty) if (f.batch) byFaculty[f.facultyId] = f.batch;
      }
      setDefaultBatch(byFaculty);
      setMidCount((m as { settings?: { midCount?: number } } | null)?.settings?.midCount ?? 0);
    })();
    return () => { cancelled = true; };
  }, [sectionId]);

  const faculty = useMemo(() => assignments.filter((a) => !a.isPast && a.subjectId === subjectId), [assignments, subjectId]);
  const chosen = faculty.filter((a) => picked.includes(a.id));
  const batchOf = (a: TeachingAssignment) => (batchBy[a.id] ?? "").trim();
  const midOf = (a: TeachingAssignment) => midBy[a.id] ?? "";

  function pickSubject(id: string) {
    setSubjectId(id);
    const list = assignments.filter((a) => !a.isPast && a.subjectId === id);
    setPicked(list.length === 1 ? [list[0].id] : []);
    setBatchBy(Object.fromEntries(list.map((a) => [a.id, defaultBatch[a.facultyId] ?? ""])));
    setMidBy({});
  }

  // Two flexible faculty must not cover the same students at the same time (the server checks the same rule).
  function overlapProblem(): string | null {
    const flexible = chosen.filter((a) => batchOf(a) || midOf(a));
    for (let i = 0; i < flexible.length; i++) {
      for (let j = i + 1; j < flexible.length; j++) {
        const a = flexible[i], b = flexible[j];
        const sameBatch = !batchOf(a) || !batchOf(b) || batchOf(a).toLowerCase() === batchOf(b).toLowerCase();
        const sameMid = !midOf(a) || !midOf(b) || midOf(a) === midOf(b);
        if (sameBatch && sameMid) return `${a.facultyName} and ${b.facultyName} would cover the same students at the same time - give them different batches or different mids.`;
      }
    }
    return null;
  }

  const canNext = step === 0 ? Boolean(subjectId) : step === 1 ? chosen.length > 0 : true;

  async function apply() {
    const problem = overlapProblem();
    if (problem) { toast({ variant: "destructive", title: "Cannot assign these together", description: problem }); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/college/timetable/draft", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sectionId, ...semesterBody, action: "assign", assignmentId: chosen[0].id, subjectId,
          cells: cells.map((c) => ({ day: c.day, period: c.period })),
          entries: chosen.map((a) => ({ assignmentId: a.id, ...(batchOf(a) ? { labBatch: batchOf(a) } : {}), ...(midOf(a) ? { midScope: Number(midOf(a)) } : {}) })),
        }),
      });
      const json = (await res.json().catch(() => ({}))) as { slots?: DraftSlot[]; error?: string };
      if (!res.ok || !json.slots) {
        toast({ variant: "destructive", title: "Could not assign", description: json.error });
        return;
      }
      onApplied(json.slots);
      toast({ variant: "success", title: "Added to the draft", description: "Publish the timetable to make it live." });
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  }

  const cellsText = Array.from(new Set(cells.map((c) => c.day))).map((d) => `${DAY_LABELS[d]} ${cells.filter((c) => c.day === d).map((c) => c.period).sort((a, b) => a - b).join(", ")}`).join(" · ");

  return (
    <Dialog open onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Attendance assignee - {STEPS[step]} ({step + 1} of {STEPS.length})</DialogTitle>
          <DialogDescription>
            {cellsText}.{" "}
            {step === 0 && "Which subject do you want to assign? Only the subjects in these cells are listed."}
            {step === 1 && "Which faculty of this subject take attendance in these cells?"}
            {step === 2 && "Which batch does each faculty take? Leave it on Whole section if they take everyone."}
            {step === 3 && "All semester, or only up to one mid exam? Mid dates come from the Exam Cell."}
          </DialogDescription>
        </DialogHeader>

        {step === 0 && (subjects.length === 0
          ? <p className="text-sm text-muted-foreground">The picked cells have no subject in common. Go back and pick cells that hold the same subject.</p>
          : (
            <Select value={subjectId} onValueChange={pickSubject}>
              <SelectTrigger><SelectValue placeholder="Select subject" /></SelectTrigger>
              <SelectContent>{subjects.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
            </Select>
          ))}

        {step === 1 && (
          <div className="space-y-2 rounded-md border p-3">
            {faculty.map((a) => (
              <label key={a.id} className="flex items-center gap-2 text-sm">
                <Checkbox checked={picked.includes(a.id)} onCheckedChange={(c) => setPicked((p) => (c ? [...p, a.id] : p.filter((x) => x !== a.id)))} />
                {a.facultyName}
              </label>
            ))}
          </div>
        )}

        {step === 2 && (
          <div className="space-y-2">
            {chosen.map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-3">
                <span className="text-sm">{a.facultyName}</span>
                <Select value={batchOf(a) || WHOLE} onValueChange={(v) => setBatchBy((m) => ({ ...m, [a.id]: v === WHOLE ? "" : v }))}>
                  <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={WHOLE}>Whole section</SelectItem>
                    {batches.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            ))}
            {batches.length === 0 && <p className="text-xs text-muted-foreground">No lab batches are set up for this section, so only Whole section is offered.</p>}
          </div>
        )}

        {step === 3 && (
          <div className="space-y-3">
            {chosen.map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-3">
                <span className="text-sm">{a.facultyName}</span>
                <Select value={midOf(a) || FULL} onValueChange={(v) => setMidBy((m) => ({ ...m, [a.id]: v === FULL ? "" : v }))}>
                  <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={FULL}>Whole semester</SelectItem>
                    {Array.from({ length: midCount }, (_, i) => i + 1).map((n) => <SelectItem key={n} value={String(n)}>Up to Mid {n}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            ))}
            {midCount === 0 && <p className="text-xs text-muted-foreground">The Exam Cell hasn&apos;t set up mid exams yet, so only Whole semester is offered.</p>}
            <p className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
              {chosen.map((a) => `${a.facultyName} (${batchOf(a) || "whole section"}, ${midOf(a) ? `up to Mid ${midOf(a)}` : "whole semester"})`).join("; ")}.
              After the last mid, attendance for a mid-scoped period is closed.
            </p>
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="ghost" disabled={step === 0 || busy} onClick={() => setStep((s) => s - 1)}>Back</Button>
          {step < STEPS.length - 1 ? (
            <Button disabled={!canNext} onClick={() => setStep((s) => s + 1)}>Next</Button>
          ) : (
            <Button loading={busy} disabled={chosen.length === 0} onClick={() => void apply()}>Assign</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
