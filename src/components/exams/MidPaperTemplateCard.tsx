"use client";

import { useEffect, useMemo, useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { toast } from "@/hooks/useToast";
import { buildCourseGroups } from "@/lib/departments/hodScope";
import { BLOOM_LEVELS } from "@/lib/midBank/constants";
import { DEFAULT_INSTRUCTION, DEFAULT_REGD_BOXES, DEFAULT_SEQUENCES, defaultUnits, PAPER_QUESTIONS, REGD_BOXES_MAX, REGD_BOXES_MIN, UNIT_COUNTS } from "@/lib/midPaper/rules";
import type { BloomLevel, Course, MidPaperTemplate } from "@/types";

// Exam Cell > Mid Configuration > Question paper: the Mid question paper
// template per course (+ regulation). A paper is 6 questions in three OR-pairs
// (1 OR 2, 3 OR 4, 5 OR 6). For each level Question 1 may start at, the levels
// of all 6 questions; for each Mid size, the unit of each question (every unit
// the same number of questions).

const selectClass = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm";
const ROMAN = ["", "I", "II", "III", "IV", "V", "VI"];
const blankUnits = () => Object.fromEntries(UNIT_COUNTS.map((n) => [String(n), defaultUnits(n)]));

export function MidPaperTemplateCard() {
  const [templates, setTemplates] = useState<MidPaperTemplate[]>([]);
  const [regulationsByCourse, setRegulationsByCourse] = useState<Record<string, string[]>>({});
  const [courses, setCourses] = useState<Course[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [courseKey, setCourseKey] = useState("");
  const [regulation, setRegulation] = useState("");
  const [sequences, setSequences] = useState<Record<BloomLevel, BloomLevel[]>>(DEFAULT_SEQUENCES);
  const [units, setUnits] = useState<Record<string, number[]>>(blankUnits);
  const [instruction, setInstruction] = useState(DEFAULT_INSTRUCTION);
  const [maxMarks, setMaxMarks] = useState("");
  const [regdBoxes, setRegdBoxes] = useState(String(DEFAULT_REGD_BOXES));
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<MidPaperTemplate | null>(null);

  const groups = useMemo(() => buildCourseGroups(courses), [courses]);
  const regulationOptions = useMemo(() => {
    const regs = regulationsByCourse[courseKey] ?? [];
    return regulation && !regs.includes(regulation) ? [...regs, regulation] : regs;
  }, [regulationsByCourse, courseKey, regulation]);

  function load() {
    fetch("/api/college/mid-paper-templates")
      .then((r) => r.json() as Promise<{ templates?: MidPaperTemplate[]; regulationsByCourse?: Record<string, string[]> }>)
      .then((d) => { setTemplates(d.templates ?? []); setRegulationsByCourse(d.regulationsByCourse ?? {}); })
      .catch(() => toast({ variant: "destructive", title: "Failed to load the question paper templates" }));
  }
  useEffect(() => {
    load();
    fetch("/api/college/courses").then((r) => r.json() as Promise<{ courses?: Course[] }>).then((d) => setCourses(d.courses ?? [])).catch(() => undefined);
  }, []);

  function reset() {
    setEditingId(null); setCourseKey(""); setRegulation(""); setSequences(DEFAULT_SEQUENCES); setUnits(blankUnits()); setInstruction(DEFAULT_INSTRUCTION); setMaxMarks(""); setRegdBoxes(String(DEFAULT_REGD_BOXES));
  }
  function edit(t: MidPaperTemplate) {
    setEditingId(t.id); setCourseKey(t.courseKey); setRegulation(t.regulation === "ALL" ? "" : t.regulation);
    setSequences({ ...DEFAULT_SEQUENCES, ...t.sequences }); setUnits({ ...blankUnits(), ...t.units });
    setInstruction(t.instruction || DEFAULT_INSTRUCTION); setMaxMarks(t.maxMarks ? String(t.maxMarks) : ""); setRegdBoxes(String(t.regdBoxes ?? DEFAULT_REGD_BOXES));
  }

  async function save() {
    const group = groups.find((g) => g.key === courseKey);
    if (!group) { toast({ variant: "destructive", title: "Pick a course" }); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/college/mid-paper-templates", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courseKey, courseName: group.name, regulation: regulation || "ALL", sequences, units, instruction, maxMarks: maxMarks || null, regdBoxes: regdBoxes || DEFAULT_REGD_BOXES }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to save");
      toast({ variant: "success", title: `Question paper template saved for ${group.name}${regulation ? ` (${regulation})` : ""}` });
      reset();
      load();
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Failed to save" });
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!deleting) return;
    const res = await fetch(`/api/college/mid-paper-templates?id=${encodeURIComponent(deleting.id)}`, { method: "DELETE" });
    if (!res.ok) toast({ variant: "destructive", title: "Failed to delete" });
    setDeleting(null);
    load();
  }

  const unitCounts = (n: number) => Array.from({ length: n }, (_, i) => (units[String(n)] ?? []).filter((u) => u === i + 1).length);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Mid question paper template</CardTitle>
        <CardDescription>
          A paper is 6 questions in three OR-pairs (1 OR 2, 3 OR 4, 5 OR 6); every part of a question has the question&rsquo;s level.
          When generating, the Exam Cell picks the level of Question 1 - the other five follow the sequence set here.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {templates.length > 0 && (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr><th className="p-2">Course</th><th className="p-2">Regulation</th><th className="p-2">Starting at L2</th><th className="p-2">Max marks</th><th className="p-2">Regd. No boxes</th><th className="p-2" /></tr>
              </thead>
              <tbody>
                {templates.map((t) => (
                  <tr key={t.id} className="border-t">
                    <td className="p-2 font-medium">{t.courseName}</td>
                    <td className="p-2">{t.regulation === "ALL" ? <span className="text-muted-foreground">All</span> : t.regulation}</td>
                    <td className="p-2 font-mono text-xs">{(t.sequences.L2 ?? []).join(" · ")}</td>
                    <td className="p-2">{t.maxMarks ?? <span className="text-muted-foreground">3 x question marks</span>}</td>
                    <td className="p-2">{t.regdBoxes ?? DEFAULT_REGD_BOXES}</td>
                    <td className="whitespace-nowrap p-2 text-right">
                      <Button size="icon" variant="ghost" aria-label={`Edit the template for ${t.courseName}`} onClick={() => edit(t)}><Pencil className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" aria-label={`Delete the template for ${t.courseName}`} onClick={() => setDeleting(t)}><Trash2 className="h-4 w-4" /></Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex items-center justify-between gap-2 border-t pt-4">
          <h3 className="text-sm font-semibold">{editingId ? `Editing ${templates.find((t) => t.id === editingId)?.courseName ?? "template"}` : templates.length ? "Add a template for another course or regulation" : "Add a template"}</h3>
          {editingId && <Button size="sm" variant="ghost" onClick={reset}>Cancel</Button>}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="mpt-course">Course</Label>
            <select id="mpt-course" className={selectClass} value={courseKey} onChange={(e) => { setCourseKey(e.target.value); setRegulation(""); }}>
              <option value="">Select a course</option>
              {groups.map((g) => <option key={g.key} value={g.key}>{g.name}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mpt-reg">Regulation</Label>
            <select id="mpt-reg" className={selectClass} value={regulation} onChange={(e) => setRegulation(e.target.value)} disabled={!courseKey}>
              <option value="">All regulations</option>
              {regulationOptions.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Levels of the 6 questions</legend>
          <p className="text-xs text-muted-foreground">One row for each level Question 1 may start at.</p>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full min-w-[34rem] text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr><th className="p-2 text-left">Question 1 at</th>{Array.from({ length: PAPER_QUESTIONS }, (_, i) => <th key={i} className="p-2">Q{i + 1}{i % 2 === 1 ? " (OR)" : ""}</th>)}</tr>
              </thead>
              <tbody>
                {BLOOM_LEVELS.map((start) => (
                  <tr key={start} className="border-t">
                    <th scope="row" className="p-2 text-left font-semibold">{start}</th>
                    {Array.from({ length: PAPER_QUESTIONS }, (_, i) => (
                      <td key={i} className="p-1.5">
                        {i === 0 ? <p className="text-center font-medium">{start}</p> : (
                          <select aria-label={`Starting at ${start}: level of Question ${i + 1}`} className={selectClass} value={sequences[start][i] ?? ""}
                            onChange={(e) => setSequences((s) => ({ ...s, [start]: s[start].map((x, j) => (j === i ? (e.target.value as BloomLevel) : j === 0 ? start : x)) }))}>
                            {BLOOM_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
                          </select>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Unit of each question</legend>
          <p className="text-xs text-muted-foreground">By the Mid&rsquo;s own units: &ldquo;I&rdquo; is the Mid&rsquo;s first unit (Unit 3 for a Mid covering 3 and 4). Every unit must have the same number of questions.</p>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full min-w-[34rem] text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr><th className="p-2 text-left">Mid covers</th>{Array.from({ length: PAPER_QUESTIONS }, (_, i) => <th key={i} className="p-2">Q{i + 1}</th>)}<th className="p-2">Per unit</th></tr>
              </thead>
              <tbody>
                {UNIT_COUNTS.map((n) => {
                  const counts = unitCounts(n);
                  const equal = counts.every((c) => c === counts[0]);
                  return (
                    <tr key={n} className="border-t">
                      <th scope="row" className="p-2 text-left font-semibold">{n} unit{n === 1 ? "" : "s"}</th>
                      {Array.from({ length: PAPER_QUESTIONS }, (_, i) => (
                        <td key={i} className="p-1.5">
                          <select aria-label={`${n}-unit Mid: unit of Question ${i + 1}`} className={selectClass} value={(units[String(n)] ?? defaultUnits(n))[i]} disabled={n === 1}
                            onChange={(e) => setUnits((u) => ({ ...u, [String(n)]: (u[String(n)] ?? defaultUnits(n)).map((x, j) => (j === i ? Number(e.target.value) : x)) }))}>
                            {Array.from({ length: n }, (_, k) => k + 1).map((k) => <option key={k} value={k}>{ROMAN[k]}</option>)}
                          </select>
                        </td>
                      ))}
                      <td className={`p-2 text-center text-xs ${equal ? "text-muted-foreground" : "font-semibold text-destructive"}`}>{counts.join(" / ")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-[1fr_12rem_12rem]">
          <div className="space-y-1.5">
            <Label htmlFor="mpt-instr">Instruction printed on the paper</Label>
            <Input id="mpt-instr" value={instruction} maxLength={300} onChange={(e) => setInstruction(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mpt-max">Max. marks (optional)</Label>
            <Input id="mpt-max" type="number" min={1} max={500} value={maxMarks} placeholder="3 x question marks" onChange={(e) => setMaxMarks(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mpt-regd">Regd. No boxes</Label>
            <Input id="mpt-regd" type="number" min={REGD_BOXES_MIN} max={REGD_BOXES_MAX} value={regdBoxes} onChange={(e) => setRegdBoxes(e.target.value)} />
            <p className="text-xs text-muted-foreground">One box per character of the Regd. No ({REGD_BOXES_MIN}-{REGD_BOXES_MAX}).</p>
          </div>
        </div>

        <div className="flex justify-end">
          <Button onClick={() => void save()} loading={saving} disabled={!courseKey}>{editingId ? "Save changes" : "Save template"}</Button>
        </div>
      </CardContent>
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this question paper template?"
        description="Papers can't be generated for this course (and regulation) until a template exists again."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => void remove()}
      />
    </Card>
  );
}
