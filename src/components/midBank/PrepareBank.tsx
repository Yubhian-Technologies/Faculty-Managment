"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, BookOpen, CalendarClock, Check, FileText, Layers, ListChecks, Lock, Minus, Plus, Target, Users } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/hooks/useToast";
import { cn } from "@/lib/utils";
import { istDateKey } from "@/lib/attendance/istTime";
import { LIMITS, MAPPING_TARGETS, PROGRAM_OUTCOMES } from "@/lib/midBank/constants";
import { deadlineLabel } from "@/lib/midBank/deadline";
import { bankFormatText } from "@/lib/midBank/validateQuestion";
import type { MidBankPrepare } from "@/lib/midBank/clientTypes";
import type { OutcomeMapping } from "@/types";

// The question bank setup as a 4-step wizard, the subject card and the steps on
// the left: 1. Sections (own, and optionally colleagues' sections of the subject
// in the branch) -> 2. Course Outcomes (units + CO statements) -> 3. CO-PO
// Mapping (tick the POs / PSOs each CO maps to) -> 4. Question Bank (the
// workspace). Units, COs and the mapping belong to the subject in the branch:
// entered by whoever prepares first, reused by Mid 2.

export type PrepareStep = 1 | 2 | 3;
interface Draft { units: string[]; cos: string[]; mapping: OutcomeMapping }

const fromData = (d: MidBankPrepare): Draft => ({
  units: d.outcomes?.units.map((u) => u.title) ?? Array.from({ length: 5 }, () => ""),
  cos: d.outcomes?.cos.map((c) => c.statement) ?? Array.from({ length: 5 }, () => ""),
  mapping: d.outcomes?.mapping ?? {},
});
const resize = (list: string[], n: number) => Array.from({ length: n }, (_, i) => list[i] ?? "");

/** Whole days from today (IST) to the deadline day; negative once it has passed. */
function daysLeft(deadline: string): number | null {
  const a = Date.parse(`${istDateKey()}T00:00:00Z`);
  const b = Date.parse(`${deadline}T00:00:00Z`);
  return Number.isNaN(a) || Number.isNaN(b) ? null : Math.round((b - a) / 86_400_000);
}

