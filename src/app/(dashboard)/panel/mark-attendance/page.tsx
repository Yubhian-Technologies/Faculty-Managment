"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarClock, Info, Lock, Pencil, RefreshCw, Clock, CloudOff, CloudUpload } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/useToast";
import { enqueueSubmission, getQueue, trySyncQueue, type QueuedSubmission } from "@/lib/attendance/offlineSubmitQueue";
import type { StudentAttendanceMark, StudentAttendanceSession } from "@/types";

const PERIOD_POLL_MS = 30_000;

interface TodayPeriod {
  assignmentId: string;
  periodNumber: number;
  startTime: string;
  endTime: string;
  department: string;
  courseId: string;
  courseName: string;
  year: number;
  sectionId: string;
  sectionName: string;
  subjectId: string;
  subjectName: string;
  classroom: string | null;
  sessionId: string;
  session: StudentAttendanceSession | null;
  sessionStatus: string | null;
  isOpen: boolean;
  // Split lab period (see TimetableSlot.labBatch) - roster is only this batch,
  // not the whole section, mirrors student-attendance/route.ts's own gate.
  labBatch: string | null;
}

interface TodayPeriodsResponse {
  date: string;
  periods: TodayPeriod[];
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

function formatDateDDMMYYYY(dateStr: string) {
  const [y, m, d] = dateStr.split("-");
  return `${d}-${m}-${y}`;
}

function ordinalYear(year: number) {
  const suffix = year === 1 ? "st" : year === 2 ? "nd" : year === 3 ? "rd" : "th";
  return `${year}${suffix} Year`;
}

function formatTime12h(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

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

function updatedAtIso(s: StudentAttendanceSession | null): string | undefined {
  const u = (s as unknown as { updatedAt?: unknown })?.updatedAt;
  if (!u) return undefined;
  if (typeof u === "string") return u;
  if (typeof u === "object" && u !== null) {
    const o = u as { _seconds?: number; seconds?: number; toDate?: () => Date; toISOString?: () => string };
    if (typeof o.toDate === "function") return o.toDate().toISOString();
    if (typeof o._seconds === "number") return new Date(o._seconds * 1000).toISOString();
    if (typeof o.seconds === "number") return new Date(o.seconds * 1000).toISOString();
    if (typeof (o as unknown as Date).toISOString === "function") return (o as unknown as Date).toISOString();
  }
  try { return new Date(u as string).toISOString(); } catch { return undefined; }
}

export default function MarkAttendancePage() {
  const [periods, setPeriods] = useState<TodayPeriod[]>([]);
  const [dateStr, setDateStr] = useState<string>(todayStr());
  const [isLoadingPeriods, setIsLoadingPeriods] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Mirrors expandedId for syncPendingSubmissions below, which needs to read
  // the current value without depending on it (its own useCallback is
  // intentionally kept stable across renders - see that comment).
  const expandedIdRef = useRef<string | null>(null);
  useEffect(() => { expandedIdRef.current = expandedId; }, [expandedId]);

  const [attendanceSession, setAttendanceSession] = useState<StudentAttendanceSession | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoadingStudents, setIsLoadingStudents] = useState(false);
  const [draft, setDraft] = useState<Record<string, StudentAttendanceMark | null>>({});
  const [mode, setMode] = useState<AttendanceMode | null>(null);
  const [classNotes, setClassNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Sessions with a submission saved locally, not yet confirmed synced to
  // the server (see lib/attendance/offlineSubmitQueue.ts) - read from
  // localStorage on mount so a page reload while still offline immediately
  // shows what's actually pending, not a stale "not submitted" state.
  const [queuedIds, setQueuedIds] = useState<Set<string>>(() => new Set(getQueue().map((q) => q.sessionId)));
  const [isSyncingQueue, setIsSyncingQueue] = useState(false);

  const syncPendingSubmissions = useCallback(async () => {
    if (getQueue().length === 0) return;
    setIsSyncingQueue(true);
    try {
      const outcomes = await trySyncQueue();
      setQueuedIds(new Set(getQueue().map((q) => q.sessionId)));
      const synced = outcomes.filter((o) => o.result === "synced").length;
      if (synced > 0) {
        toast({ variant: "success", title: `${synced} saved attendance record${synced === 1 ? "" : "s"} submitted` });
        const fresh = await fetchTodayPeriods();
        // If the period that just synced is the one still expanded on
        // screen, its `attendanceSession` copy is otherwise stuck showing
        // the stale pre-sync DRAFT - `isReadOnly` would briefly read false
        // again (queuedIds no longer has it, but attendanceSession.status
        // hasn't caught up), letting the faculty try to re-mark a session
        // that's actually already SUBMITTED. Pull the fresh copy in.
        const currentExpandedId = expandedIdRef.current;
        const match = currentExpandedId ? fresh.find((p) => p.sessionId === currentExpandedId) : null;
        if (match?.session) {
          setAttendanceSession(match.session);
          setDraft(Object.fromEntries(match.session.entries.map((e) => [e.studentId, e.status])));
          setClassNotes(match.session.classNotes ?? "");
        }
      }
      for (const o of outcomes) {
        if (o.result === "conflict") {
          toast({ variant: "destructive", title: "A locally saved submission couldn't sync", description: `${o.error} - contact your Department Office.` });
        } else if (o.result === "rejected") {
          toast({ variant: "destructive", title: "A locally saved submission was rejected", description: o.error });
        }
      }
    } finally {
      setIsSyncingQueue(false);
    }
  }, []);

  // Retry as soon as the browser reports connectivity again, in addition to
  // the mount-time attempt below - covers "opened this page while offline,
  // it comes back while they're still sitting on it" without waiting for a
  // manual refresh.
  useEffect(() => {
    const handler = () => void syncPendingSubmissions();
    window.addEventListener("online", handler);
    return () => window.removeEventListener("online", handler);
  }, [syncPendingSubmissions]);

  async function fetchTodayPeriods(): Promise<TodayPeriod[]> {
    try {
      const res = await fetch("/api/college/student-attendance/today-periods");
      if (!res.ok) throw new Error("Failed to load periods");
      const json = (await res.json()) as TodayPeriodsResponse;
      const fetched = json.periods ?? [];
      setPeriods(fetched);
      setDateStr(json.date ?? todayStr());
      return fetched;
    } catch {
      setPeriods([]);
      return [];
    } finally {
      setIsLoadingPeriods(false);
    }
  }

  // Load the first report without touching state synchronously, then keep the
  // view current with a 30s poll.
  useEffect(() => {
    void (async () => {
      await fetchTodayPeriods();
      // Anything queued from a previous offline session (this device, any
      // time before now) gets one sync attempt as soon as the page opens.
      await syncPendingSubmissions();
    })();
    const id = setInterval(() => {
      void (async () => {
        await fetchTodayPeriods();
      })();
    }, PERIOD_POLL_MS);
    return () => clearInterval(id);
    // syncPendingSubmissions is a stable useCallback (empty deps) - adding
    // it here doesn't cause extra re-runs, just satisfies the linter.
  }, [syncPendingSubmissions]);

  // A queued-but-not-yet-synced submission for this session is what will
  // actually reach the server once connectivity returns - if one exists,
  // that's what re-opening the period should show, not the server's own
  // (necessarily stale, since the sync hasn't landed yet) DRAFT entries.
  function overlayQueued(session: StudentAttendanceSession): { draft: Record<string, StudentAttendanceMark | null>; classNotes: string } {
    const queued = getQueue().find((q: QueuedSubmission) => q.sessionId === session.id);
    if (queued) {
      const draft: Record<string, StudentAttendanceMark | null> = {};
      for (const e of session.entries) draft[e.studentId] = null;
      for (const e of queued.entries) draft[e.studentId] = e.status as StudentAttendanceMark | null;
      return { draft, classNotes: queued.classNotes };
    }
    return { draft: Object.fromEntries(session.entries.map((e) => [e.studentId, e.status])), classNotes: session.classNotes ?? "" };
  }

  async function handleOpenPeriod(p: TodayPeriod) {
    if (!p.isOpen) return;
    // If session already embedded and we have roster, use it; otherwise POST to create/load
    if (p.session && p.session.entries?.length) {
      setExpandedId(p.sessionId);
      setAttendanceSession(p.session as StudentAttendanceSession);
      const { draft, classNotes } = overlayQueued(p.session as StudentAttendanceSession);
      setDraft(draft);
      setClassNotes(classNotes);
      setMode(null);
      setLoadError(null);
      return;
    }
    setExpandedId(p.sessionId);
    setIsLoadingStudents(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/college/student-attendance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignmentId: p.assignmentId, date: dateStr }),
      });
      const json = (await res.json()) as { session?: StudentAttendanceSession; error?: string };
      if (!res.ok || !json.session) {
        setLoadError(json.error ?? "Failed to load students");
        return;
      }
      setAttendanceSession(json.session);
      const { draft, classNotes } = overlayQueued(json.session);
      setDraft(draft);
      setClassNotes(classNotes);
      setMode(null);
      // refresh periods list to reflect newly created DRAFT
      void fetchTodayPeriods();
    } catch {
      setLoadError("Failed to load students");
    } finally {
      setIsLoadingStudents(false);
    }
  }

  function handleModeToggle(next: AttendanceMode, checked: boolean) {
    if (!attendanceSession) return;
    if (checked) {
      setMode(next);
      setDraft(Object.fromEntries(attendanceSession.entries.map((e) => [e.studentId, defaultFillFor(next)])));
    } else {
      setMode((prev) => (prev === next ? null : prev));
    }
  }

  function handleRowCheck(studentId: string, checked: boolean) {
    const meaning = checkedMeaningFor(mode);
    const opposite: StudentAttendanceMark = meaning === "PRESENT" ? "ABSENT" : "PRESENT";
    setDraft((prev) => ({ ...prev, [studentId]: checked ? meaning : opposite }));
  }

  const isQueuedPending = !!attendanceSession && queuedIds.has(attendanceSession.id);
  const markedCount = attendanceSession ? attendanceSession.entries.filter((e) => draft[e.studentId] != null).length : 0;
  const allMarked = !!attendanceSession && (attendanceSession.totalStudents === 0 || markedCount === attendanceSession.totalStudents);
  // A queued-pending submission is treated the same as a real SUBMITTED one
  // - it represents the faculty's finished, locked-in marks, just not
  // confirmed synced yet. Re-opening it and editing further would blur
  // "did I already submit this" in a way the existing "once submitted,
  // cannot be edited" rule is designed to avoid.
  const isReadOnly = attendanceSession?.status === "SUBMITTED" || isQueuedPending;
  const expandedPeriod = periods.find((p) => p.sessionId === expandedId) ?? null;
  const isExpandedOpen = expandedPeriod?.isOpen ?? false;
  const hasClassWorkRecord = classNotes.trim().length > 0;
  const canSubmit = allMarked && hasClassWorkRecord && isExpandedOpen && !isReadOnly;
  const presentCount = attendanceSession ? attendanceSession.entries.filter((e) => draft[e.studentId] === "PRESENT").length : 0;

  async function handleSubmit() {
    if (!attendanceSession || !canSubmit) return;
    setIsSubmitting(true);
    const entries = attendanceSession.entries.map((e) => ({
      studentId: e.studentId,
      status: draft[e.studentId] ?? null,
    }));
    const expectedUpdatedAt = updatedAtIso(attendanceSession);

    function queueLocally() {
      enqueueSubmission({
        sessionId: attendanceSession!.id,
        assignmentId: attendanceSession!.assignmentId,
        date: attendanceSession!.date,
        periodNumber: attendanceSession!.periodNumber ?? expandedPeriod?.periodNumber ?? null,
        subjectName: attendanceSession!.subjectName,
        sectionName: attendanceSession!.sectionName,
        entries,
        classNotes,
        expectedUpdatedAt,
      });
      setQueuedIds((prev) => new Set(prev).add(attendanceSession!.id));
      toast({ variant: "success", title: "Saved on this device", description: "No network right now - this will submit automatically once you're back online." });
    }

    // Already known offline - skip the round-trip/timeout entirely and
    // queue straight away, same outcome as the catch block below but
    // without waiting on a fetch that can only fail.
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      queueLocally();
      setIsSubmitting(false);
      return;
    }

    try {
      const res = await fetch(`/api/college/student-attendance/${attendanceSession.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries, classNotes, submit: true, expectedUpdatedAt }),
      });
      const json = (await res.json()) as { session?: StudentAttendanceSession; error?: string };
      if (res.status === 409) {
        toast({ variant: "destructive", title: json.error ?? "Attendance was updated elsewhere. Please reload." });
        if (json.session) {
          setAttendanceSession(json.session);
          setDraft(Object.fromEntries(json.session.entries.map((e) => [e.studentId, e.status])));
          setClassNotes(json.session.classNotes ?? "");
        } else {
          void fetchTodayPeriods();
        }
        return;
      }
      if (!res.ok || !json.session) throw new Error(json.error ?? "Failed to submit attendance");
      setAttendanceSession(json.session);
      toast({ variant: "success", title: "Attendance submitted successfully" });
      void fetchTodayPeriods();
    } catch (err) {
      // A thrown fetch (network unreachable - TypeError, "Failed to fetch"
      // in Chrome / "NetworkError..." in Firefox) is indistinguishable by
      // shape from the plain Error thrown above for a real server rejection,
      // but only the former actually means "we're offline" - that's the one
      // case worth queuing instead of just failing.
      if (err instanceof TypeError) {
        queueLocally();
      } else {
        toast({ variant: "destructive", title: err instanceof Error ? err.message : "Failed to submit attendance" });
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Attendance"
        description="All classes assigned to you today from the published timetable. Tap an open period to mark attendance. Attendance open only in time — if not posted, contact Dept Office."
      />

      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => void fetchTodayPeriods()} disabled={isLoadingPeriods}>
          <RefreshCw className="h-4 w-4" /> Refresh
        </Button>
        <span className="text-xs text-muted-foreground">Date: {formatDateDDMMYYYY(dateStr)} (IST)</span>
      </div>

      {queuedIds.size > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span className="flex items-center gap-1.5">
            <CloudOff className="h-4 w-4 shrink-0" />
            {`${queuedIds.size} attendance record${queuedIds.size === 1 ? "" : "s"} saved on this device — no network when ${queuedIds.size === 1 ? "it was" : "they were"} submitted. Syncs automatically once you're back online.`}
          </span>
          <Button size="sm" variant="outline" onClick={() => void syncPendingSubmissions()} loading={isSyncingQueue}>
            <CloudUpload className="h-3.5 w-3.5" /> Sync Now
          </Button>
        </div>
      )}

      {isLoadingPeriods ? (
        <div className="h-40 rounded-lg border bg-muted/30 animate-pulse" />
      ) : periods.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            <CalendarClock className="mx-auto mb-3 h-8 w-8 text-muted-foreground/60" />
            No class assigned for today.
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          {/* Card list below sm - a 6-column table forced into a narrow phone
              screen is unreadable even with horizontal scroll; each period
              becomes its own tappable card instead. */}
          <div className="divide-y sm:hidden">
            {periods.map((p) => {
              const s = p.session;
              const isSubmitted = s?.status === "SUBMITTED";
              const isPending = queuedIds.has(p.sessionId);
              const label = isPending ? "Saved on this device — pending sync" : p.isOpen ? (isSubmitted ? "Submitted" : "Open — tap to mark") : s ? (isSubmitted ? "Posted" : "Closed — Contact Dept Office") : "Closed — Contact Dept Office";
              const badge = isPending ? "bg-amber-100 text-amber-800 border-amber-200" : p.isOpen ? "bg-emerald-100 text-emerald-800 border-emerald-200" : isSubmitted ? "bg-green-100 text-green-800 border-green-200" : "bg-amber-100 text-amber-800 border-amber-200";
              const isExpanded = expandedId === p.sessionId;
              return (
                <div key={p.sessionId} className={`p-4 space-y-2 ${isExpanded ? "bg-blue-50/60" : ""}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">P{p.periodNumber} · {formatTime12h(p.startTime)} – {formatTime12h(p.endTime)}</p>
                      <p className="text-muted-foreground">{p.subjectName} ({p.courseName} {ordinalYear(p.year)})</p>
                      <p className="text-muted-foreground">Section {p.sectionName}</p>
                    </div>
                    <span className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${badge}`}>
                      {isPending ? "Pending Sync" : isSubmitted ? "Submitted" : p.isOpen ? "Open" : "Closed"}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">{label}</p>
                  {p.isOpen ? (
                    <Button size="sm" variant={isSubmitted || isPending ? "outline" : "default"} className="w-full" onClick={() => void handleOpenPeriod(p)}>
                      {isSubmitted || isPending ? "View" : isExpanded ? "Opened" : "Mark Attendance"}
                    </Button>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><Clock className="h-3.5 w-3.5" /> Not open</span>
                  )}
                </div>
              );
            })}
          </div>
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Period</th>
                  <th className="px-4 py-3">Time</th>
                  <th className="px-4 py-3">Subject</th>
                  <th className="px-4 py-3">Section</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {periods.map((p) => {
                  const s = p.session;
                  const isSubmitted = s?.status === "SUBMITTED";
                  const isPending = queuedIds.has(p.sessionId);
                  const label = isPending ? "Saved on this device — pending sync" : p.isOpen ? (isSubmitted ? "Submitted" : "Open — tap to mark") : s ? (isSubmitted ? "Posted" : "Closed — Contact Dept Office") : "Closed — Contact Dept Office";
                  const badge = isPending ? "bg-amber-100 text-amber-800 border-amber-200" : p.isOpen ? "bg-emerald-100 text-emerald-800 border-emerald-200" : isSubmitted ? "bg-green-100 text-green-800 border-green-200" : "bg-amber-100 text-amber-800 border-amber-200";
                  const isExpanded = expandedId === p.sessionId;
                  return (
                    <tr key={p.sessionId} className={isExpanded ? "bg-blue-50/60" : ""}>
                      <td className="px-4 py-3 font-medium">P{p.periodNumber}</td>
                      <td className="px-4 py-3 whitespace-nowrap">{formatTime12h(p.startTime)} – {formatTime12h(p.endTime)}</td>
                      <td className="px-4 py-3">{p.subjectName} <span className="text-muted-foreground">({p.courseName} {ordinalYear(p.year)})</span></td>
                      <td className="px-4 py-3">{p.sectionName}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${badge}`}>
                          {isPending ? "Pending Sync" : isSubmitted ? "Submitted" : p.isOpen ? "Open" : "Closed"}
                        </span>
                        <span className="ml-2 text-xs text-muted-foreground">{label}</span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {p.isOpen ? (
                          <Button size="sm" variant={isSubmitted || isPending ? "outline" : "default"} onClick={() => void handleOpenPeriod(p)}>
                            {isSubmitted || isPending ? "View" : isExpanded ? "Opened" : "Mark Attendance"}
                          </Button>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><Clock className="h-3.5 w-3.5" /> Not open</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="bg-amber-50 px-4 py-2 text-xs text-amber-900 border-t">Attendance open only in time. If not posted within the period window, contact Dept Office for office correction.</div>
        </Card>
      )}

      {expandedId && isLoadingStudents && <div className="h-64 rounded-lg border bg-muted/30 animate-pulse" />}

      {expandedId && !isLoadingStudents && loadError && (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">{loadError}</CardContent>
        </Card>
      )}

      {expandedId && !isLoadingStudents && attendanceSession && (
        <>
          {!isExpandedOpen && (
            <Card className="border-amber-200 bg-amber-50">
              <CardContent className="py-4 text-sm text-amber-900">This period is not open now ({expandedPeriod ? `${formatTime12h(expandedPeriod.startTime)} – ${formatTime12h(expandedPeriod.endTime)}` : ""}). Attendance open only in time — if not posted, contact Dept Office for office correction.</CardContent>
            </Card>
          )}
          {expandedPeriod?.labBatch && (
            <Card className="border-blue-200 bg-blue-50">
              <CardContent className="py-3 text-sm text-blue-900">
                Split lab period ({expandedPeriod.labBatch}) - roster is only this batch, not the whole section.
              </CardContent>
            </Card>
          )}
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
            {isQueuedPending ? (
              <span className="flex items-center gap-1.5 font-medium text-amber-700">
                <CloudOff className="h-4 w-4" /> Saved on this device — pending sync (read-only)
              </span>
            ) : isReadOnly ? (
              <span className="flex items-center gap-1.5 font-medium text-emerald-700">
                <Lock className="h-4 w-4" /> Submitted (Read-only)
              </span>
            ) : isExpandedOpen ? (
              <span className="flex items-center gap-1.5 font-medium text-blue-700">
                <Pencil className="h-4 w-4" /> Not Submitted — open now
              </span>
            ) : (
              <span className="flex items-center gap-1.5 font-medium text-amber-700"><Clock className="h-4 w-4" /> Closed — Contact Dept Office</span>
            )}
          </div>

          {attendanceSession.totalStudents === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                No students found in this section yet.
              </CardContent>
            </Card>
          ) : (
            <Card className="overflow-hidden">
              {!isReadOnly && isExpandedOpen && (
                <div className="flex flex-wrap items-center justify-end gap-6 border-b px-4 py-3">
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <Switch checked={mode === "ALL_PRESENT"} onCheckedChange={(c) => handleModeToggle("ALL_PRESENT", c)} aria-label="Mark all present" />
                    Mark All Present
                  </label>
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <Switch checked={mode === "ALL_ABSENT"} onCheckedChange={(c) => handleModeToggle("ALL_ABSENT", c)} aria-label="Mark all absent" />
                    Mark All Absent
                  </label>
                </div>
              )}
              {!isReadOnly && isExpandedOpen && !mode && (
                <p className="border-b bg-muted/30 px-4 py-2 text-xs text-muted-foreground">Pick one option above to mark the whole class — the roster controls unlock once you do.</p>
              )}
              {/* Card list below sm - same roster data, one row per student
                  stacked instead of a cramped 4-column table. */}
              <div className="divide-y sm:hidden">
                {attendanceSession.entries.map((entry, i) => {
                  const value = draft[entry.studentId] ?? null;
                  const meaning = checkedMeaningFor(mode);
                  return (
                    <div key={entry.studentId} className="flex items-center justify-between gap-3 px-4 py-2.5">
                      <div>
                        <p className="font-medium text-foreground">{i + 1}. {entry.name}</p>
                        <p className="text-muted-foreground">Reg No. {entry.rollNumber}</p>
                      </div>
                      <Switch checked={value === meaning} disabled={isReadOnly || !isExpandedOpen || !mode} onCheckedChange={(c) => handleRowCheck(entry.studentId, c)} aria-label={`Mark ${entry.name} ${meaning === "PRESENT" ? "present" : "absent"}`} />
                    </div>
                  );
                })}
              </div>
              <div className="hidden overflow-x-auto sm:block">
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
                            <Switch checked={value === meaning} disabled={isReadOnly || !isExpandedOpen || !mode} onCheckedChange={(c) => handleRowCheck(entry.studentId, c)} aria-label={`Mark ${entry.name} ${meaning === "PRESENT" ? "present" : "absent"}`} />
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
                      <td className="px-4 py-3 align-top font-medium">{attendanceSession.periodNumber ?? expandedPeriod?.periodNumber ?? "—"}</td>
                      <td className="px-4 py-3">
                        <Label htmlFor="classNotes" className="sr-only">Record of the Class Work</Label>
                        <Textarea id="classNotes" placeholder="What was taught/done in this period? (required)" value={classNotes} onChange={(e) => setClassNotes(e.target.value)} disabled={isReadOnly || !isExpandedOpen} rows={3} required aria-required="true" />
                        {!isReadOnly && isExpandedOpen && !hasClassWorkRecord && (
                          <p className="mt-1 text-xs text-muted-foreground">Required — Submit Attendance stays disabled until this is filled in.</p>
                        )}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <CardContent className="space-y-4 py-5">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-sm text-muted-foreground">
                    <p>{isQueuedPending ? "Saved on this device — no network when you hit Submit. Will reach the server automatically once you're back online." : isReadOnly ? "This attendance has been submitted and is locked." : isExpandedOpen ? "Please review the attendance before submitting." : "Period closed — contact Dept Office for correction."}</p>
                    <p>Once submitted, attendance cannot be edited or modified.</p>
                  </div>
                  <p className="text-sm font-medium shrink-0">You have marked {markedCount} out of {attendanceSession.totalStudents} students</p>
                  {!isReadOnly && isExpandedOpen && (
                    <Button onClick={() => void handleSubmit()} disabled={!canSubmit || isSubmitting} className="shrink-0">
                      <Lock className="h-4 w-4" /> Submit Attendance
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
