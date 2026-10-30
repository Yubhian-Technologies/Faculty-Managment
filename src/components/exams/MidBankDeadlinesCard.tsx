"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BarChart3, History, Lock, Pencil, Trash2 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import { buildCourseGroups } from "@/lib/departments/hodScope";
import { deadlineLabel } from "@/lib/midBank/deadline";
import { ordinalYearLabel } from "@/lib/college/courseYears";
import { istDateKey } from "@/lib/attendance/istTime";
import type { Course, CourseYearTiming, MidBankDeadline } from "@/types";

// Exam Cell > Mid Timings & Dates: the question bank deadline, set BEFORE the
// Mid's timings. Publishing one opens the Question Bank module for every faculty
// member teaching a subject of that course / year / semester and notifies them;
// banks lock when the deadline day ends. Moving the date reopens locked banks.

const selectClass = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm";
type Row = MidBankDeadline & { locked: boolean };

export function MidBankDeadlinesCard({ midCount }: { midCount: number }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseKey, setCourseKey] = useState("");
  const [year, setYear] = useState("");
  const [semester, setSemester] = useState("");
  const [mid, setMid] = useState("1");
  const [deadline, setDeadline] = useState("");
  const [timings, setTimings] = useState<CourseYearTiming[]>([]);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<{ row: Row; date: string } | null>(null);
  const [savingDate, setSavingDate] = useState(false);
  const [deleting, setDeleting] = useState<Row | null>(null);

  const groups = useMemo(() => buildCourseGroups(courses), [courses]);
  const group = groups.find((g) => g.key === courseKey) ?? null;
  const years = group ? Array.from({ length: group.durationYears ?? 0 }, (_, i) => i + 1) : [];
  const semesters = useMemo(() => [...new Set(timings.flatMap((t) => (t.semesters ?? []).map((s) => s.semester)))].sort((a, b) => a - b), [timings]);
  const today = istDateKey();

  const load = useCallback(() => {
    fetch("/api/college/mid-bank-deadlines")
      .then((r) => r.json() as Promise<{ deadlines?: Row[] }>)
      .then((d) => setRows(d.deadlines ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load question bank deadlines" }));
  }, []);
  useEffect(() => {
    load();
    fetch("/api/college/courses").then((r) => r.json() as Promise<{ courses?: Course[] }>).then((d) => setCourses(d.courses ?? [])).catch(() => undefined);
  }, [load]);

  // The year's semesters, from the course-year timings of any Course doc of the programme.
  useEffect(() => {
    if (!group || !year) return;
    let cancelled = false;
    void Promise.all(group.courseIds.map((id) =>
      fetch(`/api/college/course-year-timings?courseId=${encodeURIComponent(id)}`)
        .then((r) => r.json() as Promise<{ timings?: CourseYearTiming[] }>)
        .then((d) => (d.timings ?? []).filter((t) => t.year === Number(year)))
        .catch(() => [] as CourseYearTiming[])
    )).then((lists) => { if (!cancelled) setTimings(lists.flat()); });
    return () => { cancelled = true; };
  }, [group, year]);

  async function publish() {
    setSaving(true);
    try {
      const res = await fetch("/api/college/mid-bank-deadlines", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courseKey, year: Number(year), semester: Number(semester), midNumber: Number(mid), deadline }),
      });
      const data = (await res.json()) as { error?: string; notified?: number };
      if (!res.ok) throw new Error(data.error ?? "Could not publish");
      toast({ variant: "success", title: "Question bank deadline published", description: `${data.notified ?? 0} faculty member(s) notified.` });
      setDeadline("");
      load();
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Could not publish" });
    } finally {
      setSaving(false);
    }
  }

  async function saveDate() {
    if (!editing) return;
    if (editing.date === editing.row.deadline) { setEditing(null); return; }
    setSavingDate(true);
    try {
      const res = await fetch(`/api/college/mid-bank-deadlines/${encodeURIComponent(editing.row.id)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deadline: editing.date }),
      });
      const data = (await res.json()) as { error?: string; notified?: number };
      if (!res.ok) { toast({ variant: "destructive", title: data.error ?? "Could not change the date" }); return; }
      toast({ variant: "success", title: "Deadline changed", description: `${data.notified ?? 0} faculty member(s) notified.` });
      setEditing(null);
      load();
    } catch {
      toast({ variant: "destructive", title: "Network error - the date was not changed" });
    } finally {
      setSavingDate(false);
    }
  }

  async function remove() {
    if (!deleting) return;
    const res = await fetch(`/api/college/mid-bank-deadlines/${encodeURIComponent(deleting.id)}`, { method: "DELETE" });
    const data = (await res.json()) as { error?: string };
    if (!res.ok) toast({ variant: "destructive", title: data.error ?? "Could not delete" });
    setDeleting(null);
    load();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Question bank deadlines</CardTitle>
        <CardDescription>
          Set before the Mid timings. Faculty teaching that semester&rsquo;s subjects are notified and prepare their question banks
          until the end of the deadline day; after that the banks lock unless you move the date.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="space-y-1.5">
            <Label htmlFor="qbd-course">Course</Label>
            <select id="qbd-course" className={selectClass} value={courseKey} onChange={(e) => { setCourseKey(e.target.value); setYear(""); setSemester(""); setTimings([]); }}>
              <option value="">Select course</option>
              {groups.map((g) => <option key={g.key} value={g.key}>{g.name}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="qbd-year">Year</Label>
            <select id="qbd-year" className={selectClass} value={year} disabled={!group} onChange={(e) => { setYear(e.target.value); setSemester(""); setTimings([]); }}>
              <option value="">Select year</option>
              {years.map((y) => <option key={y} value={y}>{ordinalYearLabel(y)}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="qbd-sem">Semester</Label>
            <select id="qbd-sem" className={selectClass} value={semester} disabled={!year || semesters.length === 0} onChange={(e) => setSemester(e.target.value)}>
              <option value="">{year && semesters.length === 0 ? "Not configured" : "Select semester"}</option>
              {semesters.map((s) => <option key={s} value={s}>Semester {s}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="qbd-mid">Mid</Label>
            <select id="qbd-mid" className={selectClass} value={mid} onChange={(e) => setMid(e.target.value)}>
              {Array.from({ length: Math.max(1, midCount || 2) }, (_, i) => i + 1).map((m) => <option key={m} value={m}>Mid {m}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="qbd-date">Deadline</Label>
            <Input id="qbd-date" type="date" min={today} value={deadline} onChange={(e) => setDeadline(e.target.value)} />
          </div>
        </div>
        <div className="flex justify-end">
          <Button onClick={() => void publish()} loading={saving} disabled={!courseKey || !year || !semester || !deadline}>Publish deadline</Button>
        </div>

        {rows.length > 0 && (
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr><th className="p-2">Course</th><th className="p-2">Year / Sem</th><th className="p-2">Mid</th><th className="p-2">Deadline</th><th className="p-2" /></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t">
                    <td className="p-2 font-medium">{r.courseName}</td>
                    <td className="p-2">{ordinalYearLabel(r.year)} · Sem {r.semester}</td>
                    <td className="p-2">Mid {r.midNumber}</td>
                    <td className="p-2">
                      <Badge variant={r.locked ? "secondary" : "outline"}>{r.locked && <Lock className="mr-1 h-3 w-3" />}{deadlineLabel(r.deadline)}</Badge>
                      {r.extensions?.length ? <span className="ml-1 text-xs text-muted-foreground">(changed {r.extensions.length}x)</span> : null}
                    </td>
                    <td className="whitespace-nowrap p-2 text-right">
                      <Button size="sm" variant="ghost" aria-label={`Edit the deadline for ${r.courseName} Mid ${r.midNumber}`} onClick={() => setEditing({ row: r, date: r.deadline })}><Pencil className="mr-1 h-4 w-4" />Edit</Button>
                      <Button asChild size="sm" variant="ghost"><Link href={`/exam-cell/question-banks/${encodeURIComponent(r.id)}`}><BarChart3 className="mr-1 h-4 w-4" />Progress</Link></Button>
                      <Button size="icon" variant="ghost" aria-label={`Delete the deadline for ${r.courseName} Mid ${r.midNumber}`} onClick={() => setDeleting(r)}><Trash2 className="h-4 w-4" /></Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
      <Dialog open={editing !== null} onOpenChange={(o) => !o && !savingDate && setEditing(null)}>
        <DialogContent className="sm:max-w-md">
          {editing && (
            <>
              <DialogHeader>
                <DialogTitle>Edit question bank deadline</DialogTitle>
                <DialogDescription>
                  {editing.row.courseName} · {ordinalYearLabel(editing.row.year)} · Semester {editing.row.semester} · Mid {editing.row.midNumber}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="qbd-edit-date">Deadline (last day to prepare)</Label>
                  <Input id="qbd-edit-date" type="date" min={today} value={editing.date} onChange={(e) => setEditing({ ...editing, date: e.target.value })} />
                  <p className="text-xs text-muted-foreground">
                    Now: {deadlineLabel(editing.row.deadline)}{editing.row.locked ? " - banks are locked; a later date reopens them" : ""}.
                    The faculty teaching these subjects are notified of the change.
                  </p>
                </div>
                {editing.row.extensions?.length ? (
                  <div className="rounded-md border bg-muted/30 p-3">
                    <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"><History className="h-3.5 w-3.5" />Earlier changes</p>
                    <ul className="space-y-1 text-xs">
                      {[...editing.row.extensions].reverse().map((x) => (
                        <li key={x.at}>{x.from} &rarr; <span className="font-medium">{x.to}</span> <span className="text-muted-foreground">· {x.byName}, {new Date(x.at).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</span></li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setEditing(null)} disabled={savingDate}>Cancel</Button>
                <Button onClick={() => void saveDate()} loading={savingDate} disabled={!editing.date || editing.date === editing.row.deadline}>Save deadline</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this deadline?"
        description="Only possible while no faculty member has started a question bank for it. The Question Bank module closes for these subjects."
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => void remove()}
      />
    </Card>
  );
}
