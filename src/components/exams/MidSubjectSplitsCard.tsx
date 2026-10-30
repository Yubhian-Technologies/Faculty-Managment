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
import type { Course, MidBankSubjectSplit, Subject } from "@/types";

// Exam Cell > Mid Configuration: a subject whose syllabus doesn't follow the
// course's split gets its own Mid units here - used instead of the rule,
// whatever its number of units. Banks already started keep their units.

const selectClass = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm";
const parseUnits = (s: string) => [...new Set(s.split(/[\s,]+/).map(Number).filter((n) => Number.isInteger(n) && n > 0))];

export function MidSubjectSplitsCard({ midCount }: { midCount: number }) {
  const [splits, setSplits] = useState<MidBankSubjectSplit[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseKey, setCourseKey] = useState("");
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [subjectId, setSubjectId] = useState("");
  const [units, setUnits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<MidBankSubjectSplit | null>(null);
  const mids = Array.from({ length: Math.max(1, Math.min(midCount || 2, 9)) }, (_, i) => String(i + 1));
  const groups = useMemo(() => buildCourseGroups(courses), [courses]);

  function load() {
    fetch("/api/college/mid-bank-subject-splits").then((r) => r.json() as Promise<{ splits?: MidBankSubjectSplit[] }>).then((d) => setSplits(d.splits ?? []))
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
      .then((d) => { if (!cancelled) setSubjects((d.subjects ?? []).filter((s) => !s.type || s.type === "THEORY").sort((a, b) => a.code.localeCompare(b.code))); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [courseKey]);

  function edit(x: MidBankSubjectSplit) {
    setCourseKey(x.courseKey);
    setSubjectId(x.subjectId);
    setUnits(Object.fromEntries(Object.entries(x.mids).map(([m, u]) => [m, u.join(", ")])));
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/college/mid-bank-subject-splits", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subjectId, mids: Object.fromEntries(mids.map((m) => [m, parseUnits(units[m] ?? "")])) }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to save");
      toast({ variant: "success", title: "Subject exception saved" });
      setSubjectId(""); setUnits({});
      load();
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Failed to save" });
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!deleting) return;
    const res = await fetch(`/api/college/mid-bank-subject-splits?subjectId=${encodeURIComponent(deleting.subjectId)}`, { method: "DELETE" });
    if (!res.ok) toast({ variant: "destructive", title: "Failed to delete" });
    setDeleting(null);
    load();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Subject exceptions - Mid units</CardTitle>
        <CardDescription>For a subject whose syllabus doesn&rsquo;t follow the course&rsquo;s split: its own units for each Mid, used instead of the rule. Question banks already started keep their units.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {splits.length > 0 && (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground"><tr><th className="p-2">Subject</th><th className="p-2">Mid units</th><th className="p-2" /></tr></thead>
              <tbody>
                {splits.map((x) => (
                  <tr key={x.subjectId} className="border-t">
                    <td className="p-2"><p className="font-medium">{x.subjectName}</p><p className="text-xs text-muted-foreground">{x.subjectCode}{x.regulation ? ` · ${x.regulation}` : ""}</p></td>
                    <td className="p-2"><div className="flex flex-wrap gap-1">{Object.entries(x.mids).sort(([a], [b]) => Number(a) - Number(b)).map(([m, u]) => <Badge key={m} variant="outline">Mid {m}: {u.join(", ")}</Badge>)}</div></td>
                    <td className="whitespace-nowrap p-2 text-right">
                      <Button size="icon" variant="ghost" aria-label={`Edit ${x.subjectName}`} onClick={() => edit(x)}><Pencil className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" aria-label={`Delete ${x.subjectName}`} onClick={() => setDeleting(x)}><Trash2 className="h-4 w-4" /></Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="mss-course">Course</Label>
            <select id="mss-course" className={selectClass} value={courseKey} onChange={(e) => { setCourseKey(e.target.value); setSubjectId(""); setSubjects([]); }}>
              <option value="">Select a course</option>
              {groups.filter((g) => !g.key.startsWith("name:")).map((g) => <option key={g.key} value={g.key}>{g.name}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="mss-subject">Subject</Label>
            <select id="mss-subject" className={selectClass} value={subjectId} disabled={!courseKey} onChange={(e) => {
              setSubjectId(e.target.value);
              const had = splits.find((x) => x.subjectId === e.target.value);
              setUnits(had ? Object.fromEntries(Object.entries(had.mids).map(([m, u]) => [m, u.join(", ")])) : {});
            }}>
              <option value="">{courseKey && subjects.length === 0 ? "No theory subjects" : "Select a subject"}</option>
              {subjects.map((s) => <option key={s.id} value={s.id}>{s.code} · {s.name}{s.regulation ? ` (${s.regulation})` : ""}</option>)}
            </select>
          </div>
          {mids.map((m) => (
            <div key={m} className="space-y-1.5">
              <Label htmlFor={`mss-mid-${m}`}>Mid {m} units</Label>
              <Input id={`mss-mid-${m}`} value={units[m] ?? ""} placeholder={m === "1" ? "e.g. 1, 2" : "e.g. 3, 4, 5, 6"} onChange={(e) => setUnits((s) => ({ ...s, [m]: e.target.value }))} />
            </div>
          ))}
        </div>
        <div className="flex justify-end">
          <Button onClick={() => void save()} loading={saving} disabled={!subjectId}>Save exception</Button>
        </div>
      </CardContent>
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Remove this subject's exception?"
        description="The subject goes back to the course's split. Question banks already started keep their units."
        confirmLabel="Remove"
        variant="destructive"
        onConfirm={() => void remove()}
      />
    </Card>
  );
}
