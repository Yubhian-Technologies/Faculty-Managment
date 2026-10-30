"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, Lock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/useToast";
import { checkedMeaningFor, defaultFillFor, type AttendanceMode } from "@/lib/studentAttendance/markMode";
import type { StudentAttendanceMark, StudentAttendanceSession } from "@/types";

// Department Office editing of one class's student attendance, on the Edit Attendance tab: the same grid the
// faculty marks in (Check Absentees / Check Presentees, one switch per period, one switch for all periods of
// the card), opened on the saved marks. Opening a period (POST office-correction) makes no change; every save
// (PATCH office-correction/[id]) needs the reason and is audited. Allowed once the period has ended.

export interface EditablePeriod {
  assignmentId: string;
  periodNumber: number;
  startTime: string;
  endTime: string;
}

type Mark = StudentAttendanceMark | null;

export function OfficeAttendanceEditor({ facultyId, date, subjectName, sectionLabel, periods, onDone, onCancel }: {
  facultyId: string;
  date: string;
  subjectName: string;
  sectionLabel: string;
  /** The consecutive periods of one class shown on the card, in order. */
  periods: EditablePeriod[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [sessions, setSessions] = useState<Record<number, StudentAttendanceSession>>({});
  const [roster, setRoster] = useState<{ studentId: string; name: string; rollNumber: string }[]>([]);
  const [draft, setDraft] = useState<Record<string, Record<number, Mark>>>({});
  const [mode, setMode] = useState<AttendanceMode | null>("ABSENTEES");
  const [classNotes, setClassNotes] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);

  const periodNumbers = periods.map((p) => p.periodNumber);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const loaded = await Promise.all(periods.map(async (p) => {
          const res = await fetch("/api/college/student-attendance/office-correction", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ facultyId, assignmentId: p.assignmentId, date, periodNumber: p.periodNumber }),
          });
          const json = (await res.json()) as { session?: StudentAttendanceSession; error?: string };
          if (!res.ok || !json.session) throw new Error(json.error ?? `Failed to open period ${p.periodNumber}`);
          return [p.periodNumber, json.session] as const;
        }));
        if (cancelled) return;
        const byPeriod = Object.fromEntries(loaded) as Record<number, StudentAttendanceSession>;
        const first = byPeriod[periods[0].periodNumber];
        const nextDraft: Record<string, Record<number, Mark>> = {};
        for (const e of first.entries) {
          nextDraft[e.studentId] = {};
          for (const p of periods) {
            const entry = byPeriod[p.periodNumber].entries.find((x) => x.studentId === e.studentId);
            nextDraft[e.studentId][p.periodNumber] = entry?.status ?? defaultFillFor("ABSENTEES");
          }
        }
        setSessions(byPeriod);
        setRoster(first.entries.map((e) => ({ studentId: e.studentId, name: e.name, rollNumber: e.rollNumber })));
        setDraft(nextDraft);
        setClassNotes(first.classNotes ?? "");
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to open attendance");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // Opened once per card.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Periods nobody has submitted yet start from the mode's default fill, like the faculty's own page; a period
  // that already has saved marks keeps them whatever the mode.
  function pickMode(next: AttendanceMode, checked: boolean) {
    if (!checked) { setMode((prev) => (prev === next ? null : prev)); return; }
    setMode(next);
    setDraft((prev) => {
      const out: Record<string, Record<number, Mark>> = {};
      for (const [studentId, marks] of Object.entries(prev)) {
        out[studentId] = { ...marks };
        for (const n of periodNumbers) {
          if (marks[n] !== "ON_DUTY" && sessions[n]?.status !== "SUBMITTED") out[studentId][n] = defaultFillFor(next);
        }
      }
      return out;
    });
  }

  function setCell(studentId: string, periodNumber: number, status: Mark) {
    setDraft((prev) => (prev[studentId]?.[periodNumber] === "ON_DUTY" ? prev : { ...prev, [studentId]: { ...prev[studentId], [periodNumber]: status } }));
  }

  function setRow(studentId: string, status: StudentAttendanceMark) {
    setDraft((prev) => {
      const marks = { ...prev[studentId] };
      for (const n of periodNumbers) if (marks[n] !== "ON_DUTY") marks[n] = status;
      return { ...prev, [studentId]: marks };
    });
  }

  const meaning = checkedMeaningFor(mode);
  const opposite: StudentAttendanceMark = meaning === "PRESENT" ? "ABSENT" : "PRESENT";
  const canSave = !isSaving && !!mode && classNotes.trim().length > 0 && reason.trim().length > 0 && roster.length > 0;

  async function save() {
    setIsSaving(true);
    const failed: string[] = [];
    for (const n of periodNumbers) {
      const session = sessions[n];
      // On Duty students are locked and left out of the update.
      const entries = roster
        .filter((s) => draft[s.studentId]?.[n] !== "ON_DUTY")
        .map((s) => ({ studentId: s.studentId, status: draft[s.studentId]?.[n] ?? null }));
      try {
        const res = await fetch(`/api/college/student-attendance/office-correction/${session.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ entries, classNotes: classNotes.trim(), reason: reason.trim(), submit: true }),
        });
        if (!res.ok) failed.push(`Period ${n}: ${((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Failed to save"}`);
      } catch {
        failed.push(`Period ${n}: Network error`);
      }
    }
    setIsSaving(false);
    if (failed.length === 0) {
      toast({ variant: "success", title: `Attendance saved for ${periodNumbers.length} period${periodNumbers.length > 1 ? "s" : ""}` });
      onDone();
    } else {
      toast({ variant: "destructive", title: "Some periods were not saved", description: failed.join(" | ") });
    }
  }

  const heading = `${subjectName} - ${sectionLabel} - ${periodNumbers.length > 1 ? `Periods ${periodNumbers.join(", ")}` : `Period ${periodNumbers[0]}`}, ${date}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">{heading}</p>
        <Button variant="outline" size="sm" onClick={onCancel} disabled={isSaving}>
          <ArrowLeft className="h-4 w-4 mr-1.5" /> Back to periods
        </Button>
      </div>

      {isLoading ? (
        <div className="h-48 rounded-lg border bg-muted/30 animate-pulse" />
      ) : error ? (
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">{error}</CardContent></Card>
      ) : (
        <>
          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center gap-6 border-b px-4 py-3">
              <label className="flex items-center gap-2 text-sm font-medium">
                <Switch checked={mode === "ABSENTEES"} onCheckedChange={(c) => pickMode("ABSENTEES", c)} aria-label="Check absentees" />
                Check Absentees
              </label>
              <label className="flex items-center gap-2 text-sm font-medium">
                <Switch checked={mode === "PRESENTEES"} onCheckedChange={(c) => pickMode("PRESENTEES", c)} aria-label="Check presentees" />
                Check Presentees
              </label>
            </div>
            <p className="border-b bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
              {mode === "ABSENTEES" ? "Switch a period (or all periods) on to mark a student Absent." : mode === "PRESENTEES" ? "Switch a period (or all periods) on to mark a student Present." : "Pick one option above to unlock the switches."}
            </p>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">S.No</th>
                    <th className="px-4 py-3">Reg No.</th>
                    <th className="px-4 py-3">Student Name</th>
                    {periods.map((p) => (
                      <th key={p.periodNumber} className="px-3 py-3 text-center border-l">
                        <div>Period {p.periodNumber}</div>
                        <div className="text-[10px] font-normal normal-case text-muted-foreground">{p.startTime} - {p.endTime}</div>
                      </th>
                    ))}
                    {periods.length > 1 && <th className="px-3 py-3 text-center border-l">All periods</th>}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {roster.map((s, i) => {
                    const open = periodNumbers.filter((n) => draft[s.studentId]?.[n] !== "ON_DUTY");
                    return (
                      <tr key={s.studentId}>
                        <td className="px-4 py-2.5 text-muted-foreground">{i + 1}</td>
                        <td className="px-4 py-2.5 font-mono text-xs">{s.rollNumber}</td>
                        <td className="px-4 py-2.5 font-medium">{s.name}</td>
                        {periodNumbers.map((n) => (
                          <td key={n} className="px-3 py-2.5 text-center border-l whitespace-nowrap">
                            {draft[s.studentId]?.[n] === "ON_DUTY" ? (
                              <span title="Approved permission - locked" className="inline-flex rounded-full border px-2 py-0.5 text-xs font-medium">On Duty</span>
                            ) : (
                              <Switch
                                checked={draft[s.studentId]?.[n] === meaning}
                                disabled={!mode || isSaving}
                                onCheckedChange={(c) => setCell(s.studentId, n, c ? meaning : opposite)}
                                aria-label={`Mark ${s.name} period ${n} ${meaning === "PRESENT" ? "present" : "absent"}`}
                              />
                            )}
                          </td>
                        ))}
                        {periods.length > 1 && (
                          <td className="px-3 py-2.5 text-center border-l whitespace-nowrap">
                            {open.length === 0 ? (
                              <span className="text-xs text-muted-foreground">On Duty</span>
                            ) : (
                              <Switch
                                checked={open.every((n) => draft[s.studentId]?.[n] === meaning)}
                                disabled={!mode || isSaving}
                                onCheckedChange={(c) => setRow(s.studentId, c ? meaning : opposite)}
                                title={`Applies to Periods ${open.join(", ")}. On Duty periods are kept.`}
                                aria-label={`Mark ${s.name} ${meaning === "PRESENT" ? "present" : "absent"} for all periods`}
                              />
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="overflow-hidden">
            <div className="space-y-4 p-4">
              <div className="space-y-2">
                <Label htmlFor="office-edit-notes" className="text-sm font-medium">Record of the Class Work *</Label>
                <Textarea id="office-edit-notes" rows={2} value={classNotes} onChange={(e) => setClassNotes(e.target.value)} disabled={isSaving} placeholder="What was taught/done in this class?" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="office-edit-reason" className="text-sm font-medium">Reason for this change *</Label>
                <Textarea id="office-edit-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} disabled={isSaving} placeholder="Recorded with the change, e.g. marked late / correction requested by the faculty" />
              </div>
            </div>
            <CardContent className="flex items-center justify-end border-t py-4">
              <Button onClick={() => void save()} disabled={!canSave} loading={isSaving}>
                <Lock className="h-4 w-4" /> Save Attendance ({periodNumbers.length} Period{periodNumbers.length > 1 ? "s" : ""})
              </Button>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
