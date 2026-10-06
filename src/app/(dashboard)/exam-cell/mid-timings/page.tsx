"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarRange, Clock, Info, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/useToast";
import { formatDMY } from "@/lib/utils";
import type { Course, ExamMidSchedule, ExamMidSettings } from "@/types";
import { useCourseSemesterPlan } from "@/hooks/useCourseSemesterPlan";

// Local calendar date, not toISOString() (that's UTC - would read as
// yesterday for anyone east of UTC late at night). Same helper as Circulars.
function todayISODate(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatTime12h(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

export default function ExamCellMidTimingsPage() {
  const [schedules, setSchedules] = useState<ExamMidSchedule[]>([]);
  const [midCount, setMidCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<ExamMidSchedule | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ExamMidSchedule | null>(null);

  async function load() {
    try {
      const [schedRes, settingsRes] = await Promise.all([
        fetch("/api/college/exam-mid-schedules"),
        fetch("/api/college/exam-mid-settings"),
      ]);
      const schedData = (await schedRes.json()) as { schedules?: ExamMidSchedule[]; error?: string };
      const settingsData = (await settingsRes.json()) as { settings?: ExamMidSettings };
      if (!schedRes.ok) throw new Error(schedData.error ?? "Failed to load");
      setSchedules(schedData.schedules ?? []);
      setMidCount(settingsData.settings?.midCount ?? 0);
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Failed to load mid timings" });
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => { void (async () => { await load(); })(); }, []);

  async function handleDelete() {
    if (!deleteTarget) return;
    const res = await fetch(`/api/college/exam-mid-schedules/${deleteTarget.id}`, { method: "DELETE" });
    const data = (await res.json()) as { error?: string };
    if (!res.ok) {
      toast({ variant: "destructive", title: data.error ?? "Failed to delete" });
      return;
    }
    toast({ variant: "success", title: "Schedule removed" });
    setDeleteTarget(null);
    await load();
  }

  return (
    <div className="max-w-4xl space-y-6">
      <PageHeader
        title="Mid Timings & Dates"
        description="Publish the date and time window for each Mid, per course and semester. Once published, entries can still be edited or removed."
        actions={
          <Button onClick={() => setFormOpen(true)} disabled={midCount === 0}>
            <Plus className="h-4 w-4 mr-2" />Publish Timings
          </Button>
        }
      />

      {!isLoading && midCount === 0 && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="flex items-center gap-3 py-4 text-sm text-amber-800">
            <Info className="h-4 w-4 shrink-0" />
            <span>
              Set how many Mid exams this college runs in{" "}
              <Link href="/exam-cell/settings" className="font-medium underline">Settings</Link> before publishing timings.
            </span>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <div className="space-y-3">{[1, 2].map((i) => <div key={i} className="h-20 bg-muted animate-pulse rounded-lg" />)}</div>
      ) : schedules.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center space-y-1">
            <p className="text-sm text-muted-foreground">No mid timings published yet.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {schedules.map((s) => (
            <Card key={s.id}>
              <CardContent className="p-4 space-y-2">
                <div className="flex flex-wrap items-start gap-3">
                  <CalendarRange className="h-5 w-5 shrink-0 text-muted-foreground mt-0.5" />
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="text-sm font-semibold">{s.courseName}</p>
                      <Badge variant="outline" className="text-[10px]">Sem {s.semester}/{s.totalSemesters}</Badge>
                      <Badge variant="outline" className="text-[10px]">Mid {s.midNumber}</Badge>
                    </div>
                    <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <CalendarRange className="h-3 w-3" />
                        {formatDMY(s.fromDate)}{s.fromDate !== s.toDate ? ` - ${formatDMY(s.toDate)}` : ""}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {formatTime12h(s.fromTime)} - {formatTime12h(s.toTime)}
                      </span>
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setEditTarget(s)}>
                      <Pencil className="h-3.5 w-3.5 mr-1" />Edit
                    </Button>
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setDeleteTarget(s)}>
                      <Trash2 className="h-3.5 w-3.5 mr-1" />Delete
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {formOpen && (
        <MidScheduleFormDialog open midCount={midCount} onClose={() => setFormOpen(false)} onDone={load} />
      )}
      {editTarget && (
        <MidScheduleFormDialog
          key={editTarget.id}
          open
          midCount={midCount}
          schedule={editTarget}
          onClose={() => setEditTarget(null)}
          onDone={load}
        />
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}
        title="Remove this mid timing?"
        description={deleteTarget ? `${deleteTarget.courseName} - Sem ${deleteTarget.semester}/${deleteTarget.totalSemesters} - Mid ${deleteTarget.midNumber} will be deleted.` : undefined}
        confirmLabel="Remove"
        variant="destructive"
        onConfirm={handleDelete}
      />
    </div>
  );
}

function MidScheduleFormDialog({
  open, midCount, schedule, onClose, onDone,
}: {
  open: boolean;
  midCount: number;
  schedule?: ExamMidSchedule;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const todayStr = todayISODate();
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseName, setCourseName] = useState(schedule?.courseName ?? "");
  const [semester, setSemester] = useState(schedule ? String(schedule.semester) : "");
  const [midNumber, setMidNumber] = useState(schedule ? String(schedule.midNumber) : "");
  const [fromDate, setFromDate] = useState(schedule?.fromDate ?? "");
  const [toDate, setToDate] = useState(schedule?.toDate ?? "");
  const [fromTime, setFromTime] = useState(schedule?.fromTime ?? "");
  const [toTime, setToTime] = useState(schedule?.toTime ?? "");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/college/courses");
        const data = (await res.json()) as { courses?: Course[] };
        setCourses(data.courses ?? []);
      } catch {
        toast({ variant: "destructive", title: "Failed to load courses" });
      }
    })();
  }, []);

  const courseNameOptions = useMemo(() => [...new Set(courses.map((c) => c.name))].sort(), [courses]);

  // Semesters, not years - no department dimension in this form, same convention as Circulars'
  // NoticeFormDialog: the longest course of this name, semesters from its own setup.
  const longestCourse = useMemo(
    () => courses.filter((c) => c.name === courseName).sort((a, b) => b.durationYears - a.durationYears)[0] ?? null,
    [courses, courseName]
  );
  const semesterPlan = useCourseSemesterPlan(longestCourse);
  const totalSemesters = useMemo(() => {
    if (schedule && schedule.courseName === courseName) return schedule.totalSemesters;
    return semesterPlan.semesters.length;
  }, [semesterPlan, courseName, schedule]);
  const semesterOptions = useMemo(() => Array.from({ length: totalSemesters || 0 }, (_, i) => i + 1), [totalSemesters]);
  const midOptions = useMemo(() => Array.from({ length: midCount }, (_, i) => i + 1), [midCount]);

  function reset() {
    setCourseName("");
    setSemester("");
    setMidNumber("");
    setFromDate("");
    setToDate("");
    setFromTime("");
    setToTime("");
  }

  async function submit() {
    if (!courseName) { toast({ variant: "destructive", title: "Select a course" }); return; }
    if (!semester || !totalSemesters) { toast({ variant: "destructive", title: "Select a semester" }); return; }
    if (!midNumber) { toast({ variant: "destructive", title: "Select a mid" }); return; }
    if (!fromDate || !toDate) { toast({ variant: "destructive", title: "Pick a date range" }); return; }
    if (!fromTime || !toTime) { toast({ variant: "destructive", title: "Pick a time range" }); return; }

    const courseId = courses.find((c) => c.name === courseName)?.id;
    const payload = {
      courseId, courseName, semester: Number(semester), totalSemesters, midNumber: Number(midNumber),
      fromDate, toDate, fromTime, toTime,
    };

    setBusy(true);
    try {
      const url = schedule ? `/api/college/exam-mid-schedules/${schedule.id}` : "/api/college/exam-mid-schedules";
      const res = await fetch(url, {
        method: schedule ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to save");
      toast({ variant: "success", title: schedule ? "Timing updated" : "Timing published" });
      if (!schedule) reset();
      onClose();
      await onDone();
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to save" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { if (!schedule) reset(); onClose(); } }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{schedule ? "Edit Mid Timing" : "Publish Mid Timing"}</DialogTitle>
          <DialogDescription>
            There&apos;s no student login in this app yet, so publishing saves this here for now - it will
            show automatically for the matching course and semester once student access exists.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Course</Label>
            <Select value={courseName} onValueChange={(v) => { setCourseName(v); setSemester(""); }} disabled={busy}>
              <SelectTrigger><SelectValue placeholder="Select course" /></SelectTrigger>
              <SelectContent>
                {courseNameOptions.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Semester</Label>
            <Select value={semester} onValueChange={setSemester} disabled={busy || !courseName}>
              <SelectTrigger><SelectValue placeholder="Select semester" /></SelectTrigger>
              <SelectContent>
                {semesterOptions.map((s) => <SelectItem key={s} value={String(s)}>{s}/{totalSemesters}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label>Mid</Label>
            <Select value={midNumber} onValueChange={setMidNumber} disabled={busy || midOptions.length === 0}>
              <SelectTrigger className="sm:w-48"><SelectValue placeholder="Select mid" /></SelectTrigger>
              <SelectContent>
                {midOptions.map((n) => <SelectItem key={n} value={String(n)}>Mid {n}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>From Date</Label>
            <Input type="date" min={todayStr} value={fromDate} onChange={(e) => setFromDate(e.target.value)} disabled={busy} />
          </div>
          <div className="space-y-2">
            <Label>To Date</Label>
            <Input type="date" min={fromDate || todayStr} value={toDate} onChange={(e) => setToDate(e.target.value)} disabled={busy} />
          </div>
          <div className="space-y-2">
            <Label>From Time</Label>
            <Input type="time" value={fromTime} onChange={(e) => setFromTime(e.target.value)} disabled={busy} />
          </div>
          <div className="space-y-2">
            <Label>To Time</Label>
            <Input type="time" value={toTime} onChange={(e) => setToTime(e.target.value)} disabled={busy} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => { if (!schedule) reset(); onClose(); }} disabled={busy}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={busy}>
            {busy ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Saving…</> : schedule ? "Save" : "Publish"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
