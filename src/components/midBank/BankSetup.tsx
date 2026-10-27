"use client";

import { useState } from "react";
import { AlertTriangle, Lock, Plus, Trash2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/useToast";
import { PROGRAM_OUTCOMES } from "@/lib/midBank/constants";
import type { MidBankDetail } from "@/lib/midBank/clientTypes";
import type { CorrelationLevel, OutcomeMapping } from "@/types";

// Stage 2 of the bank: the subject's details (read-only, from FMS), the
// syllabus setup (units, Course Outcomes, PSOs, CO -> PO/PSO mapping) entered
// once per subject, the Exam Cell's rules for this Mid, and Start.

interface Draft { units: { title: string }[]; cos: { statement: string }[]; psos: { statement: string }[]; mapping: OutcomeMapping }

const fromDetail = (d: MidBankDetail): Draft => ({
  units: d.outcomes?.units.map((u) => ({ title: u.title })) ?? [{ title: "" }, { title: "" }, { title: "" }, { title: "" }, { title: "" }],
  cos: d.outcomes?.cos.map((c) => ({ statement: c.statement })) ?? [{ statement: "" }, { statement: "" }, { statement: "" }, { statement: "" }, { statement: "" }],
  psos: d.outcomes?.psos.map((p) => ({ statement: p.statement })) ?? [],
  mapping: d.outcomes?.mapping ?? {},
});

function ListEditor({ label, items, placeholder, onChange, multiline, prefix }: {
  label: string; items: string[]; placeholder: string; onChange: (next: string[]) => void; multiline?: boolean; prefix: string;
}) {
  return (
    <div className="space-y-2">
      {items.map((v, i) => (
        <div key={i} className="flex items-start gap-2">
          <Label htmlFor={`${prefix}-${i}`} className="mt-2 w-14 shrink-0 text-xs text-muted-foreground">{prefix}{i + 1}</Label>
          {multiline
            ? <Textarea id={`${prefix}-${i}`} rows={2} value={v} placeholder={placeholder} onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))} />
            : <Input id={`${prefix}-${i}`} value={v} placeholder={placeholder} onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))} />}
          <Button type="button" size="icon" variant="ghost" aria-label={`Remove ${prefix}${i + 1}`} onClick={() => onChange(items.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
        </div>
      ))}
      <Button type="button" size="sm" variant="outline" onClick={() => onChange([...items, ""])}><Plus className="mr-1 h-4 w-4" />Add {label}</Button>
    </div>
  );
}

