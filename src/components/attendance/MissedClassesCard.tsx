"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlarmClock } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import { dmy } from "@/lib/utils";
import type { StudentAttendanceMark, StudentAttendanceSession } from "@/types";

interface Missed {
  date: string;
  assignmentId: string;
  periodNumber: number;
  startTime: string;
  endTime: string;
  subjectName: string;
  sectionName: string;
  department: string;
  year: number;
  draft: boolean;
  blocked?: string;
}

const keyOf = (p: Missed) => `${p.assignmentId}_${p.date}_${p.periodNumber}`;

// Mark Attendance > Missed Classes (Late Marking, lib/studentAttendance/lateMark.ts): the faculty member's own
// periods of the last few days whose posting closed without a submit. "Mark Late" asks the reason, opens the class
// list (POST student-attendance with lateMark), and submits it (PATCH). The HOD of the class's department is told.
export function MissedClassesCard() {
  const [open, setOpen] = useState<Missed | null>(null);
  const q = useQuery({
    queryKey: ["late-mark-missed"],
    queryFn: async () => {
      const r = await fetch("/api/college/student-attendance/late-mark", { cache: "no-store" });
      const d = (await r.json().catch(() => ({}))) as { days?: number; periods?: Missed[]; error?: string };
      if (!r.ok) throw new Error(d.error ?? "Unable to load missed classes.");
      return { days: d.days ?? 0, periods: d.periods ?? [] };
    },
  });
  const periods = q.data?.periods ?? [];
  if (!q.data || q.data.days <= 0 || periods.length === 0) return null;

  return (
    <Card className="border-amber-200 dark:border-amber-900">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base"><AlarmClock className="h-4 w-4" />Missed Classes</CardTitle>
        <CardDescription>
          Classes from the last {q.data.days} day{q.data.days === 1 ? "" : "s"} whose attendance was not posted. Mark each one late with a reason - your HOD is told.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-0">
        <ul className="divide-y text-sm">
          {periods.map((p) => (
            <li key={keyOf(p)} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
              <div className="min-w-0">
                <p className="font-medium">
                  {dmy(p.date)} · Period {p.periodNumber} · {p.startTime}–{p.endTime}
                  {p.draft && <span className="ml-2 rounded border px-1 text-[10px] font-normal text-muted-foreground">Draft saved</span>}
                </p>
                <p className="text-xs text-muted-foreground">{p.subjectName} · {[p.department, p.sectionName].filter(Boolean).join(" ")}</p>
                {p.blocked && <p className="text-xs text-muted-foreground italic">{p.blocked}</p>}
              </div>
              {!p.blocked && <Button size="sm" variant="outline" onClick={() => setOpen(p)}>Mark Late</Button>}
            </li>
          ))}
        </ul>
      </CardContent>
      {open && <LateMarkDialog period={open} onClose={() => setOpen(null)} onDone={() => { setOpen(null); void q.refetch(); }} />}
    </Card>
  );
}

function LateMarkDialog({ period, onClose, onDone }: { period: Missed; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sess, setSess] = useState<(StudentAttendanceSession & { id: string }) | null>(null);
  const [marks, setMarks] = useState<Record<string, StudentAttendanceMark | null>>({});
  const [notes, setNotes] = useState("");

  async function openList() {
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/college/student-attendance", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignmentId: period.assignmentId, date: period.date, periodNumber: period.periodNumber, lateMark: { reason: reason.trim() } }),
      });
      const d = (await res.json().catch(() => ({}))) as { session?: StudentAttendanceSession & { id: string }; error?: string };
      if (!res.ok || !d.session) { setError(d.error ?? "Unable to open the class list. Try again."); return; }
      if (d.session.status === "SUBMITTED") { toast({ title: "This class was already submitted." }); onDone(); return; }
      setSess(d.session);
      setMarks(Object.fromEntries(d.session.entries.map((e) => [e.studentId, e.status])));
      setNotes(d.session.classNotes ?? "");
    } catch {
      setError("Unable to open the class list. Check the connection and try again.");
    } finally { setBusy(false); }
  }

  function setAll(status: "PRESENT" | "ABSENT") {
    setMarks((m) => Object.fromEntries(Object.entries(m).map(([id, v]) => [id, v === "ON_DUTY" ? v : status])));
  }

  const unmarked = sess ? sess.entries.filter((e) => !marks[e.studentId]).length : 0;
  const needNotes = !!sess && !sess.attendanceOnly && !notes.trim();

  async function submit() {
    if (!sess) return;
    setBusy(true); setError(null);
    try {
      const entries = sess.entries
        .filter((e) => marks[e.studentId] !== "ON_DUTY")
        .map((e) => ({ studentId: e.studentId, status: marks[e.studentId] ?? null }));
      const res = await fetch(`/api/college/student-attendance/${sess.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries, classNotes: notes, submit: true }),
      });
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) { setError(d.error ?? "Unable to submit the attendance. Try again."); return; }
      toast({ variant: "success", title: "Attendance submitted.", description: "Marked late - your HOD has been told." });
      onDone();
    } catch {
      setError("Unable to submit the attendance. Check the connection and try again.");
    } finally { setBusy(false); }
  }

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Mark Class Late</DialogTitle>
          <DialogDescription>
            {dmy(period.date)} · Period {period.periodNumber} ({period.startTime}–{period.endTime}) · {period.subjectName} · {[period.department, period.sectionName].filter(Boolean).join(" ")}
          </DialogDescription>
        </DialogHeader>

        {!sess ? (
          <div className="space-y-1.5">
            <Label htmlFor="late-reason">Reason for Marking Late</Label>
            <Textarea id="late-reason" rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why the attendance was not posted on time" />
            <p className="text-xs text-muted-foreground">The HOD of this class&apos;s department sees the reason.</p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>{sess.entries.length} students{unmarked ? ` · ${unmarked} not marked` : ""}</span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => setAll("PRESENT")}>All Present</Button>
                <Button size="sm" variant="outline" onClick={() => setAll("ABSENT")}>All Absent</Button>
              </div>
            </div>
            <ul className="max-h-72 divide-y overflow-y-auto rounded-md border text-sm">
              {sess.entries.map((e) => {
                const m = marks[e.studentId];
                return (
                  <li key={e.studentId} className="flex items-center justify-between gap-2 px-3 py-1.5">
                    <span className="min-w-0 truncate"><span className="text-muted-foreground">{e.rollNumber || "-"}</span> {e.name}</span>
                    {m === "ON_DUTY" ? (
                      <span className="text-xs text-muted-foreground">On Duty</span>
                    ) : (
                      <div className="flex shrink-0 gap-1">
                        <Button size="sm" variant={m === "PRESENT" ? "default" : "outline"} className="h-7 px-2" onClick={() => setMarks((x) => ({ ...x, [e.studentId]: "PRESENT" }))}>P</Button>
                        <Button size="sm" variant={m === "ABSENT" ? "destructive" : "outline"} className="h-7 px-2" onClick={() => setMarks((x) => ({ ...x, [e.studentId]: "ABSENT" }))}>A</Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
            <div className="space-y-1.5">
              <Label htmlFor="late-notes">Record of the Class Work{sess.attendanceOnly ? " (Optional)" : ""}</Label>
              <Textarea id="late-notes" rows={2} maxLength={5000} value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          {!sess ? (
            <Button onClick={() => void openList()} loading={busy} disabled={!reason.trim()}>Open Class List</Button>
          ) : (
            <Button onClick={() => void submit()} loading={busy} disabled={unmarked > 0 || needNotes}>Submit Attendance</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
