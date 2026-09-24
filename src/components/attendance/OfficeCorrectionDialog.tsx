"use client";

import { useState } from "react";
import { Lock } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/useToast";
import type { StudentAttendanceMark, StudentAttendanceSession } from "@/types";

// Department Office correction: opened from a NOT_MARKED row on the
// "Attendance Completion" view (see FacultyAttendanceCompletionView) - the
// faculty's own class-hour window has already closed with nothing submitted,
// and this is the only other way that period's attendance can ever be
// recorded (see /api/college/student-attendance/office-correction's own
// doc-comment). Two steps in one dialog: capture WHY the faculty didn't post
// it themselves (required, audited), then load the roster and mark it same
// as the faculty would have.
interface OfficeCorrectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  facultyId: string;
  facultyName: string;
  assignmentId: string;
  date: string;
  periodNumber: number;
  subjectName: string;
  sectionLabel: string;
  onSubmitted: () => void;
}

export function OfficeCorrectionDialog({
  open, onOpenChange, facultyId, facultyName, assignmentId, date, periodNumber, subjectName, sectionLabel, onSubmitted,
}: OfficeCorrectionDialogProps) {
  const [reason, setReason] = useState("");
  const [isLoadingRoster, setIsLoadingRoster] = useState(false);
  const [session, setSession] = useState<StudentAttendanceSession | null>(null);
  const [draft, setDraft] = useState<Record<string, StudentAttendanceMark | null>>({});
  const [classNotes, setClassNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  function reset() {
    setReason("");
    setIsLoadingRoster(false);
    setSession(null);
    setDraft({});
    setClassNotes("");
    setIsSubmitting(false);
  }

  async function handleLoadRoster() {
    if (!reason.trim()) {
      toast({ variant: "destructive", title: "A reason is required" });
      return;
    }
    setIsLoadingRoster(true);
    try {
      const res = await fetch("/api/college/student-attendance/office-correction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ facultyId, assignmentId, date, periodNumber, reason: reason.trim() }),
      });
      const json = (await res.json()) as { session?: StudentAttendanceSession; error?: string };
      if (!res.ok || !json.session) {
        toast({ variant: "destructive", title: json.error ?? "Failed to load roster" });
        return;
      }
      setSession(json.session);
      setDraft(Object.fromEntries(json.session.entries.map((e) => [e.studentId, e.status])));
      setClassNotes(json.session.classNotes ?? "");
    } catch {
      toast({ variant: "destructive", title: "Failed to load roster" });
    } finally {
      setIsLoadingRoster(false);
    }
  }

  function toggleStudent(studentId: string, checked: boolean) {
    setDraft((prev) => ({ ...prev, [studentId]: checked ? "PRESENT" : "ABSENT" }));
  }

  const markedCount = session ? session.entries.filter((e) => draft[e.studentId] != null).length : 0;
  const allMarked = !!session && session.totalStudents > 0 && markedCount === session.totalStudents;
  const canSubmit = allMarked && classNotes.trim().length > 0;

  async function handleSubmit() {
    if (!session || !canSubmit) return;
    setIsSubmitting(true);
    try {
      const entries = session.entries.map((e) => ({ studentId: e.studentId, status: draft[e.studentId] ?? null }));
      const res = await fetch(`/api/college/student-attendance/office-correction/${session.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries, classNotes, reason: reason.trim(), submit: true }),
      });
      const json = (await res.json()) as { session?: StudentAttendanceSession; error?: string };
      if (!res.ok || !json.session) throw new Error(json.error ?? "Failed to submit attendance");
      toast({ variant: "success", title: `Attendance posted for ${facultyName}` });
      reset();
      onOpenChange(false);
      onSubmitted();
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to submit attendance" });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Post attendance on behalf of {facultyName}</DialogTitle>
          <DialogDescription>
            {subjectName} — {sectionLabel} — Period {periodNumber}, {date}. Their own window to post this has closed.
          </DialogDescription>
        </DialogHeader>

        {!session ? (
          <div className="space-y-3">
            <Label htmlFor="office-correction-reason">Reason the faculty didn&apos;t post this themselves</Label>
            <Textarea
              id="office-correction-reason"
              placeholder="e.g. Faculty was on leave that day and no substitute was assigned / connectivity issue reported / forgot to submit"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              required
            />
            <DialogFooter>
              <Button onClick={() => void handleLoadRoster()} disabled={isLoadingRoster || !reason.trim()} loading={isLoadingRoster}>
                Load Roster
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
              Total Students: <strong>{session.totalStudents}</strong>
              <span className="mx-2 text-blue-300">|</span>
              Marked: <strong>{markedCount}</strong> / {session.totalStudents}
            </div>

            <div className="max-h-80 overflow-y-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2">Reg No.</th>
                    <th className="px-4 py-2">Student Name</th>
                    <th className="px-4 py-2 text-center">Present</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {session.entries.map((e) => (
                    <tr key={e.studentId}>
                      <td className="px-4 py-2">{e.rollNumber}</td>
                      <td className="px-4 py-2 font-medium">{e.name}</td>
                      <td className="px-4 py-2 text-center">
                        <Switch
                          checked={draft[e.studentId] === "PRESENT"}
                          onCheckedChange={(c) => toggleStudent(e.studentId, c)}
                          aria-label={`Mark ${e.name} present`}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="space-y-2">
              <Label htmlFor="office-correction-classnotes">Record of the Class Work (required)</Label>
              <Textarea
                id="office-correction-classnotes"
                placeholder="What was taught/done in this period?"
                value={classNotes}
                onChange={(e) => setClassNotes(e.target.value)}
                rows={2}
                required
              />
            </div>

            <DialogFooter>
              <Button onClick={() => void handleSubmit()} disabled={!canSubmit || isSubmitting} loading={isSubmitting}>
                <Lock className="h-4 w-4" />
                Submit Attendance
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