export function BankSetup({ detail, onChanged }: { detail: MidBankDetail; onChanged: () => void }) {
  const { subject, outcomes, rules, setup, access, assignment, sections } = detail;
  const [draft, setDraft] = useState<Draft>(() => fromDetail(detail));
  const [editing, setEditing] = useState(!outcomes);
  const [saving, setSaving] = useState(false);
  const [starting, setStarting] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const canEdit = access.canEditOutcomes || (!outcomes && access.isHolder);
  const targets = [...PROGRAM_OUTCOMES.map((p) => p.id), ...draft.psos.map((_, i) => `PSO${i + 1}`)];

  function setCell(co: string, target: string, value: string) {
    setDraft((d) => {
      const row = { ...(d.mapping[co] ?? {}) };
      if (value) row[target] = Number(value) as CorrelationLevel; else delete row[target];
      return { ...d, mapping: { ...d.mapping, [co]: row } };
    });
  }

  async function saveOutcomes() {
    setSaving(true);
    setErrors([]);
    try {
      const res = await fetch(`/api/college/subject-outcomes/${encodeURIComponent(subject.id)}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, baseVersion: outcomes?.version ?? 0 }),
      });
      const data = (await res.json()) as { error?: string; errors?: string[] };
      if (!res.ok) { setErrors(data.errors ?? [data.error ?? "Failed to save"]); return; }
      toast({ variant: "success", title: "Syllabus setup saved" });
      setEditing(false);
      onChanged();
    } catch {
      setErrors(["Network error - nothing was saved"]);
    } finally {
      setSaving(false);
    }
  }

  async function start() {
    setStarting(true);
    try {
      const res = await fetch(`/api/college/mid-question-banks/${encodeURIComponent(assignment.id)}/start`, { method: "POST" });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Could not start the bank");
      onChanged();
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Could not start the bank" });
    } finally {
      setStarting(false);
    }
  }

  const examCellIssues = setup.issues.filter((i) => i.who === "EXAM_CELL");
  const facultyIssues = setup.issues.filter((i) => i.who === "FACULTY");

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Subject</CardTitle>
          <CardDescription>From FMS - nothing to enter here.</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
            <div><dt className="text-xs text-muted-foreground">Subject</dt><dd className="font-medium">{subject.name}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Code</dt><dd>{subject.code}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Course</dt><dd>{subject.courseName}{subject.regulation ? ` · ${subject.regulation}` : ""}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Year / Semester</dt><dd>Year {subject.year}{subject.semester ? ` · Sem ${subject.semester}` : ""}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Department</dt><dd>{subject.department}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Mid</dt><dd>Mid {assignment.midNumber}</dd></div>
            <div className="col-span-2"><dt className="text-xs text-muted-foreground">Your sections</dt><dd>{sections.join(", ") || "None on record"}</dd></div>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Exam Cell rules for this Mid</CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {examCellIssues.length > 0 ? (
            <p className="flex gap-2 text-amber-800 dark:text-amber-300"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{examCellIssues[0].message} You can finish the setup below meanwhile.</p>
          ) : rules ? (
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">Mid {assignment.midNumber}: Units {setup.units.join(", ")}</Badge>
              <Badge variant="outline">{rules.format === "PARTS_AB" ? `Parts (a) + (b), ${rules.marks / 2} marks each` : `One question, ${rules.marks} marks`}</Badge>
              <Badge variant="outline">10 questions per unit</Badge>
              <Badge variant="outline">L2, L3, L4 at least 3 each per unit</Badge>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
          <div>
            <CardTitle className="text-base">Syllabus setup</CardTitle>
            <CardDescription>
              Units, Course Outcomes and their CO-PO/PSO mapping for {subject.name}. Entered once and shared by every Mid of this subject.
              {outcomes && ` Last saved by ${outcomes.updatedByName || "faculty"}.`}
            </CardDescription>
          </div>
          {outcomes && !editing && (canEdit
            ? <Button size="sm" variant="outline" onClick={() => setEditing(true)}>Edit setup</Button>
            : <span className="flex items-center gap-1 text-xs text-muted-foreground"><Lock className="h-3.5 w-3.5" />Questions use it - your HOD can change it</span>)}
        </CardHeader>
        <CardContent className="space-y-6">
          {facultyIssues.map((i) => <p key={i.code} className="flex gap-2 text-sm text-amber-800 dark:text-amber-300"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{i.message}</p>)}
          {!editing && outcomes ? (
            <div className="grid gap-6 md:grid-cols-2 text-sm">
              <div>
                <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Units</p>
                <ol className="space-y-1">{outcomes.units.map((u) => <li key={u.no}><span className="font-medium">Unit {u.no}.</span> {u.title}</li>)}</ol>
              </div>
              <div>
                <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Course Outcomes</p>
                <ul className="space-y-1">{outcomes.cos.map((c) => <li key={c.id}><span className="font-medium">{c.id}.</span> {c.statement}</li>)}</ul>
              </div>
            </div>
          ) : !canEdit ? (
            <p className="text-sm text-muted-foreground">Only the faculty assigned this bank, or the HOD, can enter the syllabus setup.</p>
          ) : (
            <>
              <section className="space-y-2">
                <h3 className="text-sm font-semibold">Units</h3>
                <ListEditor label="unit" prefix="Unit " placeholder="Unit title, e.g. Sets and Relations" items={draft.units.map((u) => u.title)} onChange={(v) => setDraft((d) => ({ ...d, units: v.map((title) => ({ title })) }))} />
              </section>
              <section className="space-y-2">
                <h3 className="text-sm font-semibold">Course Outcomes</h3>
                <ListEditor label="CO" prefix="CO" multiline placeholder="The student will be able to ..." items={draft.cos.map((c) => c.statement)} onChange={(v) => setDraft((d) => ({ ...d, cos: v.map((statement) => ({ statement })) }))} />
              </section>
              <section className="space-y-2">
                <h3 className="text-sm font-semibold">Programme-Specific Outcomes (optional)</h3>
                <ListEditor label="PSO" prefix="PSO" multiline placeholder="PSO statement" items={draft.psos.map((p) => p.statement)} onChange={(v) => setDraft((d) => ({ ...d, psos: v.map((statement) => ({ statement })) }))} />
              </section>
              <section className="space-y-2">
                <h3 className="text-sm font-semibold">CO-PO/PSO mapping</h3>
                <p className="text-xs text-muted-foreground">1 = low, 2 = medium, 3 = high; leave blank for no correlation. Every CO needs at least one.</p>
                <div className="overflow-x-auto rounded-md border">
                  <table className="text-xs">
                    <thead className="bg-muted/50">
                      <tr><th className="sticky left-0 bg-muted/50 p-2 text-left">CO</th>{targets.map((t) => <th key={t} className="p-2 font-medium" title={PROGRAM_OUTCOMES.find((p) => p.id === t)?.title}>{t}</th>)}</tr>
                    </thead>
                    <tbody>
                      {draft.cos.map((_, ci) => {
                        const co = `CO${ci + 1}`;
                        return (
                          <tr key={co} className="border-t">
                            <th scope="row" className="sticky left-0 bg-background p-2 text-left">{co}</th>
                            {targets.map((t) => (
                              <td key={t} className="p-1">
                                <select aria-label={`${co} to ${t}`} className="h-8 w-12 rounded border border-input bg-background text-center" value={draft.mapping[co]?.[t] ?? ""} onChange={(e) => setCell(co, t, e.target.value)}>
                                  <option value="">-</option><option value="1">1</option><option value="2">2</option><option value="3">3</option>
                                </select>
                              </td>
                            ))}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
              {errors.length > 0 && (
                <ul className="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive" role="alert">
                  {errors.map((e) => <li key={e}>{e}</li>)}
                </ul>
              )}
              <div className="flex justify-end gap-2">
                {outcomes && <Button variant="ghost" onClick={() => { setDraft(fromDetail(detail)); setEditing(false); setErrors([]); }}>Cancel</Button>}
                <Button onClick={() => void saveOutcomes()} loading={saving}>Save setup</Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {access.isHolder && (
        <div className="flex items-center justify-end gap-3">
          {setup.issues.length > 0 && <span className="text-xs text-muted-foreground">Resolve the items above to start.</span>}
          <Button size="lg" onClick={() => void start()} loading={starting} disabled={setup.issues.length > 0 || editing}>Start writing questions</Button>
        </div>
      )}
    </div>
  );
}
