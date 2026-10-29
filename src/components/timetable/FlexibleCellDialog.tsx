"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import type { DayOfWeek, DraftSlot, TeachingAssignment } from "@/types";
import { DAY_LABELS } from "@/types";

// Flexible cell: one cell, or several consecutive periods of one day, taken by one or more faculty of a subject -
// each with their own batch and, if wanted, their own mid exam. Five steps: cells, subject, faculty, batches, mid.
// It places through the draft's ordinary "add" action (so it works on a published timetable the same way every
// other edit does: Edit, change, Publish); the server validates and a clash comes back as a message.

const WHOLE = "__whole__";
const FULL = "__full__";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sectionId: string;
  semesterBody: { semester?: number };
  /** The assignments this person may place (already narrowed by the editor). */
  assignments: TeachingAssignment[];
  days: DayOfWeek[];
  numberOfPeriods: number;
  /** Cells already picked on the grid (consecutive periods of one day); the dialog starts from them. */
  initial?: { day: DayOfWeek; start: number; end: number };
  /** What already sits in a cell, to pick coTeach / allowSplit the way the editor's own Add does. */
  occupantsAt: (day: DayOfWeek, period: number) => { subjectId: string; assignmentId: string }[];
  onApplied: (slots: DraftSlot[]) => void;
}

const STEPS = ["Cells", "Subject", "Faculty", "Batches", "Mid"] as const;

