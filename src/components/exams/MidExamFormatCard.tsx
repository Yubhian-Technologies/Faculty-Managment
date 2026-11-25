"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/useToast";
import { buildCourseGroups } from "@/lib/departments/hodScope";
import { answeredCount } from "@/lib/midMarks/format";
import type { Course } from "@/types";
import type { MidExamFormat, MidFormatChoice, MidFormatKind } from "@/types/midMarks";

// Exam Cell > Mid Configuration > Marks > Mid Exam Format (lib/midMarks/format.ts): what a Mid exam is made of, per
// course + regulation - e.g. Descriptive (6 questions x 10, OR pairs) 30 + Quiz (20 x 1) 10 + Course Activity 10 = 50 -
// and subjects with their own (Engineering Drawing: Descriptive 30 + Day to Day Work 20). Subjects with a format
// are entered (or uploaded) in it on Mid Marks; the others keep the printed-paper flow.

interface Draft { name: string; kind: MidFormatKind; questions: string; marksEach: string; choice: "ALL" | "ANY" | "OR_PAIRS"; answer: string; items: string; itemMarks: string; max: string }
interface SubjectDraft { subjectCode: string; components: Draft[] }

const KIND_LABEL: Record<MidFormatKind, string> = { QUESTIONS: "Written questions", ITEMS: "Items added up (quiz)", MARK: "One mark" };
const STARTER: Draft[] = [
  { name: "Descriptive", kind: "QUESTIONS", questions: "6", marksEach: "10", choice: "OR_PAIRS", answer: "", items: "", itemMarks: "", max: "" },
  { name: "Quiz", kind: "ITEMS", questions: "", marksEach: "", choice: "ALL", answer: "", items: "20", itemMarks: "1", max: "10" },
  { name: "Course Activity", kind: "MARK", questions: "", marksEach: "", choice: "ALL", answer: "", items: "", itemMarks: "", max: "10" },
];
const blank = (): Draft => ({ name: "", kind: "MARK", questions: "", marksEach: "", choice: "ALL", answer: "", items: "", itemMarks: "", max: "" });
const selectClass = "h-9 w-full rounded-md border bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30";

const toDraft = (c: MidExamFormat["components"][number]): Draft => ({
  name: c.name, kind: c.kind, questions: String(c.questions ?? ""), marksEach: String(c.marksEach ?? ""), choice: c.choice?.kind ?? "ALL",
  answer: c.choice?.kind === "ANY" ? String(c.choice.answer) : "", items: String(c.items ?? ""), itemMarks: String(c.itemMarks ?? ""), max: String(c.max ?? ""),
});
const toBody = (d: Draft) => {
  const choice: MidFormatChoice = d.choice === "ANY" ? { kind: "ANY", answer: Number(d.answer) } : { kind: d.choice };
  return d.kind === "QUESTIONS" ? { name: d.name, kind: d.kind, questions: Number(d.questions), marksEach: Number(d.marksEach), choice }
    : d.kind === "ITEMS" ? { name: d.name, kind: d.kind, items: Number(d.items), itemMarks: Number(d.itemMarks), max: Number(d.max) }
    : { name: d.name, kind: d.kind, max: Number(d.max) };
};
const maxOf = (d: Draft) => {
  if (d.kind !== "QUESTIONS") return Number(d.max) || 0;
  const n = Number(d.questions) || 0;
  const choice: MidFormatChoice = d.choice === "ANY" ? { kind: "ANY", answer: Number(d.answer) || 0 } : { kind: d.choice };
  return answeredCount(n, choice) * (Number(d.marksEach) || 0);
};
const line = (list: Draft[]) => `${list.map((d) => `${d.name || "?"} ${maxOf(d)}`).join(" + ")} = ${list.reduce((n, d) => n + maxOf(d), 0)}`;

