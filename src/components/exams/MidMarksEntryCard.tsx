"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import { cn } from "@/lib/utils";
import { buildCourseGroups } from "@/lib/departments/hodScope";
import type { Course, ExamMidSettings } from "@/types";
import type { MidMarksMode } from "@/lib/exams/midMarksEntry";

// Exam Cell > Mid Configuration > Marks: who enters each Mid's marks, per course (lib/exams/midMarksEntry.ts).
interface ModeRow { courseKey: string; midNumber: number; mode: MidMarksMode }

const OPTIONS: { value: MidMarksMode; title: string; text: string }[] = [
  { value: "FACULTY", title: "By Subject Faculty", text: "Each subject's faculty enter question-wise for their section, against the finalized paper (or the questions you set)." },
  { value: "EXAM_CELL", title: "Uploaded by Exam Cell", text: "You upload the marks sheet with the questions and their max marks; faculty only view." },
];

export function MidMarksEntryCard() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [midCount, setMidCount] = useState(2);
  const [rows, setRows] = useState<ModeRow[]>([]);
  const [courseKey, setCourseKey] = useState("");
  const [busy, setBusy] = useState<number | null>(null);
  const groups = useMemo(() => buildCourseGroups(courses), [courses]);
  const selected = courseKey || groups[0]?.key || "";

  useEffect(() => {
    fetch("/api/college/courses").then((r) => r.json() as Promise<{ courses?: Course[] }>).then((d) => setCourses(d.courses ?? [])).catch(() => undefined);
    fetch("/api/college/exam-mid-settings").then((r) => r.json() as Promise<{ settings?: ExamMidSettings }>)
      .then((d) => { if (d.settings?.midCount) setMidCount(d.settings.midCount); }).catch(() => undefined);
    fetch("/api/college/mid-marks-entry").then((r) => r.json() as Promise<{ modes?: ModeRow[] }>).then((d) => setRows(d.modes ?? [])).catch(() => undefined);
  }, []);

  const modeOf = (mid: number): MidMarksMode => rows.find((r) => r.courseKey === selected && r.midNumber === mid)?.mode ?? "FACULTY";

  async function setMode(mid: number, mode: MidMarksMode) {
    if (modeOf(mid) === mode) return;
    setBusy(mid);
    try {
      const res = await fetch("/api/college/mid-marks-entry", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courseKey: selected, courseName: groups.find((g) => g.key === selected)?.name ?? "", midNumber: mid, mode }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Unable to save who enters the marks.");
      setRows((prev) => [...prev.filter((r) => !(r.courseKey === selected && r.midNumber === mid)), { courseKey: selected, midNumber: mid, mode }]);
      toast({ title: "Marks entry saved." });
    } catch (e) {
      toast({ variant: "destructive", title: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Marks Entry</CardTitle>
        <CardDescription>Who enters each Mid&apos;s marks, per course. It can&apos;t be changed once marks of that Mid are entered.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5 max-w-sm">
          <Label>Course</Label>
          <Select value={selected} onValueChange={setCourseKey}>
            <SelectTrigger><SelectValue placeholder="Select a course" /></SelectTrigger>
            <SelectContent>{groups.map((g) => <SelectItem key={g.key} value={g.key}>{g.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        {selected && Array.from({ length: midCount }, (_, i) => i + 1).map((mid) => (
          <div key={mid} className="space-y-2">
            <p className="text-sm font-medium">Mid-{mid}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {OPTIONS.map((o) => (
                <button key={o.value} type="button" disabled={busy === mid} onClick={() => void setMode(mid, o.value)}
                  className={cn("rounded-lg border p-3 text-left transition-colors disabled:opacity-60",
                    modeOf(mid) === o.value ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted/50")}>
                  <p className="text-sm font-medium">{o.title}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{o.text}</p>
                </button>
              ))}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
