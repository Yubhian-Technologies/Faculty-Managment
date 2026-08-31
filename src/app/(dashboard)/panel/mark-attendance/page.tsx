"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarClock, Info, Lock, Pencil, RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/useToast";
import type { StudentAttendanceMark, StudentAttendanceSession } from "@/types";

// How often to re-check the published timetable for the active period. A
// plain poll (rather than scheduling a timer at the next period boundary)
// keeps this simple and also picks up a same-period republish within the
// same window (see CLAUDE.md's HOD Timetable -> Faculty Dashboard connect).
const PERIOD_POLL_MS = 30_000;

interface CurrentPeriodInfo {
  active: boolean;
  assignmentId?: string;
  periodNumber?: number;
  startTime?: string;
  endTime?: string;
  department?: string;
  courseId?: string;
  courseName?: string;
  year?: number;
  sectionId?: string;
  sectionName?: string;
  subjectId?: string;
  subjectName?: string;
  subjectCode?: string;
}

function todayStr(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)!.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

/** "2026-08-18" -> "18-08-2026" - display only. */
function formatDateDDMMYYYY(dateStr: string) {
  const [y, m, d] = dateStr.split("-");
  return `${d}-${m}-${y}`;
}

function ordinalYear(year: number) {
  const suffix = year === 1 ? "st" : year === 2 ? "nd" : year === 3 ? "rd" : "th";
  return `${year}${suffix} Year`;
}