function ComponentsEditor({ value, onChange }: { value: Draft[]; onChange: (v: Draft[]) => void }) {
  const set = (i: number, patch: Partial<Draft>) => onChange(value.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  const move = (i: number, by: number) => { const n = [...value]; const [x] = n.splice(i, 1); n.splice(i + by, 0, x); onChange(n); };
  return (
    <div className="space-y-2">
      {value.map((d, i) => (
        <div key={i} className="grid gap-2 rounded-lg border p-3 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1.3fr)_minmax(0,3fr)_auto]">
          <div className="space-y-1"><Label className="text-xs">Name</Label><Input value={d.name} maxLength={40} onChange={(e) => set(i, { name: e.target.value })} placeholder="Descriptive" /></div>
          <div className="space-y-1">
            <Label className="text-xs">Marked As</Label>
            <select className={selectClass} value={d.kind} onChange={(e) => set(i, { kind: e.target.value as MidFormatKind })}>
              {(Object.keys(KIND_LABEL) as MidFormatKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
            </select>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            {d.kind === "QUESTIONS" && <>
              <div className="w-24 space-y-1"><Label className="text-xs">Questions</Label><Input type="number" min={1} value={d.questions} onChange={(e) => set(i, { questions: e.target.value })} /></div>
              <div className="w-24 space-y-1"><Label className="text-xs">Marks Each</Label><Input type="number" min={0.5} step={0.5} value={d.marksEach} onChange={(e) => set(i, { marksEach: e.target.value })} /></div>
              <div className="w-36 space-y-1">
                <Label className="text-xs">Choice</Label>
                <select className={selectClass} value={d.choice} onChange={(e) => set(i, { choice: e.target.value as Draft["choice"] })}>
                  <option value="OR_PAIRS">OR pairs (1 or 2 ...)</option><option value="ANY">Answer any</option><option value="ALL">Answer all</option>
                </select>
              </div>
              {d.choice === "ANY" && <div className="w-20 space-y-1"><Label className="text-xs">Any</Label><Input type="number" min={1} value={d.answer} onChange={(e) => set(i, { answer: e.target.value })} /></div>}
            </>}
            {d.kind === "ITEMS" && <>
              <div className="w-24 space-y-1"><Label className="text-xs">Items</Label><Input type="number" min={1} value={d.items} onChange={(e) => set(i, { items: e.target.value })} /></div>
              <div className="w-24 space-y-1"><Label className="text-xs">Marks Each</Label><Input type="number" min={0.5} step={0.5} value={d.itemMarks} onChange={(e) => set(i, { itemMarks: e.target.value })} /></div>
              <div className="w-24 space-y-1"><Label className="text-xs">Counts For</Label><Input type="number" min={0.5} step={0.5} value={d.max} onChange={(e) => set(i, { max: e.target.value })} /></div>
            </>}
            {d.kind === "MARK" && <div className="w-24 space-y-1"><Label className="text-xs">Max Marks</Label><Input type="number" min={0.5} step={0.5} value={d.max} onChange={(e) => set(i, { max: e.target.value })} /></div>}
            <span className="pb-2 text-sm text-muted-foreground">= {maxOf(d)}</span>
          </div>
          <div className="flex items-end gap-1">
            <Button variant="ghost" size="icon" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="h-4 w-4" /></Button>
            <Button variant="ghost" size="icon" aria-label="Move down" disabled={i === value.length - 1} onClick={() => move(i, 1)}><ArrowDown className="h-4 w-4" /></Button>
            <Button variant="ghost" size="icon" aria-label={`Remove ${d.name || "component"}`} disabled={value.length === 1} onClick={() => onChange(value.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
          </div>
        </div>
      ))}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="outline" size="sm" onClick={() => onChange([...value, blank()])}><Plus className="mr-1 h-4 w-4" />Add Component</Button>
        <span className="text-sm font-medium">{line(value)}</span>
      </div>
    </div>
  );
}

export function MidExamFormatCard() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [formats, setFormats] = useState<MidExamFormat[]>([]);
  const [regs, setRegs] = useState<Record<string, string[]>>({});
  const [courseKey, setCourseKey] = useState("");
  const [regulation, setRegulation] = useState("ALL");
  const [components, setComponents] = useState<Draft[]>(STARTER);
  const [subjects, setSubjects] = useState<SubjectDraft[]>([]);
  const [saving, setSaving] = useState(false);
  const groups = useMemo(() => buildCourseGroups(courses), [courses]);
  const selected = courseKey || groups[0]?.key || "";
  const current = formats.find((f) => f.courseKey === selected && f.regulation === regulation) ?? null;

  const reload = () => fetch("/api/college/mid-exam-formats").then((r) => r.json() as Promise<{ formats?: MidExamFormat[]; regulationsByCourse?: Record<string, string[]> }>)
    .then((d) => { setFormats(d.formats ?? []); setRegs(d.regulationsByCourse ?? {}); }).catch(() => undefined);
  useEffect(() => {
    fetch("/api/college/courses").then((r) => r.json() as Promise<{ courses?: Course[] }>).then((d) => setCourses(d.courses ?? [])).catch(() => undefined);
    void reload();
  }, []);

  // Show the saved format of the course + regulation picked (or a starting point).
  const pickedKey = `${selected}|${regulation}|${current?.updatedAt ?? ""}`;
  const [shownKey, setShownKey] = useState("");
  if (shownKey !== pickedKey) {
    setShownKey(pickedKey);
    setComponents(current ? current.components.map(toDraft) : STARTER);
    setSubjects(current ? Object.values(current.subjectFormats ?? {}).map((s) => ({ subjectCode: s.subjectCode, components: s.components.map(toDraft) })) : []);
  }

  async function save() {
    const group = groups.find((g) => g.key === selected);
    if (!group) return;
    setSaving(true);
    try {
      const res = await fetch("/api/college/mid-exam-formats", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courseKey: selected, courseName: group.name, regulation, components: components.map(toBody), subjectFormats: subjects.map((s) => ({ subjectCode: s.subjectCode, components: s.components.map(toBody) })) }),
      });
      const d = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(d.error ?? "Unable to save the Mid exam format.");
      toast({ variant: "success", title: "Mid exam format saved." });
      await reload();
    } catch (e) {
      toast({ variant: "destructive", title: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!current) return;
    const res = await fetch(`/api/college/mid-exam-formats?id=${encodeURIComponent(current.id)}`, { method: "DELETE" });
    const d = (await res.json()) as { error?: string };
    if (!res.ok) { toast({ variant: "destructive", title: d.error ?? "Unable to delete the Mid exam format." }); return; }
    toast({ title: "Mid exam format deleted." });
    await reload();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Mid Exam Format</CardTitle>
        <CardDescription>
          What a Mid exam is made of: written questions (entered question by question, each with a CO), items added up such as a quiz, and single marks such as an activity.
          Subjects of a course with a format are entered or uploaded in it on Mid Marks; the others follow the printed paper.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {formats.length > 0 && (
          <div className="flex flex-wrap gap-2 text-xs">
            {formats.map((f) => (
              <button key={f.id} type="button" onClick={() => { setCourseKey(f.courseKey); setRegulation(f.regulation); }}
                className="rounded-full border px-3 py-1 hover:border-primary">
                {f.courseName} · {f.regulation === "ALL" ? "All regulations" : f.regulation}{Object.keys(f.subjectFormats ?? {}).length ? ` · ${Object.keys(f.subjectFormats ?? {}).length} own` : ""}
              </button>
            ))}
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="mef-course">Course</Label>
            <select id="mef-course" className={selectClass} value={selected} onChange={(e) => { setCourseKey(e.target.value); setRegulation("ALL"); }}>
              {groups.map((g) => <option key={g.key} value={g.key}>{g.name}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mef-reg">Regulation</Label>
            <select id="mef-reg" className={selectClass} value={regulation} onChange={(e) => setRegulation(e.target.value)}>
              <option value="ALL">All regulations</option>
              {[...new Set([...(regs[selected] ?? []), ...(regulation !== "ALL" ? [regulation] : [])])].map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">{current ? `Saved by ${current.updatedByName}.` : "Not set for this course and regulation - a starting point is shown."}</p>

        <ComponentsEditor value={components} onChange={setComponents} />

        <div className="space-y-2 border-t pt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-medium">Subjects With Their Own Format</p>
              <p className="text-xs text-muted-foreground">For example Engineering Drawing: Descriptive 30 + Day to Day Work 20.</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => setSubjects((p) => [...p, { subjectCode: "", components: [STARTER[0], { ...blank(), name: "Day to Day Work", max: "20" }] }])}><Plus className="mr-1 h-4 w-4" />Add Subject</Button>
          </div>
          {subjects.map((s, i) => (
            <div key={i} className="space-y-2 rounded-lg border bg-muted/20 p-3">
              <div className="flex items-end gap-2">
                <div className="w-48 space-y-1"><Label className="text-xs">Subject Code</Label><Input value={s.subjectCode} onChange={(e) => setSubjects((p) => p.map((x, j) => (j === i ? { ...x, subjectCode: e.target.value.toUpperCase() } : x)))} placeholder="UG26ME1T02" /></div>
                <Button variant="ghost" size="icon" aria-label="Remove subject" onClick={() => setSubjects((p) => p.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
              </div>
              <ComponentsEditor value={s.components} onChange={(v) => setSubjects((p) => p.map((x, j) => (j === i ? { ...x, components: v } : x)))} />
            </div>
          ))}
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          {current && <Button variant="outline" onClick={() => void remove()}>Delete Format</Button>}
          <Button loading={saving} onClick={() => void save()}>Save Format</Button>
        </div>
      </CardContent>
    </Card>
  );
}
