"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, ChevronDown, Lock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "@/hooks/useToast";
import { cn } from "@/lib/utils";
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

function CountInput({ id, label, value, max, onChange }: { id: string; label: string; value: number; max: number; onChange: (n: number) => void }) {
  return (
    <div className="flex items-center gap-2">
      <Label htmlFor={id} className="text-sm font-medium">{label}</Label>
      <Input id={id} type="number" min={1} max={max} value={value} className="h-8 w-20"
        onChange={(e) => { const n = Math.max(1, Math.min(max, Math.floor(Number(e.target.value) || 1))); onChange(n); }} />
    </div>
  );
}

/** "Select POs / PSOs..." box for one CO: a tick-list of PO1-PO11, PSO1, PSO2. */
function MappingPicker({ co, value, onChange, disabled }: { co: string; value: string[]; onChange: (v: string[]) => void; disabled?: boolean }) {
  return (
    <Popover>
      <PopoverTrigger asChild disabled={disabled}>
        <button type="button" aria-label={`POs and PSOs for ${co}`}
          className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60">
          <span className={value.length ? "" : "text-muted-foreground"}>{value.length ? value.join(", ") : "Select POs / PSOs..."}</span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-3">
        <div className="grid grid-cols-4 gap-x-3 gap-y-2">
          {MAPPING_TARGETS.map((t) => {
            const on = value.includes(t);
            return (
              <label key={t} className="flex items-center gap-1.5 text-sm" title={PROGRAM_OUTCOMES.find((p) => p.id === t)?.title ?? "Programme-specific outcome"}>
                <Checkbox checked={on} onCheckedChange={(v) => onChange(v === true ? [...value, t].sort((a, b) => MAPPING_TARGETS.indexOf(a) - MAPPING_TARGETS.indexOf(b)) : value.filter((x) => x !== t))} />
                {t}
              </label>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
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

  const steps: { n: 1 | 2 | 3 | 4; label: string; done: boolean }[] = [
    { n: 1, label: "Sections", done: pickedMine },
    { n: 2, label: "Course Outcomes", done: Boolean(outcomes) },
    { n: 3, label: "CO-PO Mapping", done: Boolean(outcomes) && !setup.issues.some((i) => i.code === "MAPPING_MISSING" || i.code === "NO_OUTCOMES") },
    { n: 4, label: "Question Bank", done: Boolean(myBankId) },
  ];

  return (
    <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
      {/* Left: the subject and the steps */}
      <aside className="space-y-3">
        <Card>
          <CardContent className="p-4">
            <p className="mb-2 font-semibold">{subject.name}</p>
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              {[
                ["Subject code", subject.code], ["Degree", subject.courseName], ["Branch", branch],
                ["Regulation", subject.regulation || "-"], ["Year", String(subject.year)], ["Semester", String(subject.semester)],
                ["Mid", `Mid ${deadline.midNumber}`], ["Deadline", deadlineLabel(deadline.deadline)],
              ].map(([k, v]) => (
                <div key={k} className="contents"><dt className="text-muted-foreground">{k}</dt><dd className="text-right font-medium">{v}</dd></div>
              ))}
            </dl>
          </CardContent>
        </Card>
        <nav aria-label="Setup steps" className="space-y-2">
          {steps.map((s) => {
            const active = s.n === step;
            const enabled = s.n === 4 ? Boolean(myBankId) : true;
            return (
              <button key={s.n} type="button" disabled={!enabled}
                aria-current={active ? "step" : undefined}
                onClick={() => (s.n === 4 ? bankHref && router.push(bankHref) : onStep(s.n as PrepareStep))}
                className={cn("flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
                  active ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:bg-muted")}>
                <span>{s.n}. {s.label}</span>
                {s.done && !active && <Check className="h-4 w-4 text-green-600" aria-label="done" />}
              </button>
            );
          })}
        </nav>
      </aside>

      {/* Right: the current step */}
      <section className="min-w-0 space-y-4">
        {locked && (
          <p className="flex items-center gap-2 rounded-md border bg-muted/40 p-3 text-sm" role="status"><Lock className="h-4 w-4" />{deadlineLabel(deadline.deadline)} - locked. Ask the Exam Cell to extend the deadline.</p>
        )}
        {examCellIssues.length > 0 && (
          <p className="flex gap-2 rounded-md bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/30 dark:text-amber-300"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{examCellIssues[0].message}</p>
        )}
        {rules && examCellIssues.length === 0 && (
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant="outline">Mid {deadline.midNumber}: Units {setup.units.join(", ")}</Badge>
            <Badge variant="outline">{bankFormatText(rules.format, rules.marks)}</Badge>
            <Badge variant="outline">10 questions per unit · L2, L3, L4 at least 3 each</Badge>
          </div>
        )}

        {step === 1 && (
          <Card>
            <CardContent className="space-y-3 p-5">
              <div>
                <h2 className="text-lg font-semibold">Sections</h2>
                <p className="text-sm text-muted-foreground">Tick the sections this question bank is for: yours, and if you prepare it for them too, colleagues&rsquo; sections of {subject.name} in {branch}. They are told, and can only view it.</p>
              </div>
              <ul className="divide-y rounded-md border">
                {sections.map((s) => {
                  const heldElsewhere = Boolean(s.heldBy) && !s.heldByMe;
                  return (
                    <li key={s.sectionId} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                      <Checkbox id={`sec-${s.sectionId}`} checked={picked.has(s.sectionId)} disabled={heldElsewhere || locked}
                        onCheckedChange={(v) => setPicked((p) => { const n = new Set(p); if (v === true) n.add(s.sectionId); else n.delete(s.sectionId); return n; })} />
                      <Label htmlFor={`sec-${s.sectionId}`} className="flex-1 font-normal">
                        <span className="font-medium">Section {s.sectionName}</span>
                        <span className="text-muted-foreground"> · {s.mine ? "you" : s.facultyNames.join(", ")}</span>
                      </Label>
                      {heldElsewhere && <Badge variant="secondary">In {s.heldBy}&rsquo;s bank</Badge>}
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        )}

        {step === 2 && (
          <Card>
            <CardContent className="space-y-5 p-5">
              <div>
                <h2 className="text-lg font-semibold">Course Outcomes</h2>
                <p className="text-sm text-muted-foreground">
                  Enter the number of units and COs in the syllabus, then each one. Reducing a number removes the higher ones (and a CO&rsquo;s PO mapping).
                  {outcomes && ` Last saved by ${outcomes.updatedByName || "a colleague"}.`}
                  {!canEditOutcomes && !locked && ` Set by ${outcomes?.updatedByName || "a colleague"} - read-only for you.`}
                </p>
              </div>

              <div className="space-y-3">
                <CountInput id="n-units" label="Number of units" value={draft.units.length} max={LIMITS.units} onChange={(n) => !readOnly && setDraft((d) => ({ ...d, units: resize(d.units, n) }))} />
                <div className="overflow-hidden rounded-md border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground"><tr><th className="w-20 p-2">Unit</th><th className="p-2">Title</th></tr></thead>
                    <tbody>
                      {draft.units.map((t, i) => (
                        <tr key={i} className="border-t">
                          <td className="p-2 font-medium"><Label htmlFor={`unit-${i}`}>Unit {i + 1}</Label></td>
                          <td className="p-2"><Input id={`unit-${i}`} value={t} disabled={readOnly} placeholder="e.g. Linear data structures" onChange={(e) => setDraft((d) => ({ ...d, units: d.units.map((x, j) => (j === i ? e.target.value : x)) }))} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="space-y-3">
                <CountInput id="n-cos" label="Number of COs" value={draft.cos.length} max={LIMITS.cos}
                  onChange={(n) => !readOnly && setDraft((d) => {
                    const mapping = Object.fromEntries(Object.entries(d.mapping).filter(([co]) => Number(co.slice(2)) <= n));
                    return { ...d, cos: resize(d.cos, n), mapping };
                  })} />
                <div className="overflow-hidden rounded-md border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground"><tr><th className="w-20 p-2">CO</th><th className="p-2">CO statement</th></tr></thead>
                    <tbody>
                      {draft.cos.map((t, i) => (
                        <tr key={i} className="border-t align-top">
                          <td className="p-2 pt-4 font-medium"><Label htmlFor={`co-${i}`}>CO{i + 1}</Label></td>
                          <td className="p-2"><Textarea id={`co-${i}`} rows={2} value={t} disabled={readOnly} placeholder="The student will be able to ..." onChange={(e) => setDraft((d) => ({ ...d, cos: d.cos.map((x, j) => (j === i ? e.target.value : x)) }))} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {step === 3 && (
          <Card>
            <CardContent className="space-y-4 p-5">
              <div>
                <h2 className="text-lg font-semibold">CO-PO Mapping</h2>
                <p className="text-sm text-muted-foreground">Tick the POs and PSOs each CO contributes to, as per the syllabus. Every CO needs at least one. When you pick a CO for a question, its POs / PSOs are shown automatically.</p>
              </div>
              <div className="overflow-visible rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground"><tr><th className="w-20 p-2">CO</th><th className="p-2">Mapped POs / PSOs (click to choose)</th></tr></thead>
                  <tbody>
                    {draft.cos.map((statement, i) => {
                      const co = `CO${i + 1}`;
                      return (
                        <tr key={co} className="border-t align-top">
                          <td className="p-2 pt-4 font-medium" title={statement}>{co}</td>
                          <td className="p-2">
                            <MappingPicker co={co} value={draft.mapping[co] ?? []} disabled={readOnly}
                              onChange={(v) => setDraft((d) => ({ ...d, mapping: { ...d.mapping, [co]: v } }))} />
                            {statement && <p className="mt-1 truncate text-xs text-muted-foreground">{statement}</p>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {errors.length > 0 && (
          <ul className="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive" role="alert">
            {errors.map((e) => <li key={e}>{e}</li>)}
          </ul>
        )}

        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" disabled={step === 1 || busy} onClick={() => onStep((step - 1) as PrepareStep)}>Back</Button>
          {!(locked && step === 3) && (
            <Button onClick={() => void next()} loading={busy} disabled={step === 1 && !pickedMine}>
              {step === 3 ? (myBankId ? "Save & open the question bank" : "Save & start the question bank") : "Save & Next"}
            </Button>
          )}
        </div>
      </section>
    </div>
  );
}
