"use client";

import { useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { toast } from "@/hooks/useToast";
import { buildCourseGroups } from "@/lib/departments/hodScope";
import type { Course, ExamConfigComponent, Subject } from "@/types";

// Exam Cell > Mid Configuration > Marks: a subject whose internal marks don't
// follow its branch's breakdown (no Quiz, a 25-mark Mid ...) gets its own
// components here - used in every branch that takes it. Can't be changed once
// marks are entered for the subject (the server refuses and says who entered them).

interface Override {
  id: string; subjectId: string; subjectCode: string; subjectName: string; regulation: string; examType: string;
  internalMaxMarks: number; externalMaxMarks: number; components: ExamConfigComponent[]; updatedByName: string;
}
interface Row { id?: string; name: string; maxMarks: string }

const selectClass = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm";
const blankRows = (): Row[] => [{ name: "Mid", maxMarks: "" }, { name: "Quiz", maxMarks: "" }, { name: "Assignment", maxMarks: "" }];

export function ExamConfigOverridesCard() {
  const [overrides, setOverrides] = useState<Override[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseKey, setCourseKey] = useState("");
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [subjectId, setSubjectId] = useState("");
  const [internal, setInternal] = useState("30");
  const [external, setExternal] = useState("70");
  const [rows, setRows] = useState<Row[]>(blankRows);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<Override | null>(null);
  const groups = useMemo(() => buildCourseGroups(courses), [courses]);
  const total = rows.reduce((n, r) => n + (Number(r.maxMarks) || 0), 0);

  function load() {
    fetch("/api/college/exam-config-overrides").then((r) => r.json() as Promise<{ overrides?: Override[] }>).then((d) => setOverrides(d.overrides ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load the subject exceptions" }));
  }
  useEffect(() => {
    load();
    fetch("/api/college/courses").then((r) => r.json() as Promise<{ courses?: Course[] }>).then((d) => setCourses(d.courses ?? [])).catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!courseKey || courseKey.startsWith("name:")) return;
    let cancelled = false;
    fetch(`/api/college/subjects?catalogId=${encodeURIComponent(courseKey)}`)
      .then((r) => r.json() as Promise<{ subjects?: Subject[] }>)
      .then((d) => { if (!cancelled) setSubjects((d.subjects ?? []).sort((a, b) => a.code.localeCompare(b.code))); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [courseKey]);

  function fill(o: Override) {
    setSubjectId(o.subjectId);
    setInternal(String(o.internalMaxMarks));
    setExternal(String(o.externalMaxMarks));
    setRows([...o.components].sort((a, b) => a.order - b.order).filter((c) => c.isActive).map((c) => ({ id: c.id, name: c.name, maxMarks: String(c.maxMarks) })));
  }
  function reset() { setSubjectId(""); setInternal("30"); setExternal("70"); setRows(blankRows()); }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/college/exam-config-overrides", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subjectId, internalMaxMarks: Number(internal), externalMaxMarks: Number(external), components: rows.filter((r) => r.name.trim()).map((r, i) => ({ id: r.id, name: r.name, maxMarks: Number(r.maxMarks), order: i, isActive: true })) }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to save");
      toast({ variant: "success", title: "Subject exception saved" });
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
    const res = await fetch(`/api/college/exam-config-overrides?id=${encodeURIComponent(deleting.id)}`, { method: "DELETE" });
    const data = (await res.json()) as { error?: string };
    if (!res.ok) toast({ variant: "destructive", title: data.error ?? "Failed to delete" });
    setDeleting(null);
    load();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Subject exceptions - internal marks</CardTitle>
        <CardDescription>
          For a subject whose internal marks differ from its branch&rsquo;s breakdown (e.g. no Quiz, a 25-mark Mid): its own components, used in every branch that takes it.
          It can&rsquo;t be changed once marks are entered for the subject.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {overrides.length > 0 && (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground"><tr><th className="p-2">Subject</th><th className="p-2">Internal / External</th><th className="p-2">Components</th><th className="p-2" /></tr></thead>
              <tbody>
                {overrides.map((o) => (
                  <tr key={o.id} className="border-t align-top">
                    <td className="p-2"><p className="font-medium">{o.subjectName}</p><p className="text-xs text-muted-foreground">{o.subjectCode}{o.regulation ? ` · ${o.regulation}` : ""} · {o.examType === "LAB" ? "Lab" : "Theory"}</p></td>
                    <td className="p-2">{o.internalMaxMarks} / {o.externalMaxMarks}</td>
                    <td className="p-2"><div className="flex flex-wrap gap-1">{o.components.filter((c) => c.isActive).map((c) => <Badge key={c.id} variant="outline">{c.name} {c.maxMarks}</Badge>)}</div></td>
                    <td className="whitespace-nowrap p-2 text-right">
                      <Button size="icon" variant="ghost" aria-label={`Edit ${o.subjectName}`} onClick={() => fill(o)}><Pencil className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" aria-label={`Delete ${o.subjectName}`} onClick={() => setDeleting(o)}><Trash2 className="h-4 w-4" /></Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="eco-course">Course</Label>
            <select id="eco-course" className={selectClass} value={courseKey} onChange={(e) => { setCourseKey(e.target.value); setSubjectId(""); setSubjects([]); }}>
              <option value="">Select a course</option>
              {groups.filter((g) => !g.key.startsWith("name:")).map((g) => <option key={g.key} value={g.key}>{g.name}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="eco-subject">Subject</Label>
            <select id="eco-subject" className={selectClass} value={subjectId} disabled={!courseKey} onChange={(e) => {
              const had = overrides.find((o) => o.subjectId === e.target.value);
              if (had) fill(had); else { setSubjectId(e.target.value); }
            }}>
              <option value="">Select a subject</option>
              {subjects.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}{s.regulation ? ` (${s.regulation})` : ""}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="eco-int">Internal max marks</Label>
            <Input id="eco-int" type="number" min={1} value={internal} onChange={(e) => setInternal(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="eco-ext">External max marks</Label>
            <Input id="eco-ext" type="number" min={0} value={external} onChange={(e) => setExternal(e.target.value)} />
          </div>
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Components</legend>
          {rows.map((r, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input aria-label={`Component ${i + 1} name`} value={r.name} placeholder="e.g. Mid" className="flex-1" onChange={(e) => setRows((x) => x.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)))} />
              <Input aria-label={`Component ${i + 1} marks`} type="number" min={1} value={r.maxMarks} placeholder="Marks" className="w-28" onChange={(e) => setRows((x) => x.map((y, j) => (j === i ? { ...y, maxMarks: e.target.value } : y)))} />
              <Button size="icon" variant="ghost" aria-label={`Remove component ${i + 1}`} disabled={rows.length === 1} onClick={() => setRows((x) => x.filter((_, j) => j !== i))}><X className="h-4 w-4" /></Button>
            </div>
          ))}
          <div className="flex items-center justify-between">
            <Button size="sm" variant="outline" onClick={() => setRows((x) => [...x, { name: "", maxMarks: "" }])}><Plus className="mr-1 h-4 w-4" />Add component</Button>
            <span className={`text-xs ${total === Number(internal) ? "text-emerald-700" : "text-destructive"}`}>Total {total} of {Number(internal) || 0}</span>
          </div>
        </fieldset>

        <div className="flex justify-end gap-2">
          {subjectId && <Button variant="ghost" onClick={reset}>Cancel</Button>}
          <Button onClick={() => void save()} loading={saving} disabled={!subjectId || total !== Number(internal)}>Save exception</Button>
        </div>
      </CardContent>
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Remove this subject's exception?"
        description="The subject goes back to its branch's breakdown. Not possible once marks are entered for it."
        confirmLabel="Remove"
        variant="destructive"
        onConfirm={() => void remove()}
      />
    </Card>
  );
}
