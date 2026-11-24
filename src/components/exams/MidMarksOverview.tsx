"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import type { MidExamPlan } from "@/types";
import { MidMarksUploadDialog } from "@/components/exams/MidMarksUploadDialog";
import { MidMarksProgress } from "@/components/exams/MidMarksProgress";
import type { MidLayoutQuestion, MidMarksLayout, MidMarksMode } from "@/lib/exams/midMarksEntry";

// Exam Cell > Mid Marks (lib/exams/midMarksEntry.ts): pick a Mid timetable; every Mid-exam subject per branch, who
// enters its marks, and where its question columns come from - the finalized paper, the questions the Exam Cell set
// here, or not set yet. "Set Questions" gives a subject + branch its questions + max marks.

interface Row {
  subjectId: string; subjectName: string; subjectCode: string; branch: string;
  sections: { id: string; name: string; facultyName: string }[];
  source: "PAPER" | "LAYOUT" | "NONE"; layout: MidMarksLayout | null; paperMax?: number; questions?: number;
  /** Faculty entry of this subject opened by the Exam Cell (after its exam), and its exam day. */
  entryOpen: boolean; examDay: string | null;
  progress: { sectionId: string; section: string; facultyName: string; entered: number; total: number; status: "NOT_STARTED" | "DRAFT" | "SUBMITTED"; locked: boolean; sheetId?: string }[];
}

const ROMAN = ["", "I", "II", "III", "IV", "V", "VI"];