const initials = (name: string) => name.replace(/^(dr|mr|mrs|ms|prof)\.?\s*/i, "").split(/[\s.]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";

/** "Number of units: [-] 5 [+]" - typing a number works too. */
function CountInput({ id, label, value, max, disabled, onChange }: { id: string; label: string; value: number; max: number; disabled?: boolean; onChange: (n: number) => void }) {
  const set = (n: number) => onChange(Math.max(1, Math.min(max, Math.floor(n || 1))));
  return (
    <div className="flex items-center gap-3">
      <Label htmlFor={id} className="text-sm font-medium">{label}</Label>
      <div className="flex items-center rounded-lg border bg-background shadow-xs">
        <button type="button" aria-label={`Fewer - ${label}`} disabled={disabled || value <= 1} onClick={() => set(value - 1)}
          className="grid h-8 w-8 place-items-center rounded-l-lg text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40">
          <Minus className="h-3.5 w-3.5" />
        </button>
        <Input id={id} type="number" min={1} max={max} value={value} disabled={disabled}
          className="h-8 w-12 rounded-none border-0 border-x px-0 text-center font-semibold shadow-none [appearance:textfield] focus-visible:ring-0 [&::-webkit-inner-spin-button]:appearance-none"
          onChange={(e) => set(Number(e.target.value))} />
        <button type="button" aria-label={`More - ${label}`} disabled={disabled || value >= max} onClick={() => set(value + 1)}
          className="grid h-8 w-8 place-items-center rounded-r-lg text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40">
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      <span className="text-xs text-muted-foreground">max {max}</span>
    </div>
  );
}

/** One CO's POs / PSOs as toggle chips (PO1-PO11, PSO1, PSO2); hover a chip for the PO's title. */
function MappingChips({ co, value, onChange, disabled }: { co: string; value: string[]; onChange: (v: string[]) => void; disabled?: boolean }) {
  return (
    <div role="group" aria-label={`POs and PSOs for ${co}`} className="flex flex-wrap gap-1.5">
      {MAPPING_TARGETS.map((t) => {
        const on = value.includes(t);
        const pso = t.startsWith("PSO");
        return (
          <button key={t} type="button" aria-pressed={on} disabled={disabled}
            title={PROGRAM_OUTCOMES.find((p) => p.id === t)?.title ?? "Programme-specific outcome"}
            onClick={() => onChange(on ? value.filter((x) => x !== t) : [...value, t].sort((a, b) => MAPPING_TARGETS.indexOf(a) - MAPPING_TARGETS.indexOf(b)))}
            className={cn(
              "inline-flex h-8 min-w-14 items-center justify-center gap-1 rounded-full border px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-60",
              on ? "border-primary bg-primary text-primary-foreground shadow-sm"
                : cn("bg-background text-muted-foreground hover:border-primary/50 hover:text-foreground", pso && "border-dashed"),
            )}>
            {on && <Check className="h-3 w-3" />}{t}
          </button>
        );
      })}
    </div>
  );
}

/** A step's heading inside its card: icon, title, one-line help. */
function StepHeading({ icon: Icon, title, children }: { icon: typeof Users; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><Icon className="h-5 w-5" /></span>
      <div>
        <h2 className="text-lg font-semibold leading-tight">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{children}</p>
      </div>
    </div>
  );
}

export function PrepareBank({ data, step, onStep, onChanged }: {
  data: MidBankPrepare; step: PrepareStep; onStep: (s: PrepareStep) => void; onChanged: () => void;
}) {
  const router = useRouter();
  const { subject, outcomes, rules, setup, deadline, sections, branch, myBankId, canEditOutcomes } = data;
  const [draft, setDraft] = useState<Draft>(() => fromData(data));
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(sections
    .filter((s) => (myBankId ? s.heldByMe : s.mine && !s.heldBy))
    .map((s) => s.sectionId)));
  const locked = deadline.locked;
  const readOnly = locked || !canEditOutcomes;
  const pickedMine = sections.some((s) => s.mine && picked.has(s.sectionId));
  const examCellIssues = setup.issues.filter((i) => i.who === "EXAM_CELL");
  const bankHref = myBankId ? `/panel/mid-bank/${encodeURIComponent(myBankId)}` : null;

  async function putOutcomes(): Promise<boolean> {
    const res = await fetch(`/api/college/subject-outcomes/${encodeURIComponent(data.outcomesId)}`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        deadlineId: deadline.id, subjectId: subject.id, branch, baseVersion: outcomes?.version ?? 0,
        units: draft.units.map((title) => ({ title })), cos: draft.cos.map((statement) => ({ statement })), mapping: draft.mapping,
      }),
    });
    const json = (await res.json()) as { error?: string; errors?: string[] };
    if (!res.ok) { setErrors(json.errors ?? [json.error ?? "Failed to save"]); return false; }
    return true;
  }

  async function next() {
    setErrors([]);
    setBusy(true);
    try {
      if (step === 1) {
        if (!pickedMine) { setErrors(["Include at least one section you teach"]); return; }
        if (myBankId) {
          const res = await fetch(`/api/college/mid-question-banks/${encodeURIComponent(myBankId)}`, {
            method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sectionIds: [...picked] }),
          });
          const json = (await res.json()) as { error?: string };
          if (!res.ok) { setErrors([json.error ?? "Could not save the sections"]); return; }
          toast({ variant: "success", title: "Sections saved" });
        }
        onStep(2);
      } else if (step === 2) {
        if (!readOnly && !(await putOutcomes())) return;
        if (!readOnly) { toast({ variant: "success", title: "Course Outcomes saved" }); onChanged(); }
        onStep(3);
      } else {
        const unmapped = draft.cos.map((_, i) => `CO${i + 1}`).filter((co) => (draft.mapping[co] ?? []).length === 0);
        if (unmapped.length) { setErrors(unmapped.map((co) => `${co} needs at least one PO or PSO`)); return; }
        if (!readOnly && !(await putOutcomes())) return;
        if (myBankId) { router.push(bankHref!); return; }
        if (examCellIssues.length) { onChanged(); setErrors([examCellIssues[0].message]); return; }
        const res = await fetch("/api/college/mid-question-banks", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deadlineId: deadline.id, subjectId: subject.id, branch, sectionIds: [...picked] }),
        });
        const json = (await res.json()) as { error?: string; bank?: { id: string } };
        if (!res.ok || !json.bank) { setErrors([json.error ?? "Could not start the question bank"]); onChanged(); return; }
        toast({ variant: "success", title: "Question bank started" });
        router.push(`/panel/mid-bank/${encodeURIComponent(json.bank.id)}`);
      }
    } catch {
      setErrors(["Network error - nothing was saved"]);
    } finally {
      setBusy(false);
    }
  }

  const steps: { n: 1 | 2 | 3 | 4; label: string; hint: string; done: boolean }[] = [
    { n: 1, label: "Sections", hint: "Who this bank is for", done: pickedMine },
    { n: 2, label: "Course Outcomes", hint: "Units and COs", done: Boolean(outcomes) },
    { n: 3, label: "CO-PO Mapping", hint: "POs / PSOs per CO", done: Boolean(outcomes) && !setup.issues.some((i) => i.code === "MAPPING_MISSING" || i.code === "NO_OUTCOMES") },
    { n: 4, label: "Question Bank", hint: "Write the questions", done: Boolean(myBankId) },
  ];
  const left = daysLeft(deadline.deadline);
  const pickedCount = sections.filter((s) => picked.has(s.sectionId)).length;
  const mappedCount = draft.cos.filter((_, i) => (draft.mapping[`CO${i + 1}`] ?? []).length > 0).length;

  return (
    <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
      {/* Left: the subject and the steps */}
      <aside className="space-y-4 lg:sticky lg:top-4 lg:self-start">
        <Card className="overflow-hidden p-0">
          <div className="bg-gradient-to-br from-primary to-primary/80 p-4 text-primary-foreground">
            <div className="flex items-center gap-2 text-xs font-medium opacity-90"><BookOpen className="h-3.5 w-3.5" />{subject.code}</div>
            <p className="mt-1 text-base font-semibold leading-snug">{subject.name}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-semibold">Mid {deadline.midNumber}</span>
              <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold",
                locked ? "bg-red-100 text-red-800" : left !== null && left <= 2 ? "bg-amber-100 text-amber-900" : "bg-white text-primary")}>
                {locked ? <Lock className="h-3 w-3" /> : <CalendarClock className="h-3 w-3" />}
                {locked ? "Locked" : left === 0 ? "Due today" : left === 1 ? "1 day left" : left !== null ? `${left} days left` : deadlineLabel(deadline.deadline)}
              </span>
            </div>
          </div>
          <CardContent className="p-4">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs">
              {[
                ["Degree", subject.courseName], ["Branch", branch], ["Regulation", subject.regulation || "-"],
                ["Year · Semester", `Year ${subject.year} · Semester ${subject.semester}`], ["Deadline", deadlineLabel(deadline.deadline)],
              ].map(([k, v]) => (
                <div key={k} className="contents"><dt className="text-muted-foreground">{k}</dt><dd className="text-right font-medium">{v}</dd></div>
              ))}
            </dl>
          </CardContent>
        </Card>

        <nav aria-label="Setup steps">
          <ol className="relative space-y-1">
            {steps.map((s, idx) => {
              const active = s.n === step;
              const enabled = s.n === 4 ? Boolean(myBankId) : true;
              return (
                <li key={s.n} className="relative">
                  {idx < steps.length - 1 && <span aria-hidden className={cn("absolute left-[1.6rem] top-11 h-[calc(100%-1.75rem)] w-0.5", s.done ? "bg-emerald-500/60" : "bg-border")} />}
                  <button type="button" disabled={!enabled}
                    aria-current={active ? "step" : undefined}
                    onClick={() => (s.n === 4 ? bankHref && router.push(bankHref) : onStep(s.n as PrepareStep))}
                    className={cn("flex w-full items-center gap-3 rounded-xl p-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
                      active ? "bg-primary/10" : "hover:bg-muted")}>
                    <span className={cn("relative z-10 grid h-8 w-8 shrink-0 place-items-center rounded-full border-2 text-sm font-semibold",
                      active ? "border-primary bg-primary text-primary-foreground shadow-md shadow-primary/30"
                        : s.done ? "border-emerald-500 bg-emerald-500 text-white" : "border-border bg-background text-muted-foreground")}>
                      {s.done && !active ? <Check className="h-4 w-4" aria-label="done" /> : s.n}
                    </span>
                    <span className="min-w-0">
                      <span className={cn("block text-sm font-medium", active && "text-primary")}>{s.label}</span>
                      <span className="block text-xs text-muted-foreground">{s.hint}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>
      </aside>

      {/* Right: the current step */}
      <section className="min-w-0 space-y-4">
        {locked && (
          <p className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300" role="status"><Lock className="h-4 w-4 shrink-0" />{deadlineLabel(deadline.deadline)} - locked. Ask the Exam Cell to extend the deadline.</p>
        )}
        {examCellIssues.length > 0 && (
          <p className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{examCellIssues[0].message}</p>
        )}
        {rules && examCellIssues.length === 0 && (
          <div className="grid gap-2 sm:grid-cols-3">
            {[
              { icon: Layers, label: `Mid ${deadline.midNumber} covers`, value: `Units ${setup.units.join(", ")}` },
              { icon: FileText, label: "Question format", value: bankFormatText(rules.format, rules.marks) },
              { icon: ListChecks, label: "Each unit", value: "10 questions · L2, L3, L4 at least 3 each" },
            ].map(({ icon: Icon, label, value }) => (
              <div key={label} className="flex items-start gap-2.5 rounded-xl border bg-card p-3">
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <div className="min-w-0"><p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p><p className="text-sm font-medium">{value}</p></div>
              </div>
            ))}
          </div>
        )}

        {step === 1 && (
          <Card className="rounded-2xl">
            <CardContent className="space-y-5 p-6">
              <StepHeading icon={Users} title="Sections">
                Tick the sections this question bank is for: yours, and if you prepare it for them too, colleagues&rsquo; sections of {subject.name} in {branch}. They are told, and can only view it.
              </StepHeading>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{sections.length} section{sections.length === 1 ? "" : "s"} teach this subject in {branch}</span>
                <span className="rounded-full bg-primary/10 px-2.5 py-0.5 font-semibold text-primary">{pickedCount} selected</span>
              </div>
              <ul className="grid gap-3 sm:grid-cols-2">
                {sections.map((s) => {
                  const heldElsewhere = Boolean(s.heldBy) && !s.heldByMe;
                  const on = picked.has(s.sectionId);
                  const who = s.mine ? "You" : s.facultyNames.join(", ");
                  return (
                    <li key={s.sectionId}>
                      <label htmlFor={`sec-${s.sectionId}`}
                        className={cn("flex h-full items-center gap-3 rounded-xl border-2 p-3.5 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                          heldElsewhere || locked ? "cursor-not-allowed bg-muted/40 opacity-70"
                            : on ? "cursor-pointer border-primary bg-primary/5" : "cursor-pointer border-border hover:border-primary/40 hover:bg-muted/40")}>
                        <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-semibold",
                          s.mine ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>{s.mine ? "You" : initials(s.facultyNames[0] ?? "")}</span>
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className="font-semibold">Section {s.sectionName}</span>
                            {s.mine && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">Yours</span>}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">{heldElsewhere ? `Already in ${s.heldBy}\u2019s bank` : who}</span>
                        </span>
                        {heldElsewhere ? <Lock className="h-4 w-4 text-muted-foreground" aria-label="taken" />
                          : <Checkbox id={`sec-${s.sectionId}`} checked={on} disabled={heldElsewhere || locked}
                              onCheckedChange={(v) => setPicked((p) => { const n = new Set(p); if (v === true) n.add(s.sectionId); else n.delete(s.sectionId); return n; })} />}
                      </label>
                    </li>
                  );
                })}
              </ul>
              {!pickedMine && <p className="text-xs text-amber-700 dark:text-amber-400">Include at least one of your own sections to continue.</p>}
            </CardContent>
          </Card>
        )}

        {step === 2 && (
          <Card className="rounded-2xl">
            <CardContent className="space-y-6 p-6">
              <StepHeading icon={BookOpen} title="Course Outcomes">
                Enter the number of units and COs in the syllabus, then each one. Reducing a number removes the higher ones (and a CO&rsquo;s PO mapping).
                {outcomes && ` Last saved by ${outcomes.updatedByName || "a colleague"}.`}
                {!canEditOutcomes && !locked && ` Set by ${outcomes?.updatedByName || "a colleague"} - read-only for you.`}
              </StepHeading>

              <div className="space-y-3 rounded-xl border bg-muted/20 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">Syllabus units</h3>
                  <CountInput id="n-units" label="Number of units" value={draft.units.length} max={LIMITS.units} disabled={readOnly} onChange={(n) => !readOnly && setDraft((d) => ({ ...d, units: resize(d.units, n) }))} />
                </div>
                <ol className="space-y-2">
                  {draft.units.map((t, i) => (
                    <li key={i} className="flex items-center gap-3">
                      <Label htmlFor={`unit-${i}`} className="grid h-9 w-16 shrink-0 place-items-center rounded-lg bg-background text-xs font-semibold text-muted-foreground ring-1 ring-border">Unit {i + 1}</Label>
                      <Input id={`unit-${i}`} value={t} disabled={readOnly} placeholder="e.g. Linear data structures" className="bg-background"
                        onChange={(e) => setDraft((d) => ({ ...d, units: d.units.map((x, j) => (j === i ? e.target.value : x)) }))} />
                    </li>
                  ))}
                </ol>
              </div>

              <div className="space-y-3 rounded-xl border bg-muted/20 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">Course outcomes (COs)</h3>
                  <CountInput id="n-cos" label="Number of COs" value={draft.cos.length} max={LIMITS.cos} disabled={readOnly}
                    onChange={(n) => !readOnly && setDraft((d) => {
                      const mapping = Object.fromEntries(Object.entries(d.mapping).filter(([co]) => Number(co.slice(2)) <= n));
                      return { ...d, cos: resize(d.cos, n), mapping };
                    })} />
                </div>
                <ol className="space-y-2">
                  {draft.cos.map((t, i) => (
                    <li key={i} className="flex items-start gap-3">
                      <Label htmlFor={`co-${i}`} className="mt-1 grid h-9 w-16 shrink-0 place-items-center rounded-lg bg-primary/10 text-xs font-bold text-primary">CO{i + 1}</Label>
                      <Textarea id={`co-${i}`} rows={2} value={t} disabled={readOnly} placeholder="The student will be able to ..." className="bg-background"
                        onChange={(e) => setDraft((d) => ({ ...d, cos: d.cos.map((x, j) => (j === i ? e.target.value : x)) }))} />
                    </li>
                  ))}
                </ol>
              </div>
            </CardContent>
          </Card>
        )}

        {step === 3 && (
          <Card className="rounded-2xl">
            <CardContent className="space-y-5 p-6">
              <StepHeading icon={Target} title="CO-PO Mapping">
                Tick the POs and PSOs each CO contributes to, as per the syllabus. Every CO needs at least one. When you pick a CO for a question, its POs / PSOs are shown automatically.
              </StepHeading>
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>Hover a PO for its title · PSOs have a dashed border</span>
                <span className={cn("rounded-full px-2.5 py-0.5 font-semibold", mappedCount === draft.cos.length ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300" : "bg-primary/10 text-primary")}>
                  {mappedCount} of {draft.cos.length} COs mapped
                </span>
              </div>
              <ul className="space-y-3">
                {draft.cos.map((statement, i) => {
                  const co = `CO${i + 1}`;
                  const done = (draft.mapping[co] ?? []).length > 0;
                  return (
                    <li key={co} className={cn("rounded-xl border p-4", done ? "border-emerald-300/70 bg-emerald-50/40 dark:border-emerald-900 dark:bg-emerald-950/10" : "bg-card")}>
                      <div className="mb-3 flex items-start gap-3">
                        <span className="grid h-8 w-12 shrink-0 place-items-center rounded-lg bg-primary/10 text-xs font-bold text-primary">{co}</span>
                        <p className={cn("pt-1.5 text-sm", statement ? "" : "italic text-muted-foreground")}>{statement || "No statement yet - add it in Course Outcomes."}</p>
                        {done && <Check className="ml-auto mt-1.5 h-4 w-4 shrink-0 text-emerald-600" aria-label="mapped" />}
                      </div>
                      <MappingChips co={co} value={draft.mapping[co] ?? []} disabled={readOnly}
                        onChange={(v) => setDraft((d) => ({ ...d, mapping: { ...d.mapping, [co]: v } }))} />
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        )}

        {errors.length > 0 && (
          <ul className="space-y-1 rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive" role="alert">
            {errors.map((e) => <li key={e} className="flex gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{e}</li>)}
          </ul>
        )}

        <div className="flex items-center justify-between gap-2 rounded-2xl border bg-card p-3 shadow-sm">
          <Button variant="ghost" disabled={step === 1 || busy} onClick={() => onStep((step - 1) as PrepareStep)}>Back</Button>
          <span className="hidden text-xs text-muted-foreground sm:block">Step {step} of 4</span>
          {!(locked && step === 3) && (
            <Button size="lg" onClick={() => void next()} loading={busy} disabled={step === 1 && !pickedMine}>
              {step === 3 ? (myBankId ? "Save & open the question bank" : "Save & start the question bank") : "Save & Next"}
            </Button>
          )}
        </div>
      </section>
    </div>
  );
}
