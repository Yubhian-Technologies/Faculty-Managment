"use client";

import { useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { toast } from "@/hooks/useToast";
import { buildCourseGroups } from "@/lib/departments/hodScope";
import { choiceText, kindLabel, marksPerQuestion, PART_KINDS, partMax, patternMax } from "@/lib/midPapers/pattern";
import type { Course, MidPaperPattern, PaperPartDef, PaperPartKind } from "@/types";

// Exam Cell > Mid Configuration > Question paper pattern (a college that prepares question papers): per course
// (+ regulation) how many question papers each faculty member submits, the duration, and the parts - their kind
// (choose the correct answer / fill in the blanks / short / descriptive), number of questions, marks each and
// which ones are answered. Max marks are worked out, never typed.

const selectClass = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm";
type Draft = Omit<PaperPartDef, "id">;
const newPart = (kind: PaperPartKind = "DESCRIPTIVE"): Draft => kind === "MCQ"
  ? { label: "", title: "Choose the correct answer", kind, questions: 10, marksEach: 1, choice: { kind: "ALL" }, options: 4 }
  : { label: "", title: kindLabel(kind), kind, questions: 6, marksEach: 5, choice: { kind: "OR_PAIRS" }, maxSubParts: 2 };

export function MidPaperPatternCard() {
  const [patterns, setPatterns] = useState<MidPaperPattern[]>([]);
  const [regulationsByCourse, setRegulationsByCourse] = useState<Record<string, string[]>>({});
  const [courses, setCourses] = useState<Course[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [courseKey, setCourseKey] = useState("");
  const [regulation, setRegulation] = useState("");
  const [sets, setSets] = useState("2");
  const [duration, setDuration] = useState("90");
  const [instruction, setInstruction] = useState("");
  const [regdBoxes, setRegdBoxes] = useState("12");
  const [parts, setParts] = useState<Draft[]>([newPart("MCQ"), newPart("DESCRIPTIVE")]);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<MidPaperPattern | null>(null);

  const groups = useMemo(() => buildCourseGroups(courses), [courses]);
  const regulationOptions = useMemo(() => {
    const regs = regulationsByCourse[courseKey] ?? [];
    return regulation && !regs.includes(regulation) ? [...regs, regulation] : regs;
  }, [regulationsByCourse, courseKey, regulation]);

  function load() {
    fetch("/api/college/mid-paper-patterns")
      .then((r) => r.json() as Promise<{ patterns?: MidPaperPattern[]; regulationsByCourse?: Record<string, string[]> }>)
      .then((d) => { setPatterns(d.patterns ?? []); setRegulationsByCourse(d.regulationsByCourse ?? {}); })
      .catch(() => toast({ variant: "destructive", title: "Failed to load the question paper patterns" }));
  }
  useEffect(() => {
    load();
    fetch("/api/college/courses").then((r) => r.json() as Promise<{ courses?: Course[] }>).then((d) => setCourses(d.courses ?? [])).catch(() => undefined);
  }, []);

  function reset() {
    setEditingId(null); setCourseKey(""); setRegulation(""); setSets("2"); setDuration("90"); setInstruction(""); setRegdBoxes("12");
    setParts([newPart("MCQ"), newPart("DESCRIPTIVE")]);
  }
  function edit(p: MidPaperPattern) {
    setEditingId(p.id); setCourseKey(p.courseKey); setRegulation(p.regulation === "ALL" ? "" : p.regulation);
    setSets(String(p.setsPerFaculty)); setDuration(String(p.durationMinutes)); setInstruction(p.instruction ?? ""); setRegdBoxes(String(p.regdBoxes ?? 12));
    setParts(p.parts.map((x) => ({ ...x })));
  }
  const setPart = (i: number, patch: Partial<Draft>) => setParts((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)));

  async function save() {
    const group = groups.find((g) => g.key === courseKey);
    if (!group) { toast({ variant: "destructive", title: "Pick a course" }); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/college/mid-paper-patterns", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courseKey, courseName: group.name, regulation: regulation || "ALL", setsPerFaculty: Number(sets), durationMinutes: Number(duration), instruction, regdBoxes: Number(regdBoxes), parts }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to save");
      toast({ variant: "success", title: `Paper pattern saved for ${group.name}${regulation ? ` (${regulation})` : ""}` });
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
    const res = await fetch(`/api/college/mid-paper-patterns?id=${encodeURIComponent(deleting.id)}`, { method: "DELETE" });
    if (!res.ok) toast({ variant: "destructive", title: "Failed to delete" });
    setDeleting(null);
    load();
  }

  const total = patternMax({ parts: parts as PaperPartDef[] });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Question paper pattern</CardTitle>
        <CardDescription>
          This college prepares question papers: each faculty member writes the number of papers set here, to this pattern. The HOD approves them and the Exam Cell picks the one used. A paper already started keeps the pattern it started with.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {patterns.length > 0 && (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr><th className="p-2">Course</th><th className="p-2">Regulation</th><th className="p-2">Parts</th><th className="p-2">Max marks</th><th className="p-2">Papers each</th><th className="p-2" /></tr>
              </thead>
              <tbody>
                {patterns.map((p) => (
                  <tr key={p.id} className="border-t">
                    <td className="p-2 font-medium">{p.courseName}</td>
                    <td className="p-2">{p.regulation === "ALL" ? <span className="text-muted-foreground">All</span> : p.regulation}</td>
                    <td className="p-2 text-xs">{p.parts.map((x) => `${x.label}: ${x.questions} x ${x.marksEach}`).join(" · ")}</td>
                    <td className="p-2">{patternMax(p)}</td>
                    <td className="p-2">{p.setsPerFaculty}</td>
                    <td className="whitespace-nowrap p-2 text-right">
                      <Button size="icon" variant="ghost" aria-label={`Edit the pattern for ${p.courseName}`} onClick={() => edit(p)}><Pencil className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" aria-label={`Delete the pattern for ${p.courseName}`} onClick={() => setDeleting(p)}><Trash2 className="h-4 w-4" /></Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex items-center justify-between gap-2 border-t pt-4">
          <h3 className="text-sm font-semibold">{editingId ? `Editing ${patterns.find((p) => p.id === editingId)?.courseName ?? "pattern"}` : patterns.length ? "Add a pattern for another course or regulation" : "Add a pattern"}</h3>
          {editingId && <Button size="sm" variant="ghost" onClick={reset}>Cancel</Button>}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="mpp-course">Course</Label>
            <select id="mpp-course" className={selectClass} value={courseKey} onChange={(e) => { setCourseKey(e.target.value); setRegulation(""); }}>
              <option value="">Select a course</option>
              {groups.map((g) => <option key={g.key} value={g.key}>{g.name}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mpp-reg">Regulation</Label>
            <select id="mpp-reg" className={selectClass} value={regulation} onChange={(e) => setRegulation(e.target.value)} disabled={!courseKey}>
              <option value="">All regulations</option>
              {regulationOptions.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="space-y-1.5"><Label htmlFor="mpp-sets">Question papers each faculty submits</Label><Input id="mpp-sets" type="number" min={1} max={5} value={sets} onChange={(e) => setSets(e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="mpp-dur">Duration (minutes)</Label><Input id="mpp-dur" type="number" min={15} max={360} value={duration} onChange={(e) => setDuration(e.target.value)} /></div>
          <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="mpp-instr">Instruction on the paper (optional)</Label><Input id="mpp-instr" maxLength={300} value={instruction} placeholder="e.g. Answer all questions of Part A and any one of each pair in Part B" onChange={(e) => setInstruction(e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="mpp-regd">Regd. No boxes</Label><Input id="mpp-regd" type="number" min={6} max={20} value={regdBoxes} onChange={(e) => setRegdBoxes(e.target.value)} /></div>
        </div>

        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">Parts</legend>
          {parts.map((p, i) => (
            <div key={i} className="rounded-md border p-3 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold">{p.label || `Part ${String.fromCharCode(65 + i)}`} <span className="font-normal text-muted-foreground">· {partMax({ ...p })} marks · {choiceText(p)} · marks entered {marksPerQuestion(p.kind) ? "per question" : "as one total"}</span></p>
                <Button size="icon" variant="ghost" disabled={parts.length === 1} aria-label="Remove part" onClick={() => setParts((ps) => ps.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="space-y-1"><Label className="text-xs">Name</Label><Input value={p.label} placeholder={`Part ${String.fromCharCode(65 + i)}`} onChange={(e) => setPart(i, { label: e.target.value })} /></div>
                <div className="space-y-1"><Label className="text-xs">Kind</Label>
                  <select className={selectClass} value={p.kind} onChange={(e) => { const k = e.target.value as PaperPartKind; setPart(i, { kind: k, title: kindLabel(k), ...(k === "MCQ" ? { options: p.options ?? 4 } : {}), ...(k === "DESCRIPTIVE" ? { maxSubParts: p.maxSubParts ?? 2 } : {}) }); }}>
                    {PART_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
                  </select>
                </div>
                <div className="space-y-1"><Label className="text-xs">Heading on the paper</Label><Input value={p.title} onChange={(e) => setPart(i, { title: e.target.value })} /></div>
                <div className="space-y-1"><Label className="text-xs">Questions</Label><Input type="number" min={1} max={40} value={p.questions} onChange={(e) => setPart(i, { questions: Number(e.target.value) })} /></div>
                <div className="space-y-1"><Label className="text-xs">Marks each</Label><Input type="number" min={0.5} step={0.5} max={100} value={p.marksEach} onChange={(e) => setPart(i, { marksEach: Number(e.target.value) })} /></div>
                <div className="space-y-1"><Label className="text-xs">Student answers</Label>
                  <div className="flex gap-2">
                    <select className={selectClass} value={p.choice.kind} onChange={(e) => setPart(i, { choice: e.target.value === "ANY" ? { kind: "ANY", answer: Math.max(1, p.questions - 1) } : { kind: e.target.value as "ALL" | "OR_PAIRS" } })}>
                      <option value="ALL">All questions</option>
                      <option value="ANY">Any of them</option>
                      <option value="OR_PAIRS">One of each pair (OR)</option>
                    </select>
                    {p.choice.kind === "ANY" && <Input className="w-20" type="number" min={1} aria-label="How many to answer" value={p.choice.answer} onChange={(e) => setPart(i, { choice: { kind: "ANY", answer: Number(e.target.value) } })} />}
                  </div>
                </div>
                {p.kind === "MCQ" && <div className="space-y-1"><Label className="text-xs">Options per question</Label><Input type="number" min={2} max={6} value={p.options ?? 4} onChange={(e) => setPart(i, { options: Number(e.target.value) })} /></div>}
                {p.kind === "DESCRIPTIVE" && <div className="space-y-1"><Label className="text-xs">Up to parts (a), (b) ...</Label><Input type="number" min={1} max={5} value={p.maxSubParts ?? 1} onChange={(e) => setPart(i, { maxSubParts: Number(e.target.value) })} /></div>}
              </div>
            </div>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button size="sm" variant="outline" disabled={parts.length >= 6} onClick={() => setParts((ps) => [...ps, newPart()])}><Plus className="h-4 w-4 mr-1" /> Add part</Button>
            <p className="text-sm">Max marks: <b>{total}</b></p>
          </div>
        </fieldset>

        <div className="flex justify-end"><Button onClick={() => void save()} loading={saving}>Save pattern</Button></div>
      </CardContent>
      <ConfirmDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)} title={`Delete the pattern for ${deleting?.courseName ?? ""}?`}
        description="Papers already started keep their copy; new ones can't start until a pattern exists." confirmLabel="Delete" variant="destructive" onConfirm={remove} />
    </Card>
  );
}