export function MidMarksOverview() {
  const [plans, setPlans] = useState<MidExamPlan[] | null>(null);
  const [planId, setPlanId] = useState("");
  const [data, setData] = useState<{ key: string; mode: MidMarksMode; rows: Row[] } | null>(null);
  const [toggling, setToggling] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Row | null>(null);
  const [uploading, setUploading] = useState<Row | null>(null);
  const [reload, setReload] = useState(0);
  const plan = plans?.find((p) => p.id === planId) ?? null;
  const key = plan ? `${plan.id}|${reload}` : "";

  useEffect(() => {
    fetch("/api/college/mid-timetables").then((r) => r.json() as Promise<{ plans?: MidExamPlan[] }>)
      .then((d) => setPlans(d.plans ?? [])).catch(() => setPlans([]));
  }, []);

  useEffect(() => {
    if (!plan) return;
    let live = true;
    const q = new URLSearchParams({ courseKey: plan.courseKey, year: String(plan.year), semester: String(plan.semester), mid: String(plan.midNumber) });
    fetch(`/api/college/mid-marks/overview?${q}`)
      .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error ?? "Unable to load the subjects."); return d as { mode: MidMarksMode; rows: Row[] }; })
      .then((d) => { if (live) { setError(null); setData({ key, ...d }); } })
      .catch((e: Error) => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [plan, key]);

  const rows = data?.key === key ? data.rows : null;
  const mode = data?.key === key ? data.mode : null;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  // Subjects whose exam is over and whose faculty entry is still closed (one subject can have several branch rows).
  const readyToOpen = [...new Set((rows ?? []).filter((r) => !r.entryOpen && (!r.examDay || r.examDay <= today)).map((r) => r.subjectId))];

  async function remind() {
    if (!plan) return;
    setToggling("remind");
    try {
      const res = await fetch("/api/college/mid-marks/remind", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ planId: plan.id }),
      });
      const d = (await res.json()) as { error?: string; notified?: number };
      if (!res.ok) throw new Error(d.error ?? "Unable to send reminders.");
      toast({ title: d.notified ? `Reminder sent to ${d.notified} faculty.` : "Nobody is pending - every open subject is submitted." });
    } catch (e) {
      toast({ variant: "destructive", title: (e as Error).message });
    } finally {
      setToggling(null);
    }
  }

  async function toggleEntry(subjectIds: string[], open: boolean, tag: string) {
    if (!plan || subjectIds.length === 0) return;
    setToggling(tag);
    try {
      const res = await fetch("/api/college/mid-marks/open", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ planId: plan.id, subjectIds, open }),
      });
      const d = (await res.json()) as { error?: string; notified?: number; opened?: string[] };
      if (!res.ok) throw new Error(d.error ?? "Unable to change marks entry.");
      toast({ title: open ? `Marks entry opened for ${d.opened?.length ?? 0} subject(s). ${d.notified ?? 0} faculty notified.` : "Marks entry closed." });
      setReload((n) => n + 1);
    } catch (e) {
      toast({ variant: "destructive", title: (e as Error).message });
    } finally {
      setToggling(null);
    }
  }
  const counts = useMemo(() => ({
    set: rows?.filter((r) => r.source !== "NONE").length ?? 0,
    total: rows?.length ?? 0,
  }), [rows]);

  return (
    <div className="space-y-4">
      <div className="max-w-xl space-y-1.5">
        <Label>Mid Timetable</Label>
        <Select value={planId} onValueChange={setPlanId}>
          <SelectTrigger><SelectValue placeholder={plans === null ? "Loading…" : plans.length ? "Select a Mid" : "No Mid timetable yet"} /></SelectTrigger>
          <SelectContent>
            {(plans ?? []).map((p) => (
              <SelectItem key={p.id} value={p.id}>{p.courseName} · {ROMAN[p.year] ?? p.year} Year · Semester {p.semester} · Mid-{p.midNumber}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {plan && !rows && !error && <div className="h-24 animate-pulse rounded-lg border bg-muted/30" />}

      {rows && (
        <>
          {mode === "FACULTY" && readyToOpen.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 px-4 py-3 text-sm">
              <span className="flex-1">{readyToOpen.length} subject(s) have had their exam and are still closed for faculty marks entry.</span>
              <Button size="sm" loading={toggling === "all"} onClick={() => void toggleEntry(readyToOpen, true, "all")}>Open All of Them</Button>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant="outline">{mode === "EXAM_CELL" ? "Uploaded by Exam Cell" : "Entered by subject faculty"}</Badge>
            <span className="text-muted-foreground">
              Questions ready for {counts.set} of {counts.total} subject-branch pairs. Change who enters in Mid Configuration › Marks.
            </span>
            {mode === "FACULTY" && rows.some((r) => r.entryOpen) && (
              <Button size="sm" variant="outline" className="ml-auto" loading={toggling === "remind"} onClick={() => void remind()}>Remind Pending Faculty</Button>
            )}
          </div>
          <MidMarksProgress rows={rows} facultyMode={mode === "FACULTY"} />
          {rows.length === 0 ? (
            <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">No Mid-exam subjects with teaching assignments for this Mid.</CardContent></Card>
          ) : (
            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3">Subject</th>
                      <th className="px-4 py-3">Branch</th>
                      <th className="px-4 py-3">Sections</th>
                      <th className="px-4 py-3">Questions</th>
                      {mode === "FACULTY" && <th className="px-4 py-3">Faculty Entry</th>}
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {rows.map((r) => (
                      <tr key={`${r.subjectId}|${r.branch}`}>
                        <td className="px-4 py-3"><span className="font-medium">{r.subjectCode}</span> <span className="text-muted-foreground">{r.subjectName}</span></td>
                        <td className="px-4 py-3">{r.branch}</td>
                        <td className="px-4 py-3">
                          <div className="space-y-1">
                            {(r.progress.length ? r.progress : r.sections.map((s) => ({ sectionId: s.id, section: s.name, facultyName: s.facultyName, entered: 0, total: 0, status: "NOT_STARTED" as const, locked: false }))).map((p) => (
                              <div key={p.sectionId} className="flex flex-wrap items-center gap-1.5 text-xs">
                                <span className="font-medium">{p.section}</span>
                                <span className="text-muted-foreground">{p.facultyName}</span>
                                <span className={p.status === "SUBMITTED" || p.locked ? "text-emerald-700" : p.status === "DRAFT" ? "text-amber-700" : "text-muted-foreground"}>
                                  {p.locked ? "Locked by Exam Cell" : p.status === "SUBMITTED" ? "Submitted" : p.status === "DRAFT" ? `${p.entered}/${p.total} entered` : "Not started"}
                                </span>
                                {"sheetId" in p && p.sheetId && <Link href={`/exam-cell/mid-marks/sheets/${p.sheetId}`} className="font-medium text-primary hover:underline">View</Link>}
                              </div>
                            ))}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          {r.source === "PAPER" ? <span>Finalized paper · {r.questions} columns · out of {r.paperMax}</span>
                            : r.source === "LAYOUT" ? <span>Set by Exam Cell · {r.questions} questions · out of {r.paperMax}</span>
                            : <span className="text-amber-700">Not set</span>}
                        </td>
                        {mode === "FACULTY" && (
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className={r.entryOpen ? "text-emerald-700" : "text-muted-foreground"}>{r.entryOpen ? "Open" : "Closed"}</span>
                              {r.examDay && !r.entryOpen && <span className="text-xs text-muted-foreground">exam {r.examDay}</span>}
                              <Button size="sm" variant="ghost" loading={toggling === `${r.subjectId}|${r.branch}`}
                                disabled={!r.entryOpen && !!r.examDay && r.examDay > today}
                                title={!r.entryOpen && r.examDay && r.examDay > today ? `Can be opened from ${r.examDay}` : undefined}
                                onClick={() => void toggleEntry([r.subjectId], !r.entryOpen, `${r.subjectId}|${r.branch}`)}>
                                {r.entryOpen ? "Close" : "Open"}
                              </Button>
                            </div>
                          </td>
                        )}
                        <td className="px-4 py-3 text-right">
                          {mode === "EXAM_CELL" ? (
                            <Button size="sm" onClick={() => setUploading(r)}>Upload Marks</Button>
                          ) : r.source !== "PAPER" && (
                            <Button size="sm" variant="outline" onClick={() => setEditing(r)}>{r.layout ? "Edit Questions" : "Set Questions"}</Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}

      {uploading && plan && (
        <MidMarksUploadDialog
          planId={plan.id} midNumber={plan.midNumber} subjectId={uploading.subjectId} subjectCode={uploading.subjectCode}
          subjectName={uploading.subjectName} branch={uploading.branch}
          onClose={() => setUploading(null)} onChanged={() => setReload((n) => n + 1)}
        />
      )}

      {editing && plan && (
        <LayoutDialog
          row={editing} midNumber={plan.midNumber}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); setReload((n) => n + 1); }}
        />
      )}
    </div>
  );
}

function LayoutDialog({ row, midNumber, onClose, onSaved }: { row: Row; midNumber: number; onClose: () => void; onSaved: () => void }) {
  const [questions, setQuestions] = useState<{ label: string; max: string }[]>(
    row.layout?.questions.map((q: MidLayoutQuestion) => ({ label: q.label, max: String(q.max) })) ?? [1, 2, 3, 4, 5].map((n) => ({ label: `Q${n}`, max: "" })),
  );
  const [paperMax, setPaperMax] = useState(row.layout ? String(row.layout.paperMax) : "");
  const [saving, setSaving] = useState(false);
  const sum = questions.reduce((n, q) => n + (Number(q.max) || 0), 0);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/college/mid-marks/layout", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subjectId: row.subjectId, subjectName: row.subjectName, branch: row.branch, midNumber,
          questions: questions.map((q) => ({ label: q.label.trim(), max: Number(q.max) })),
          paperMax: paperMax.trim() ? Number(paperMax) : undefined,
        }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Unable to save the questions.");
      toast({ title: "Questions saved." });
      onSaved();
    } catch (e) {
      toast({ variant: "destructive", title: (e as Error).message });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Mid-{midNumber} Questions</DialogTitle>
          <DialogDescription>{row.subjectCode} {row.subjectName} · {row.branch}. Marks are entered against these questions; the total is scaled to the Mid&apos;s max marks.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <div className="grid grid-cols-[1fr_6rem_2rem] gap-2 text-xs font-medium text-muted-foreground">
            <span>Question</span><span>Max Marks</span><span />
          </div>
          {questions.map((q, i) => (
            <div key={i} className="grid grid-cols-[1fr_6rem_2rem] gap-2">
              <Input value={q.label} maxLength={12} aria-label={`Question ${i + 1} name`}
                onChange={(e) => setQuestions((p) => p.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
              <Input type="number" min={0.5} step={0.5} value={q.max} aria-label={`Question ${i + 1} max marks`}
                onChange={(e) => setQuestions((p) => p.map((x, j) => (j === i ? { ...x, max: e.target.value } : x)))} />
              <Button variant="ghost" size="icon" aria-label={`Remove question ${i + 1}`} disabled={questions.length === 1}
                onClick={() => setQuestions((p) => p.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={() => setQuestions((p) => [...p, { label: `Q${p.length + 1}`, max: "" }])}>
            <Plus className="mr-1 h-4 w-4" />Add Question
          </Button>
          <div className="space-y-1.5 pt-2">
            <Label htmlFor="paper-max">Paper Max</Label>
            <Input id="paper-max" type="number" min={0.5} step={0.5} value={paperMax} placeholder={String(sum || "")} onChange={(e) => setPaperMax(e.target.value)} className="w-32" />
            <p className="text-xs text-muted-foreground">
              The paper&apos;s total. Leave blank when every question is answered ({sum} here); enter less when students choose (e.g. answer any 3 of 5).
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button loading={saving} onClick={() => void save()}>Save Questions</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
