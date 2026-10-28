"use client";

import { useEffect, useMemo, useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { toast } from "@/hooks/useToast";
import { buildCourseGroups } from "@/lib/departments/hodScope";
import { Checkbox } from "@/components/ui/checkbox";
import { allowedFormats, formatName, partsFor, QUESTION_FORMATS } from "@/lib/midBank/validateQuestion";
import type { Course, MidBankRules, MidQuestionFormat } from "@/types";

// Exam Cell > Settings: the Mid Question Bank rules per course (+ regulation):
// which units each Mid covers, the question format and the marks. A bank takes
// a copy of these when its faculty starts it, so later edits only affect banks
// not yet started.

const selectClass = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm";

const parseUnits = (s: string) => [...new Set(s.split(/[\s,]+/).map(Number).filter((n) => Number.isInteger(n) && n > 0))];

export function MidBankRulesCard({ midCount }: { midCount: number }) {
  const [rules, setRules] = useState<MidBankRules[]>([]);
  const [regulationsByCourse, setRegulationsByCourse] = useState<Record<string, string[]>>({});
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseKey, setCourseKey] = useState("");
  const [regulation, setRegulation] = useState("");
  const [midUnits, setMidUnits] = useState<Record<string, string>>({});
  const [formats, setFormats] = useState<MidQuestionFormat[]>(["SINGLE", "PARTS_AB"]);
  const [marks, setMarks] = useState("10");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<MidBankRules | null>(null);

  const groups = useMemo(() => buildCourseGroups(courses), [courses]);
  // The course's regulations from Academics (Course Catalog); a saved rule's own regulation stays listed.
  const regulationOptions = useMemo(() => {
    const regs = regulationsByCourse[courseKey] ?? [];
    return regulation && !regs.includes(regulation) ? [...regs, regulation] : regs;
  }, [regulationsByCourse, courseKey, regulation]);
  const mids = Array.from({ length: Math.max(1, Math.min(midCount || 2, 9)) }, (_, i) => String(i + 1));

  function load() {
    fetch("/api/college/mid-bank-rules")
      .then((r) => r.json() as Promise<{ rules?: MidBankRules[]; regulationsByCourse?: Record<string, string[]> }>)
      .then((d) => { setRules(d.rules ?? []); setRegulationsByCourse(d.regulationsByCourse ?? {}); })
      .catch(() => toast({ variant: "destructive", title: "Failed to load the question bank rules" }));
  }
  useEffect(() => {
    load();
    fetch("/api/college/courses")
      .then((r) => r.json() as Promise<{ courses?: Course[] }>)
      .then((d) => setCourses(d.courses ?? []))
      .catch(() => undefined);
  }, []);

  // The rule being edited (null = adding a new one) - only to label the form.
  const [editingId, setEditingId] = useState<string | null>(null);
  function reset() {
    setEditingId(null);
    setCourseKey("");
    setRegulation("");
    setMidUnits({});
    setFormats(["SINGLE", "PARTS_AB"]);
    setMarks("10");
  }

  function edit(r: MidBankRules) {
    setEditingId(r.id);
    setCourseKey(r.courseKey);
    setRegulation(r.regulation === "ALL" ? "" : r.regulation);
    setMidUnits(Object.fromEntries(Object.entries(r.mids).map(([m, u]) => [m, u.join(", ")])));
    setFormats(allowedFormats(r));
    setMarks(String(r.marks));
  }

  async function save() {
    const group = groups.find((g) => g.key === courseKey);
    if (!group) { toast({ variant: "destructive", title: "Pick a course" }); return; }
    const payload = {
      courseKey, courseName: group.name, regulation: regulation.trim() || "ALL", formats, marks: Number(marks),
      mids: Object.fromEntries(mids.map((m) => [m, parseUnits(midUnits[m] ?? "")]).filter(([, u]) => (u as number[]).length > 0)),
    };
    setSaving(true);
    try {
      const res = await fetch("/api/college/mid-bank-rules", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to save");
      toast({ variant: "success", title: `Rules saved for ${group.name}${payload.regulation === "ALL" ? "" : ` (${payload.regulation})`}` });
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
    const res = await fetch(`/api/college/mid-bank-rules?id=${encodeURIComponent(deleting.id)}`, { method: "DELETE" });
    if (!res.ok) toast({ variant: "destructive", title: "Failed to delete" });
    setDeleting(null);
    load();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Mid Question Bank rules</CardTitle>
        <CardDescription>
          For each course, which units each Mid covers and how questions are set. Faculty write 10 questions per unit,
          with Bloom&rsquo;s levels L2, L3 and L4 each used at least 3 times. A bank keeps the rules it started with.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {rules.length > 0 && (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr><th className="p-2">Course</th><th className="p-2">Regulation</th><th className="p-2">Units per Mid</th><th className="p-2">Question types</th><th className="p-2 text-right">Marks</th><th className="p-2" /></tr>
              </thead>
              <tbody>
                {rules.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="p-2 font-medium">{r.courseName}</td>
                    <td className="p-2">{r.regulation === "ALL" ? <span className="text-muted-foreground">All</span> : r.regulation}</td>
                    <td className="p-2">
                      <div className="flex flex-wrap gap-1">
                        {Object.entries(r.mids).sort(([a], [b]) => Number(a) - Number(b)).map(([m, u]) => <Badge key={m} variant="outline">Mid {m}: {u.join(", ")}</Badge>)}
                      </div>
                    </td>
                    <td className="p-2">
                      <div className="flex flex-wrap gap-1">{allowedFormats(r).map((f) => <Badge key={f} variant="secondary">{formatName(f)}</Badge>)}</div>
                    </td>
                    <td className="p-2 text-right">{r.marks}</td>
                    <td className="p-2 whitespace-nowrap text-right">
                      <Button size="icon" variant="ghost" aria-label={`Edit rules for ${r.courseName}`} onClick={() => edit(r)}><Pencil className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" aria-label={`Delete rules for ${r.courseName}`} onClick={() => setDeleting(r)}><Trash2 className="h-4 w-4" /></Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex items-center justify-between gap-2 border-t pt-4">
          <h3 className="text-sm font-semibold">
            {editingId
              ? `Editing ${rules.find((r) => r.id === editingId)?.courseName ?? "rule"}${(() => { const reg = rules.find((r) => r.id === editingId)?.regulation; return reg && reg !== "ALL" ? ` (${reg})` : " (all regulations)"; })()}`
              : rules.length > 0 ? "Add a rule for another course or regulation" : "Add a rule"}
          </h3>
          {editingId && <Button size="sm" variant="ghost" onClick={reset}>Cancel</Button>}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="mbr-course">Course</Label>
            <select id="mbr-course" className={selectClass} value={courseKey} onChange={(e) => { setCourseKey(e.target.value); setRegulation(""); }}>
              <option value="">Select a course</option>
              {groups.map((g) => <option key={g.key} value={g.key}>{g.name}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mbr-reg">Regulation</Label>
            <select id="mbr-reg" className={selectClass} value={regulation} onChange={(e) => setRegulation(e.target.value)} disabled={!courseKey}>
              <option value="">All regulations</option>
              {regulationOptions.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
            {courseKey && regulationOptions.length === 0 && (
              <p className="text-xs text-muted-foreground">No regulations set for this course in Academics &gt; Regulation - the rule applies to all.</p>
            )}
          </div>
          {mids.map((m) => (
            <div key={m} className="space-y-1.5">
              <Label htmlFor={`mbr-mid-${m}`}>Mid {m} units</Label>
              <Input id={`mbr-mid-${m}`} value={midUnits[m] ?? ""} placeholder={m === "1" ? "e.g. 1, 2, 3" : "e.g. 3, 4, 5"} onChange={(e) => setMidUnits((s) => ({ ...s, [m]: e.target.value }))} />
            </div>
          ))}
          <div className="space-y-1.5">
            <Label htmlFor="mbr-marks">Marks per question</Label>
            <Input id="mbr-marks" type="number" min={1} max={100} value={marks} onChange={(e) => setMarks(e.target.value)} />
            {formats.some((f) => f !== "SINGLE") && Number(marks) > 0 && <p className="text-xs text-muted-foreground">With parts, the faculty splits the {Number(marks)} marks between the parts.</p>}
          </div>
          <fieldset className="space-y-2 sm:col-span-2">
            <legend className="text-sm font-medium">Question types the faculty may use</legend>
            <p className="text-xs text-muted-foreground">Tick every type allowed. Faculty pick one of them for each question; with one ticked, every question uses it.</p>
            <div className="flex flex-wrap gap-2">
              {QUESTION_FORMATS.map((f) => {
                const on = formats.includes(f);
                const tooMany = partsFor(f) > Number(marks || 0);
                return (
                  <label key={f} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${on ? "border-primary bg-primary/5" : "hover:bg-muted/50"} ${tooMany ? "opacity-50" : ""}`}>
                    <Checkbox checked={on} disabled={tooMany && !on}
                      onCheckedChange={(v) => setFormats((cur) => (v === true ? QUESTION_FORMATS.filter((x) => x === f || cur.includes(x)) : cur.filter((x) => x !== f)))} />
                    {formatName(f)}
                  </label>
                );
              })}
            </div>
            {formats.length === 0 && <p className="text-xs text-destructive">Tick at least one question type.</p>}
          </fieldset>
        </div>
        <div className="flex justify-end">
          <Button onClick={() => void save()} loading={saving} disabled={!courseKey || formats.length === 0}>{editingId ? "Save changes" : "Save rules"}</Button>
        </div>
      </CardContent>
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete these rules?"
        description="Banks already started keep their copy. Banks not yet started for this course can't start until rules exist again."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => void remove()}
      />
    </Card>
  );
}