export function FlexibleCellDialog({ open, onOpenChange, sectionId, semesterBody, assignments, days, numberOfPeriods, initial, occupantsAt, onApplied }: Props) {
  const [step, setStep] = useState(0);
  // The editor mounts this fresh on each opening, so these start from the cells picked on the grid, if any.
  const [day, setDay] = useState<DayOfWeek>(initial?.day ?? days[0] ?? "MON");
  const [start, setStart] = useState(initial?.start ?? 1);
  const [end, setEnd] = useState(initial?.end ?? 1);
  const [subjectId, setSubjectId] = useState("");
  const [picked, setPicked] = useState<string[]>([]); // assignment ids
  const [batchBy, setBatchBy] = useState<Record<string, string>>({});
  const [midBy, setMidBy] = useState<Record<string, string>>({});
  const [batches, setBatches] = useState<string[]>([]);
  const [defaultBatch, setDefaultBatch] = useState<Record<string, string>>({}); // facultyId -> configured batch
  const [midCount, setMidCount] = useState(0);
  const [busy, setBusy] = useState(false);

  // The batches configured for this section and the college's mid count, read each time the dialog opens.
  useEffect(() => {
    if (!open) return;
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
  }, [open, sectionId]);

  const subjects = useMemo(() => {
    const seen = new Map<string, string>();
    for (const a of assignments) if (!a.isPast && !seen.has(a.subjectId)) seen.set(a.subjectId, a.subjectName);
    return Array.from(seen, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [assignments]);
  const faculty = assignments.filter((a) => !a.isPast && a.subjectId === subjectId);
  const chosen = faculty.filter((a) => picked.includes(a.id));
  const count = end - start + 1;
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

  const canNext = step === 0 ? count >= 1 : step === 1 ? Boolean(subjectId) : step === 2 ? chosen.length > 0 : true;

  async function apply() {
    const problem = overlapProblem();
    if (problem) { toast({ variant: "destructive", title: "Cannot place these together", description: problem }); return; }
    setBusy(true);
    try {
      const occupants = occupantsAt(day, start);
      const sameSubjectHere = occupants.some((o) => o.subjectId === subjectId);
      let latest: DraftSlot[] | undefined;
      for (let i = 0; i < chosen.length; i++) {
        const a = chosen[i];
        // Same flags the editor's own Add uses: join a subject already here, or split with a different one.
        const flags = i > 0 || sameSubjectHere ? { coTeach: true } : occupants.length > 0 ? { allowSplit: true } : {};
        const res = await fetch("/api/college/timetable/draft", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sectionId, ...semesterBody, action: "add", assignmentId: a.id, toDay: day, toPeriod: start, blockSize: count, ...flags,
            ...(batchOf(a) ? { labBatch: batchOf(a), batchPinned: true } : {}),
            ...(midOf(a) ? { midScope: Number(midOf(a)) } : {}),
          }),
        });
        const json = (await res.json().catch(() => ({}))) as { slots?: DraftSlot[]; error?: string };
        if (!res.ok) {
          if (latest) onApplied(latest);
          toast({
            variant: "destructive",
            title: i === 0 ? "Cannot add here" : `Placed ${chosen.slice(0, i).map((x) => x.facultyName).join(", ")}, but not ${a.facultyName}`,
            description: json.error,
          });
          return;
        }
        latest = json.slots;
      }
      if (latest) onApplied(latest);
      toast({ variant: "success", title: "Added to the draft", description: "Publish the timetable to make it live." });
      onOpenChange(false);
      setStep(0);
    } finally {
      setBusy(false);
    }
  }

  const periodOptions = Array.from({ length: numberOfPeriods }, (_, i) => i + 1);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Flexible cell - {STEPS[step]} ({step + 1} of {STEPS.length})</DialogTitle>
          <DialogDescription>
            {step === 0 && "Pick the day and the period, or a run of consecutive periods (a break in between is fine)."}
            {step === 1 && "Which subject is taught in these periods?"}
            {step === 2 && "Which faculty of this subject take these periods?"}
            {step === 3 && "Which batch does each faculty take? Leave it on Whole class if they take everyone."}
            {step === 4 && "Should a faculty take these periods all semester, or only up to one mid exam? Mid dates come from the Exam Cell."}
          </DialogDescription>
        </DialogHeader>

        {step === 0 && (
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>Day</Label>
              <Select value={day} onValueChange={(v) => setDay(v as DayOfWeek)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{days.map((d) => <SelectItem key={d} value={d}>{DAY_LABELS[d]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>From period</Label>
              <Select value={String(start)} onValueChange={(v) => { const n = Number(v); setStart(n); if (end < n) setEnd(n); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{periodOptions.map((p) => <SelectItem key={p} value={String(p)}>{p}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>To period</Label>
              <Select value={String(end)} onValueChange={(v) => setEnd(Number(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{periodOptions.filter((p) => p >= start).map((p) => <SelectItem key={p} value={String(p)}>{p}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
        )}

        {step === 1 && (
          <Select value={subjectId} onValueChange={pickSubject}>
            <SelectTrigger><SelectValue placeholder="Select subject" /></SelectTrigger>
            <SelectContent>{subjects.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
          </Select>
        )}

        {step === 2 && (
          <div className="space-y-2 rounded-md border p-3">
            {faculty.map((a) => (
              <label key={a.id} className="flex items-center gap-2 text-sm">
                <Checkbox checked={picked.includes(a.id)} onCheckedChange={(c) => setPicked((p) => (c ? [...p, a.id] : p.filter((x) => x !== a.id)))} />
                {a.facultyName}
              </label>
            ))}
          </div>
        )}

        {step === 3 && (
          <div className="space-y-2">
            {chosen.map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-3">
                <span className="text-sm">{a.facultyName}</span>
                <Select value={batchOf(a) || WHOLE} onValueChange={(v) => setBatchBy((m) => ({ ...m, [a.id]: v === WHOLE ? "" : v }))}>
                  <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={WHOLE}>Whole class</SelectItem>
                    {batches.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            ))}
            {batches.length === 0 && <p className="text-xs text-muted-foreground">No lab batches are set up for this section, so only Whole class is offered.</p>}
          </div>
        )}

        {step === 4 && (
          <div className="space-y-3">
            {chosen.map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-3">
                <span className="text-sm">{a.facultyName}</span>
                <Select value={midOf(a) || FULL} onValueChange={(v) => setMidBy((m) => ({ ...m, [a.id]: v === FULL ? "" : v }))}>
                  <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={FULL}>Full semester</SelectItem>
                    {Array.from({ length: midCount }, (_, i) => i + 1).map((n) => <SelectItem key={n} value={String(n)}>Up to Mid {n}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            ))}
            {midCount === 0 && <p className="text-xs text-muted-foreground">The Exam Cell hasn&apos;t set up mid exams yet, so only Full semester is offered.</p>}
            <p className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
              {DAY_LABELS[day]}, period{count > 1 ? `s ${start}-${end}` : ` ${start}`}: {chosen.map((a) => `${a.facultyName} (${batchOf(a) || "whole class"}, ${midOf(a) ? `up to Mid ${midOf(a)}` : "full semester"})`).join("; ")}.
              After the last mid, attendance for a mid-scoped period is closed.
            </p>
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="ghost" disabled={step === 0 || busy} onClick={() => setStep((s) => s - 1)}>Back</Button>
          {step < STEPS.length - 1 ? (
            <Button disabled={!canNext} onClick={() => setStep((s) => s + 1)}>Next</Button>
          ) : (
            <Button loading={busy} disabled={chosen.length === 0} onClick={() => void apply()}>Add to timetable</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
