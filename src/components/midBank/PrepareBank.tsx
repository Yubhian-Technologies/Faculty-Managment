"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, Lock, Plus, Trash2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/hooks/useToast";
import { PROGRAM_OUTCOMES } from "@/lib/midBank/constants";
import { deadlineLabel } from "@/lib/midBank/deadline";
import { bankFormatText } from "@/lib/midBank/validateQuestion";
import type { MidBankPrepare } from "@/lib/midBank/clientTypes";
import type { CorrelationLevel, OutcomeMapping } from "@/types";

// Preparing a bank for one deadline + subject + branch: the subject (from FMS),
// the Exam Cell's rules, the branch's units / COs / CO-PO-PSO mapping (entered
// by whoever prepares first, reused by Mid 2), and the sections it covers - the
// faculty's own and, if they choose, colleagues' sections of the same subject
// (who then see the bank read-only). Also used later to change the sections.

interface Draft { units: { title: string }[]; cos: { statement: string }[]; psos: { statement: string }[]; mapping: OutcomeMapping }

const blank = (n: number) => Array.from({ length: n }, () => ({ title: "" }));
const fromData = (d: MidBankPrepare): Draft => ({
  units: d.outcomes?.units.map((u) => ({ title: u.title })) ?? blank(5),
  cos: d.outcomes?.cos.map((c) => ({ statement: c.statement })) ?? Array.from({ length: 5 }, () => ({ statement: "" })),
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

export function PrepareBank({ data, onChanged }: { data: MidBankPrepare; onChanged: () => void }) {
  const router = useRouter();
  const { subject, outcomes, rules, setup, deadline, sections, branch, myBankId, canEditOutcomes } = data;
  const [draft, setDraft] = useState<Draft>(() => fromData(data));
  const [editing, setEditing] = useState(!outcomes && canEditOutcomes);
  const [saving, setSaving] = useState(false);
  const [starting, setStarting] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  // Own sections not held by anyone else start ticked; for an existing bank, what it holds.
  const [picked, setPicked] = useState<Set<string>>(() => new Set(sections
    .filter((s) => (myBankId ? s.heldByMe : s.mine && !s.heldBy))
    .map((s) => s.sectionId)));
  const targets = [...PROGRAM_OUTCOMES.map((p) => p.id), ...draft.psos.map((_, i) => `PSO${i + 1}`)];
  const locked = deadline.locked;

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
      const res = await fetch(`/api/college/subject-outcomes/${encodeURIComponent(data.outcomesId)}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, deadlineId: deadline.id, subjectId: subject.id, branch, baseVersion: outcomes?.version ?? 0 }),
      });
      const json = (await res.json()) as { error?: string; errors?: string[] };
      if (!res.ok) { setErrors(json.errors ?? [json.error ?? "Failed to save"]); return; }
      toast({ variant: "success", title: "Syllabus setup saved" });
      setEditing(false);
      onChanged();
    } catch {
      setErrors(["Network error - nothing was saved"]);
    } finally {
      setSaving(false);
    }
  }

  async function submit() {
    setStarting(true);
    try {
      const res = myBankId
        ? await fetch(`/api/college/mid-question-banks/${encodeURIComponent(myBankId)}`, {
          method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sectionIds: [...picked] }),
        })
        : await fetch("/api/college/mid-question-banks", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ deadlineId: deadline.id, subjectId: subject.id, branch, sectionIds: [...picked] }),
        });
      const json = (await res.json()) as { error?: string; bank?: { id: string }; bankId?: string };
      if (!res.ok) throw new Error(json.error ?? "Could not save");
      const id = myBankId ?? json.bank?.id;
      toast({ variant: "success", title: myBankId ? "Sections updated" : "Question bank started" });
      if (id) router.push(`/panel/mid-bank/${encodeURIComponent(id)}`);
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Could not save" });
      onChanged();
    } finally {
      setStarting(false);
    }
  }

  const examCellIssues = setup.issues.filter((i) => i.who === "EXAM_CELL");
  const facultyIssues = setup.issues.filter((i) => i.who === "FACULTY");
  const pickedMine = sections.some((s) => s.mine && picked.has(s.sectionId));

  return (
    <div className="space-y-6">
      {locked && (
        <p className="flex items-center gap-2 rounded-md border bg-muted/40 p-3 text-sm" role="status"><Lock className="h-4 w-4" />{deadlineLabel(deadline.deadline)} - this question bank is locked. Ask the Exam Cell to extend the deadline.</p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Subject</CardTitle>
          <CardDescription>From FMS - nothing to enter here.</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
            <div><dt className="text-xs text-muted-foreground">Subject</dt><dd className="font-medium">{subject.name}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Code</dt><dd>{subject.code}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Branch</dt><dd>{branch}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Course</dt><dd>{subject.courseName}{subject.regulation ? ` · ${subject.regulation}` : ""}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Year / Semester</dt><dd>Year {subject.year} · Semester {subject.semester}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Mid</dt><dd>Mid {deadline.midNumber}</dd></div>
            <div className="col-span-2"><dt className="text-xs text-muted-foreground">Deadline</dt><dd>{deadlineLabel(deadline.deadline)}</dd></div>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Exam Cell rules for this Mid</CardTitle></CardHeader>
        <CardContent className="text-sm">
          {examCellIssues.length > 0 ? (
            <p className="flex gap-2 text-amber-800 dark:text-amber-300"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{examCellIssues[0].message} You can finish the syllabus setup meanwhile.</p>
          ) : rules ? (
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">Mid {deadline.midNumber}: Units {setup.units.join(", ")}</Badge>
              <Badge variant="outline">{bankFormatText(rules.format, rules.marks)}</Badge>
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
              Units, Course Outcomes and the CO-PO/PSO mapping of {subject.name} in {branch}. Entered once and reused by every Mid.
              {outcomes && ` Last saved by ${outcomes.updatedByName || "a colleague"}.`}
            </CardDescription>
          </div>
          {outcomes && !editing && !locked && (canEditOutcomes
            ? <Button size="sm" variant="outline" onClick={() => setEditing(true)}>Edit setup</Button>
            : <span className="flex items-center gap-1 text-xs text-muted-foreground"><Lock className="h-3.5 w-3.5" />Set by {outcomes.updatedByName || "a colleague"}</span>)}
        </CardHeader>
        <CardContent className="space-y-6">
          {facultyIssues.map((i) => <p key={i.code} className="flex gap-2 text-sm text-amber-800 dark:text-amber-300"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{i.message}</p>)}
          {!editing && outcomes ? (
            <div className="grid gap-6 text-sm md:grid-cols-2">
              <div>
                <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Units</p>
                <ol className="space-y-1">{outcomes.units.map((u) => <li key={u.no}><span className="font-medium">Unit {u.no}.</span> {u.title}</li>)}</ol>
              </div>
              <div>
                <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">Course Outcomes</p>
                <ul className="space-y-1">{outcomes.cos.map((c) => <li key={c.id}><span className="font-medium">{c.id}.</span> {c.statement}</li>)}</ul>
              </div>
            </div>
          ) : !editing ? (
            <p className="text-sm text-muted-foreground">Not set up yet.</p>
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
                {outcomes && <Button variant="ghost" onClick={() => { setDraft(fromData(data)); setEditing(false); setErrors([]); }}>Cancel</Button>}
                <Button onClick={() => void saveOutcomes()} loading={saving}>Save setup</Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sections this bank covers</CardTitle>
          <CardDescription>
            Your own sections, and - if you prepare it for them too - colleagues&rsquo; sections of {subject.name} in {branch}. They are told, and see the bank read-only.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2">
            {sections.map((s) => {
              const heldElsewhere = Boolean(s.heldBy) && !s.heldByMe;
              return (
                <li key={s.sectionId} className="flex items-center gap-3 text-sm">
                  <Checkbox
                    id={`sec-${s.sectionId}`}
                    checked={picked.has(s.sectionId)}
                    disabled={heldElsewhere || locked}
                    onCheckedChange={(v) => setPicked((p) => { const n = new Set(p); if (v === true) n.add(s.sectionId); else n.delete(s.sectionId); return n; })}
                  />
                  <Label htmlFor={`sec-${s.sectionId}`} className="font-normal">
                    <span className="font-medium">Section {s.sectionName}</span>
                    <span className="text-muted-foreground"> · {s.mine ? "you" : s.facultyNames.join(", ")}{heldElsewhere ? ` · in ${s.heldBy}'s bank` : ""}</span>
                  </Label>
                </li>
              );
            })}
          </ul>
          {!pickedMine && <p className="mt-2 text-xs text-amber-800 dark:text-amber-300">Include at least one section you teach.</p>}
        </CardContent>
      </Card>

      {!locked && (
        <div className="flex items-center justify-end gap-3">
          {myBankId && <Button asChild variant="ghost"><Link href={`/panel/mid-bank/${encodeURIComponent(myBankId)}`}>Back to the bank</Link></Button>}
          {!myBankId && setup.issues.length > 0 && <span className="text-xs text-muted-foreground">Resolve the items above to start.</span>}
          <Button size="lg" onClick={() => void submit()} loading={starting} disabled={(!myBankId && setup.issues.length > 0) || editing || !pickedMine}>
            {myBankId ? "Save sections" : "Start writing questions"}
          </Button>
        </div>
      )}
    </div>
  );
}
