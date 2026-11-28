"use client";

import { compareStudentsForList } from "@/lib/students/listOrder";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/hooks/useToast";
import { cn, formatDateTime } from "@/lib/utils";
import { CeaUploadPanel } from "./CeaUploadPanel";
import { whenLabel } from "@/lib/cea/rules";
import type { CeaMarksSheet, CeaWhen } from "@/types";

// Faculty > CIE Marks (R26 Continuous Evaluation): for each section whose subject has a CIE plan, every unit's
// assessment - one total per student (0..unit marks, or Absent) for every unit, in class or with a Mid; in-class units
// also take the date held. Typed here unit by unit, or uploaded for every unit at once (CeaUploadPanel, saved as
// drafts). Submitted units add up into the internal-marks component the Exam Cell links to CIE.

type Unit = { unit: number; title: string; when: CeaWhen; typeLabel: string; status: "DRAFT" | "SUBMITTED" | null; enteredCount: number; totalStudents: number };
type Assignment = { assignmentId: string; subjectCode: string; subjectName: string; department: string; section: string; unitMarks: number; units: Unit[] };

export function CeaMarks({ start }: { start?: { assignmentId: string; unit: number } | null } = {}) {
  const [list, setList] = useState<Assignment[] | null>(null);
  const [error, setError] = useState("");
  // Opened from Mid Marks ("Enter on CIE Marks"): goes straight to that unit's sheet.
  const [open, setOpen] = useState<{ assignmentId: string; unit: number } | null>(start ?? null);
  const load = useCallback(() => {
    fetch("/api/college/cea/marks").then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? "Unable to load"); setList(j.assignments); setError(""); }).catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  const [submitting, setSubmitting] = useState("");
  // Submits every unit of a section whose marks are complete (in-class ones need their date held) - one by one.
  async function submitAll(a: Assignment) {
    const ready = a.units.filter((u) => u.status === "DRAFT" && u.totalStudents > 0 && u.enteredCount === u.totalStudents);
    if (ready.length === 0) { toast({ title: "No unit is complete yet. Enter every student's marks first." }); return; }
    setSubmitting(a.assignmentId);
    const done: number[] = [], failed: string[] = [];
    for (const u of ready) {
      try {
        const o = await fetch("/api/college/cea/marks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ assignmentId: a.assignmentId, unit: u.unit }) });
        const oj = await o.json();
        if (!o.ok) throw new Error(oj.error ?? "Unable to open");
        const r = await fetch(`/api/college/cea/marks/${encodeURIComponent(oj.sheet.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rev: oj.sheet.rev, action: "SUBMIT" }) });
        const rj = await r.json();
        if (!r.ok) throw new Error(rj.error ?? "Unable to submit");
        done.push(u.unit);
      } catch (e) { failed.push(`Unit ${u.unit}: ${e instanceof Error ? e.message : "Unable to submit"}`); }
    }
    setSubmitting("");
    if (done.length) toast({ variant: "success", title: `Unit ${done.join(", ")} submitted - added to internal marks.` });
    if (failed.length) toast({ variant: "destructive", title: `Unable to submit ${failed.length} unit${failed.length === 1 ? "" : "s"}.`, description: failed.join(" · ") });
    load();
  }

  if (open) return <SheetView {...open} onBack={() => { setOpen(null); load(); }} />;
  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader title="CIE Marks" description="Continuous Internal Evaluation (CIE) includes one assessment per unit, as planned by the Subject Department. Only submitted units are considered for internal marks." />
      {error ? <p className="text-sm text-destructive">{error}</p> : !list ? <div className="h-40 animate-pulse rounded-2xl bg-muted/40" /> : list.length === 0 ? (
        <p className="text-sm text-muted-foreground">None of your subjects has a CIE plan.</p>
      ) : list.map((a) => (
        <Card key={a.assignmentId} className="rounded-2xl"><CardContent className="space-y-3 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><p className="font-semibold">{a.subjectName} <span className="font-mono text-xs text-muted-foreground">{a.subjectCode}</span></p><p className="text-sm text-muted-foreground">{a.department} · Section {a.section} · {a.unitMarks} marks a unit</p></div>
            <div className="flex flex-wrap gap-2">
              <CeaUploadPanel assignmentId={a.assignmentId} onSaved={load} />
              <Button size="sm" onClick={() => void submitAll(a)} loading={submitting === a.assignmentId}
                disabled={!a.units.some((u) => u.status === "DRAFT" && u.totalStudents > 0 && u.enteredCount === u.totalStudents)}>Submit All Complete Units</Button>
            </div>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{a.units.map((u) => (
            <button key={u.unit} type="button" onClick={() => setOpen({ assignmentId: a.assignmentId, unit: u.unit })} className="rounded-lg border p-3 text-left hover:bg-muted/40">
              <p className="text-sm font-medium">Unit {u.unit} · {u.typeLabel}</p>
              <p className="text-xs text-muted-foreground">{whenLabel(u.when)}{u.title ? ` · ${u.title}` : ""}</p>
              <p className={cn("mt-1 text-xs font-medium", u.status === "SUBMITTED" ? "text-emerald-700 dark:text-emerald-300" : u.status ? "text-amber-700 dark:text-amber-300" : "text-muted-foreground")}>
                {u.status === "SUBMITTED" ? "Submitted" : u.status ? `Draft · ${u.enteredCount}/${u.totalStudents}` : "Not started"}
              </p>
            </button>
          ))}</div>
        </CardContent></Card>
      ))}
    </div>
  );
}

function SheetView({ assignmentId, unit, onBack }: { assignmentId: string; unit: number; onBack: () => void }) {
  const [sheet, setSheet] = useState<CeaMarksSheet | null>(null);
  const [draft, setDraft] = useState<Record<string, { marks: string; absent: boolean }>>({});
  const [heldOn, setHeldOn] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const take = (s: CeaMarksSheet) => {
    setSheet({ ...s, entries: [...s.entries].sort((x, y) => compareStudentsForList({ id: x.studentId, rollNumber: x.rollNumber, name: x.name }, { id: y.studentId, rollNumber: y.rollNumber, name: y.name })) }); setHeldOn(s.heldOn ?? "");
    setDraft(Object.fromEntries(s.entries.map((e) => [e.studentId, { marks: e.marks == null || e.absent ? "" : String(e.marks), absent: !!e.absent }])));
  };
  useEffect(() => {
    fetch("/api/college/cea/marks", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ assignmentId, unit }) })
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? "Unable to open"); take(j.sheet); })
      .catch((e: Error) => setError(e.message));
  }, [assignmentId, unit]);

  const valueOf = (id: string): number | null => {
    const d = draft[id];
    if (!d) return null;
    if (d.absent) return 0;
    return d.marks.trim() === "" ? null : Number(d.marks);
  };

  async function send(action?: "SUBMIT" | "REOPEN") {
    if (!sheet) return;
    setBusy(true);
    try {
      const entries = sheet.entries.map((e) => {
        const d = draft[e.studentId];
        return d.absent ? { studentId: e.studentId, absent: true } : { studentId: e.studentId, marks: d.marks.trim() === "" ? null : Number(d.marks) };
      });
      const r = await fetch(`/api/college/cea/marks/${encodeURIComponent(sheet.id)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rev: sheet.rev, action, ...(action === "REOPEN" ? {} : { entries, heldOn: heldOn || undefined }) }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Unable to save");
      take(j.sheet);
      toast({ variant: "success", title: action === "SUBMIT" ? "Submitted - added to internal marks" : action === "REOPEN" ? "Reopened" : "Saved" });
    } catch (e) { toast({ variant: "destructive", title: e instanceof Error ? e.message : "Unable to save" }); }
    finally { setBusy(false); }
  }

  if (error) return <div className="space-y-3"><Button variant="ghost" onClick={onBack}><ArrowLeft className="mr-1.5 h-4 w-4" />Back</Button><p className="text-sm text-destructive">{error}</p></div>;
  if (!sheet) return <div className="h-60 animate-pulse rounded-2xl bg-muted/40" />;
  const ro = sheet.status === "SUBMITTED";
  const inClass = sheet.when === "CLASS";
  const entered = sheet.entries.filter((e) => valueOf(e.studentId) != null).length;

  return (
    <div className="max-w-5xl space-y-4">
      <Button variant="ghost" onClick={onBack}><ArrowLeft className="mr-1.5 h-4 w-4" />All units</Button>
      <PageHeader title={`${sheet.subjectName} - Unit ${sheet.unit}`} description={`${sheet.typeLabel} · ${whenLabel(sheet.when)} · ${sheet.department} Section ${sheet.sectionName} · out of ${sheet.unitMarks}`} />
      <div className="flex flex-wrap items-end gap-3">
        {inClass && <div className="space-y-1"><label htmlFor="cea-held" className="text-xs text-muted-foreground">Held on</label><Input id="cea-held" type="date" className="w-44" disabled={ro} value={heldOn} onChange={(e) => setHeldOn(e.target.value)} /></div>}
        <p className="pb-2 text-sm text-muted-foreground">{entered} of {sheet.entries.length} entered</p>
      </div>
      <Card className="rounded-2xl"><CardContent className="overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr><th className="px-3 py-2">S.No</th><th className="px-3 py-2">Regd. No</th><th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Marks /{sheet.unitMarks}</th><th className="px-3 py-2">Absent</th></tr>
          </thead>
          <tbody className="divide-y">{sheet.entries.map((e, i) => {
            const d = draft[e.studentId];
            return (
              <tr key={e.studentId}>
                <td className="px-3 py-2 text-muted-foreground">{i + 1}</td><td className="px-3 py-2">{e.rollNumber || "-"}</td><td className="px-3 py-2 font-medium">{e.name}</td>
                <td className="px-3 py-2">
                  <Input type="number" min={0} max={sheet.unitMarks} step={0.5} className="h-8 w-20" disabled={ro || d.absent} aria-label={`Marks for ${e.name}`}
                    value={d.marks} onChange={(ev) => setDraft({ ...draft, [e.studentId]: { ...d, marks: ev.target.value } })} />
                </td>
                <td className="px-3 py-2"><Checkbox aria-label={`${e.name} absent`} disabled={ro} checked={d.absent} onCheckedChange={(c) => setDraft({ ...draft, [e.studentId]: { ...d, absent: !!c } })} /></td>
              </tr>
            );
          })}</tbody>
        </table>
      </CardContent></Card>
      <div className="flex flex-wrap gap-2">
        {ro ? <Button variant="outline" onClick={() => send("REOPEN")} disabled={busy}>Reopen to change</Button> : (
          <>
            <Button variant="outline" onClick={() => send()} disabled={busy}>Save draft</Button>
            <Button onClick={() => send("SUBMIT")} disabled={busy || entered < sheet.entries.length || (inClass && !heldOn)}>Submit</Button>
          </>
        )}
        <p className="self-center text-xs text-muted-foreground">{ro ? `Submitted ${sheet.submittedAt ? formatDateTime(new Date(sheet.submittedAt)) : ""}. Reopening is possible until the section's internal marks are submitted.` : "Absent counts as 0. Submitted units go into the internal-marks CIE column."}</p>
      </div>
    </div>
  );
}