/** "09:00" -> "9:00 AM" - display only, stored values stay 24h "HH:MM". */
function formatTime12h(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

// The faculty picks exactly one of these two modes to mark the whole class
// in one step — attendance is complete for everyone as soon as the mode is
// picked, with each row still individually overridable afterward.
type AttendanceMode = "ALL_PRESENT" | "ALL_ABSENT";

function checkedMeaningFor(mode: AttendanceMode | null): StudentAttendanceMark {
  return mode === "ALL_ABSENT" ? "ABSENT" : "PRESENT";
}

function defaultFillFor(mode: AttendanceMode): StudentAttendanceMark {
  switch (mode) {
    case "ALL_PRESENT": return "PRESENT";
    case "ALL_ABSENT": return "ABSENT";
  }
}

export default function MarkAttendancePage() {
  const [currentPeriod, setCurrentPeriod] = useState<CurrentPeriodInfo | null>(null);
  const [isLoadingPeriod, setIsLoadingPeriod] = useState(true);
  // The endTime of the period that was just active, so the empty state can
  // say "ended at 9:50 AM" instead of a generic "no class" the moment a
  // period closes and nothing has started in its place yet.
  const [justEndedAt, setJustEndedAt] = useState<string | null>(null);
  const prevPeriodRef = useRef<CurrentPeriodInfo | null>(null);

  const [attendanceSession, setAttendanceSession] = useState<StudentAttendanceSession | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoadingStudents, setIsLoadingStudents] = useState(false);
  const [draft, setDraft] = useState<Record<string, StudentAttendanceMark | null>>({});
  const [mode, setMode] = useState<AttendanceMode | null>(null);
  const [classNotes, setClassNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function checkCurrentPeriod() {
    try {
      const res = await fetch("/api/college/student-attendance/current-period");
      if (!res.ok) throw new Error("Failed to check current period");
      const json = (await res.json()) as CurrentPeriodInfo;
      const prev = prevPeriodRef.current;
      if (prev?.active && !json.active && prev.endTime) {
        setJustEndedAt(prev.endTime);
      } else if (json.active) {
        setJustEndedAt(null);
      }
      prevPeriodRef.current = json;
      setCurrentPeriod(json);
    } catch {
      prevPeriodRef.current = { active: false };
      setCurrentPeriod({ active: false });
    } finally {
      setIsLoadingPeriod(false);
    }
  }

  // Poll the published timetable for the active period; on a fresh window
  // (period changes, or nothing was active before) it flips automatically to
  // PRESENTEES etc. below via the assignmentId-keyed effect.
  useEffect(() => {
    void checkCurrentPeriod();
    const interval = setInterval(() => void checkCurrentPeriod(), PERIOD_POLL_MS);
    return () => clearInterval(interval);
  }, []);

  function resetSession() {
    setAttendanceSession(null);
    setLoadError(null);
    setDraft({});
    setMode(null);
    setClassNotes("");
  }

  async function handleLoadStudents(assignmentId: string) {
    setIsLoadingStudents(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/college/student-attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignmentId, date: todayStr() }),
      });
      const json = (await res.json()) as { session?: StudentAttendanceSession; error?: string };
      if (!res.ok || !json.session) {
        setLoadError(json.error ?? "Failed to load students");
        return;
      }
      setAttendanceSession(json.session);
      setDraft(Object.fromEntries(json.session.entries.map((e) => [e.studentId, e.status])));
      setMode(null);
      setClassNotes(json.session.classNotes ?? "");
    } catch {
      setLoadError("Failed to load students");
    } finally {
      setIsLoadingStudents(false);
    }
  }

  // The active period drives which class is loaded — no manual selection.
  // Only (re)loads when the active session identity actually changes (period
  // rolled over, or a class just became active), so an in-progress poll
  // never wipes marks the faculty is still entering for the same period. Keyed
  // by period number too (matching the API's `${assignmentId}_${date}_${periodNumber}`
  // session id) - not just assignmentId - so consecutive periods of the same
  // assignment (same faculty/section/subject back-to-back) are recognized as
  // a period change and reload into a fresh, independent session rather than
  // reusing/continuing Period 1's into Period 2.
  useEffect(() => {
    if (!currentPeriod?.active || !currentPeriod.assignmentId || currentPeriod.periodNumber == null) {
      if (attendanceSession) resetSession();
      return;
    }
    const key = `${currentPeriod.assignmentId}_${todayStr()}_${currentPeriod.periodNumber}`;
    if (attendanceSession?.id === key) return;
    void handleLoadStudents(currentPeriod.assignmentId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPeriod?.active, currentPeriod?.assignmentId, currentPeriod?.periodNumber]);

  // Only one of the two modes is active at a time. Picking a mode fills
  // every row with that mode's default status immediately, so attendance
  // is complete for the whole class in one shot. Un-picking the active
  // mode just hides the row controls again without touching what's been
  // marked.
  function handleModeToggle(next: AttendanceMode, checked: boolean) {
    if (!attendanceSession) return;
    if (checked) {
      setMode(next);
      setDraft(
        Object.fromEntries(attendanceSession.entries.map((e) => [e.studentId, defaultFillFor(next)]))
      );
    } else {
      setMode((prev) => (prev === next ? null : prev));
    }
  }

  function handleRowCheck(studentId: string, checked: boolean) {
    const meaning = checkedMeaningFor(mode);
    const opposite: StudentAttendanceMark = meaning === "PRESENT" ? "ABSENT" : "PRESENT";
    setDraft((prev) => ({ ...prev, [studentId]: checked ? meaning : opposite }));
  }

  const markedCount = attendanceSession
    ? attendanceSession.entries.filter((e) => draft[e.studentId] != null).length
    : 0;
  const allMarked =
    !!attendanceSession && attendanceSession.totalStudents > 0 && markedCount === attendanceSession.totalStudents;
  const isReadOnly = attendanceSession?.status === "SUBMITTED";
  const hasClassWorkRecord = classNotes.trim().length > 0;
  const canSubmit = allMarked && hasClassWorkRecord;
  const presentCount = attendanceSession
    ? attendanceSession.entries.filter((e) => draft[e.studentId] === "PRESENT").length
    : 0;

  async function handleSubmit() {
    if (!attendanceSession || !canSubmit) return;
    setIsSubmitting(true);
    try {
      const entries = attendanceSession.entries.map((e) => ({
        studentId: e.studentId,
        status: draft[e.studentId] ?? null,
      }));
      const res = await fetch(`/api/college/student-attendance/${attendanceSession.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries, classNotes, submit: true }),
      });
      const json = (await res.json()) as { session?: StudentAttendanceSession; error?: string };
      if (!res.ok || !json.session) throw new Error(json.error ?? "Failed to submit attendance");
      setAttendanceSession(json.session);
      toast({ variant: "success", title: "Attendance submitted successfully" });
    } catch (err) {
      toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to submit attendance" });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Attendance"
        description="Automatically loads the class you're assigned to teach right now, from the published timetable."
      />

      {isLoadingPeriod ? (
        <div className="h-40 rounded-lg border bg-muted/30 animate-pulse" />
      ) : !currentPeriod?.active ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            <CalendarClock className="mx-auto mb-3 h-8 w-8 text-muted-foreground/60" />
            {justEndedAt
              ? `Attendance period ended at ${formatTime12h(justEndedAt)}.`
              : "No class assigned for the current time."}
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-start justify-between gap-4">
                <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Current Period</p>
                    <p className="mt-1 text-sm font-semibold">
                      {currentPeriod.startTime && currentPeriod.endTime
                        ? `${formatTime12h(currentPeriod.startTime)} – ${formatTime12h(currentPeriod.endTime)}`
                        : "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Subject</p>
                    <p className="mt-1 text-sm font-semibold">{currentPeriod.subjectName || "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Course</p>
                    <p className="mt-1 text-sm font-semibold">{currentPeriod.courseName || "—"}</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Year</p>
                    <p className="mt-1 text-sm font-semibold">
                      {currentPeriod.year != null ? ordinalYear(currentPeriod.year) : "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Section</p>
                    <p className="mt-1 text-sm font-semibold">{currentPeriod.sectionName || "—"}</p>
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void checkCurrentPeriod()}
                  disabled={isLoadingStudents}
                >
                  <RefreshCw className="h-4 w-4" />
                  Refresh
                </Button>
              </div>
            </CardContent>
          </Card>

          {isLoadingStudents && <div className="h-64 rounded-lg border bg-muted/30 animate-pulse" />}

          {!isLoadingStudents && loadError && (
            <Card>
              <CardContent className="py-12 text-center text-sm text-muted-foreground">{loadError}</CardContent>
            </Card>
          )}

          {!isLoadingStudents && attendanceSession && (
            <>
              <div className="flex flex-col gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Info className="h-4 w-4 shrink-0" />
                  <span>
                    Total Students: <strong>{attendanceSession.totalStudents}</strong>
                    <span className="mx-2 text-blue-300">|</span>
                    Present: <strong>{presentCount}</strong>
                    <span className="mx-2 text-blue-300">|</span>
                    Absent: <strong>{markedCount - presentCount}</strong>
                  </span>
                </div>
                {isReadOnly ? (
                  <span className="flex items-center gap-1.5 font-medium text-emerald-700">
                    <Lock className="h-4 w-4" /> Submitted (Read-only)
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 font-medium text-blue-700">
                    <Pencil className="h-4 w-4" /> Not Submitted
                  </span>
                )}
              </div>

              {attendanceSession.totalStudents === 0 ? (
                <Card>
                  <CardContent className="py-12 text-center text-sm text-muted-foreground">
                    No students found in this section yet. Once your HOD/College Office adds or imports
                    students for this section, come back and load again.
                  </CardContent>
                </Card>
              ) : (
                <Card className="overflow-hidden">
                  {!isReadOnly && (
                    <div className="flex flex-wrap items-center justify-end gap-6 border-b px-4 py-3">
                      <label className="flex items-center gap-2 text-sm font-medium">
                        <Switch
                          checked={mode === "ALL_PRESENT"}
                          onCheckedChange={(c) => handleModeToggle("ALL_PRESENT", c)}
                          aria-label="Mark all present"
                        />
                        Mark All Present
                      </label>
                      <label className="flex items-center gap-2 text-sm font-medium">
                        <Switch
                          checked={mode === "ALL_ABSENT"}
                          onCheckedChange={(c) => handleModeToggle("ALL_ABSENT", c)}
                          aria-label="Mark all absent"
                        />
                        Mark All Absent
                      </label>
                    </div>
                  )}
                  {!isReadOnly && !mode && (
                    <p className="border-b bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
                      Pick one option above to mark the whole class — the roster controls unlock once you do.
                    </p>
                  )}
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        <tr>
                          <th className="px-4 py-3">S.No</th>
                          <th className="px-4 py-3">Reg No.</th>
                          <th className="px-4 py-3">Student Name</th>
                          <th className="px-4 py-3 text-center">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {attendanceSession.entries.map((entry, i) => {
                          const value = draft[entry.studentId] ?? null;
                          const meaning = checkedMeaningFor(mode);
                          return (
                            <tr key={entry.studentId}>
                              <td className="px-4 py-2.5 text-muted-foreground">{i + 1}</td>
                              <td className="px-4 py-2.5">{entry.rollNumber}</td>
                              <td className="px-4 py-2.5 font-medium text-foreground">{entry.name}</td>
                              <td className="px-4 py-2.5 text-center">
                                <Switch
                                  checked={value === meaning}
                                  disabled={isReadOnly || !mode}
                                  onCheckedChange={(c) => handleRowCheck(entry.studentId, c)}
                                  aria-label={`Mark ${entry.name} ${meaning === "PRESENT" ? "present" : "absent"}`}
                                />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </Card>
              )}

              {attendanceSession.totalStudents > 0 && (
                <Card className="overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        <tr>
                          <th className="px-4 py-3">Date</th>
                          <th className="px-4 py-3">Period Number</th>
                          <th className="px-4 py-3">Record of the Class Work</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="border-t">
                          <td className="px-4 py-3 align-top font-medium">{formatDateDDMMYYYY(attendanceSession.date)}</td>
                          <td className="px-4 py-3 align-top font-medium">
                            {attendanceSession.periodNumber ?? currentPeriod.periodNumber ?? "—"}
                          </td>
                          <td className="px-4 py-3">
                            <Label htmlFor="classNotes" className="sr-only">Record of the Class Work</Label>
                            <Textarea
                              id="classNotes"
                              placeholder="What was taught/done in this period? (required)"
                              value={classNotes}
                              onChange={(e) => setClassNotes(e.target.value)}
                              disabled={isReadOnly}
                              rows={3}
                              required
                              aria-required="true"
                            />
                            {!isReadOnly && !hasClassWorkRecord && (
                              <p className="mt-1 text-xs text-muted-foreground">
                                Required — Submit Attendance stays disabled until this is filled in.
                              </p>
                            )}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  <CardContent className="space-y-4 py-5">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="text-sm text-muted-foreground">
                        <p>
                          {isReadOnly
                            ? "This attendance has been submitted and is locked."
                            : "Please review the attendance before submitting."}
                        </p>
                        <p>Once submitted, attendance cannot be edited or modified.</p>
                      </div>
                      <p className="text-sm font-medium shrink-0">
                        You have marked {markedCount} out of {attendanceSession.totalStudents} students
                      </p>
                      {!isReadOnly && (
                        <Button
                          onClick={() => void handleSubmit()}
                          disabled={!canSubmit || isSubmitting}
                          loading={isSubmitting}
                          className="shrink-0"
                        >
                          <Lock className="h-4 w-4" />
                          Submit Attendance
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
