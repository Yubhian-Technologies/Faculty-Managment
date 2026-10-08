"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarClock, Info, Lock, Pencil, RefreshCw, Clock, CloudOff, CloudUpload, Check, X } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/useToast";
import { enqueueSubmission, getQueue, trySyncQueue, type QueuedSubmission } from "@/lib/attendance/offlineSubmitQueue";
import type { StudentAttendanceMark, StudentAttendanceSession } from "@/types";

const PERIOD_POLL_MS = 60_000;
const BOUNDARY_WINDOW_MS = 5 * 60_000;
const WAKE_EARLY_MS = 2 * 60_000;

interface TodayPeriod {
  assignmentId: string;
  periodNumber: number;
  startTime: string;
  endTime: string;
  closeTime?: string;
  unavailableMessage?: string | null;
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
  phase?: "UPCOMING" | "OPEN" | "ENDED";
  labBatch: string | null;
  allocated?: boolean;
}

interface LabAllocationSummary {
  assignmentId: string;
  subjectName: string;
  subjectCode: string;
  courseName: string;
  year: number;
  sectionName: string;
  ranges: { from: string; to: string }[];
}

interface TodayPeriodsResponse {
  date: string;
  periods: TodayPeriod[];
  allocations?: LabAllocationSummary[];
}

export interface TodayPeriodGroup {
  groupId: string;
  periods: TodayPeriod[];
  periodNumbers: number[];
  startTime: string;
  endTime: string;
  closeTime?: string;
  department: string;
  courseId: string;
  courseName: string;
  year: number;
  sectionId: string;
  sectionName: string;
  subjectId: string;
  subjectName: string;
  classroom: string | null;
  isOpen: boolean;
  phase: "UPCOMING" | "OPEN" | "ENDED";
  labBatch: string | null;
  allocated?: boolean;
  unavailableMessage?: string | null;
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
  if (!hhmm) return "time not set";
  const [h, m] = hhmm.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${period}`;
}

function phaseOf(p: TodayPeriod): "UPCOMING" | "OPEN" | "ENDED" {
  return p.phase ?? (p.isOpen ? "OPEN" : "ENDED");
}

function toMinutes(hhmm: string): number {
  if (!hhmm) return Number.MAX_SAFE_INTEGER;
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function istMsSinceMidnight(): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const v = (t: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === t)!.value;
  return (Number(v("hour")) * 3600 + Number(v("minute")) * 60 + Number(v("second"))) * 1000;
}

function hhmmToMs(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h * 3600 + m * 60) * 1000;
}

function boundariesOf(todayPeriods: TodayPeriod[]): number[] {
  return todayPeriods
    .filter((p) => p.startTime)
    .flatMap((p) => [hhmmToMs(p.startTime), hhmmToMs(p.closeTime || p.endTime)]);
}

function nextPollDelayMs(todayPeriods: TodayPeriod[]): number | null {
  const boundaries = boundariesOf(todayPeriods);
  if (boundaries.length === 0) return null;
  const nowMs = istMsSinceMidnight();
  const nearAnyBoundary = boundaries.some((b) => Math.abs(b - nowMs) <= BOUNDARY_WINDOW_MS);
  if (nearAnyBoundary) return PERIOD_POLL_MS;
  const future = boundaries.filter((b) => b > nowMs);
  if (future.length === 0) return null;
  const nextBoundary = Math.min(...future);
  return Math.max(PERIOD_POLL_MS, nextBoundary - nowMs - WAKE_EARLY_MS);
}

// Groups consecutive periods for the same class (same assignmentId, sectionId, labBatch)
export function groupTodayPeriods(periods: TodayPeriod[]): TodayPeriodGroup[] {
  if (!periods || periods.length === 0) return [];

  const sorted = [...periods].sort((a, b) => {
    const timeDiff = toMinutes(a.startTime) - toMinutes(b.startTime);
    if (timeDiff !== 0) return timeDiff;
    return a.periodNumber - b.periodNumber;
  });

  const groups: TodayPeriodGroup[] = [];

  for (const p of sorted) {
    const lastGroup = groups[groups.length - 1];
    const lastPeriod = lastGroup?.periods[lastGroup.periods.length - 1];

    const isContinuous =
      lastPeriod &&
      lastPeriod.assignmentId === p.assignmentId &&
      (lastPeriod.labBatch ?? null) === (p.labBatch ?? null) &&
      lastPeriod.sectionId === p.sectionId &&
      p.periodNumber === lastPeriod.periodNumber + 1;

    if (isContinuous) {
      lastGroup.periods.push(p);
      lastGroup.periodNumbers.push(p.periodNumber);
      lastGroup.endTime = p.endTime;
      lastGroup.closeTime = p.closeTime || p.endTime;
    } else {
      groups.push({
        groupId: `${p.assignmentId}_${p.labBatch || "all"}_p${p.periodNumber}`,
        periods: [p],
        periodNumbers: [p.periodNumber],
        startTime: p.startTime,
        endTime: p.endTime,
        closeTime: p.closeTime || p.endTime,
        department: p.department,
        courseId: p.courseId,
        courseName: p.courseName,
        year: p.year,
        sectionId: p.sectionId,
        sectionName: p.sectionName,
        subjectId: p.subjectId,
        subjectName: p.subjectName,
        classroom: p.classroom,
        isOpen: p.isOpen,
        phase: phaseOf(p),
        labBatch: p.labBatch,
        allocated: p.allocated,
        unavailableMessage: p.unavailableMessage,
      });
    }
  }

  for (const g of groups) {
    g.isOpen = g.periods.some((p: TodayPeriod) => p.isOpen);
    if (g.periods.some((p: TodayPeriod) => phaseOf(p) === "OPEN")) g.phase = "OPEN";
    else if (g.periods.every((p: TodayPeriod) => phaseOf(p) === "ENDED")) g.phase = "ENDED";
    else g.phase = "UPCOMING";
  }

  return groups;
}

type AttendanceMode = "ABSENTEES" | "PRESENTEES";

function checkedMeaningFor(mode: AttendanceMode | null): StudentAttendanceMark {
  return mode === "ABSENTEES" ? "ABSENT" : "PRESENT";
}

function defaultFillFor(mode: AttendanceMode): StudentAttendanceMark {
  return mode === "ABSENTEES" ? "PRESENT" : "ABSENT";
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

function OnDutyTag() {
  return <span title="Approved permission - locked" className="inline-flex items-center rounded-full border border-blue-300 bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-800">On Duty</span>;
}

export default function MarkAttendancePage() {
  const [periods, setPeriods] = useState<TodayPeriod[]>([]);
  const periodsRef = useRef<TodayPeriod[]>([]);
  useEffect(() => { periodsRef.current = periods; }, [periods]);
  const [noClassReason, setNoClassReason] = useState<string | null>(null);
  const [dateStr, setDateStr] = useState<string>(todayStr());
  const [viewDate, setViewDate] = useState<string | null>(null);
  const viewDateRef = useRef<string | null>(null);
  const [allocations, setAllocations] = useState<LabAllocationSummary[]>([]);
  const [isLoadingPeriods, setIsLoadingPeriods] = useState(true);

  // Grouped active period state
  const [expandedGroupId, setExpandedGroupId] = useState<string | null>(null);
  const expandedGroupIdRef = useRef<string | null>(null);
  useEffect(() => { expandedGroupIdRef.current = expandedGroupId; }, [expandedGroupId]);

  const [groupSessions, setGroupSessions] = useState<Record<number, StudentAttendanceSession>>({});
  const [studentRoster, setStudentRoster] = useState<{ studentId: string; name: string; rollNumber: string }[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoadingStudents, setIsLoadingStudents] = useState(false);

  // Draft state: studentId -> periodNumber -> status
  const [draft, setDraft] = useState<Record<string, Record<number, StudentAttendanceMark | null>>>({});
  const [mode, setMode] = useState<AttendanceMode | null>(null);
  const [classNotes, setClassNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

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
        await fetchTodayPeriods();
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

  useEffect(() => {
    const handler = () => void syncPendingSubmissions();
    window.addEventListener("online", handler);
    return () => window.removeEventListener("online", handler);
  }, [syncPendingSubmissions]);

  async function fetchTodayPeriods(): Promise<TodayPeriod[]> {
    try {
      const query = viewDateRef.current ? `?date=${encodeURIComponent(viewDateRef.current)}` : "";
      const res = await fetch(`/api/college/student-attendance/today-periods${query}`);
      if (!res.ok) throw new Error("Failed to load periods");
      const json = (await res.json()) as TodayPeriodsResponse & { noClassReason?: string };
      setNoClassReason(json.noClassReason ?? null);
      const fetched = json.periods ?? [];
      setPeriods(fetched);
      setDateStr(json.date ?? todayStr());
      setAllocations(json.allocations ?? []);
      return fetched;
    } catch {
      setPeriods([]);
      return [];
    } finally {
      setIsLoadingPeriods(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    function scheduleFrom(todayPeriods: TodayPeriod[]) {
      if (cancelled) return;
      if (timeoutId) clearTimeout(timeoutId);
      if (viewDateRef.current) return;
      const delay = nextPollDelayMs(todayPeriods);
      if (delay === null) return;
      timeoutId = setTimeout(() => { void tick(); }, delay);
    }

    async function tick() {
      if (cancelled) return;
      if (document.visibilityState === "visible") {
        scheduleFrom(await fetchTodayPeriods());
      } else {
        scheduleFrom(periodsRef.current);
      }
    }

    void (async () => {
      const fresh = await fetchTodayPeriods();
      await syncPendingSubmissions();
      scheduleFrom(fresh);
    })();

    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      void (async () => { scheduleFrom(await fetchTodayPeriods()); })();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [syncPendingSubmissions]);

  const groups = useMemo(() => groupTodayPeriods(periods), [periods]);

  function overlayQueuedForSession(session: StudentAttendanceSession): Record<string, StudentAttendanceMark | null> {
    const queued = getQueue().find((q: QueuedSubmission) => q.sessionId === session.id);
    if (queued) {
      const result: Record<string, StudentAttendanceMark | null> = {};
      for (const e of session.entries) result[e.studentId] = null;
      for (const e of queued.entries) result[e.studentId] = e.status as StudentAttendanceMark | null;
      return result;
    }
    return Object.fromEntries(session.entries.map((e) => [e.studentId, e.status]));
  }

  async function changeViewDate(next: string | null) {
    const today = todayStr();
    const target = next && next !== today ? next : null;
    if (target && !allocations.some((a) => a.ranges.some((r) => target >= r.from && target <= r.to))) {
      toast({ variant: "destructive", title: "Not allocated", description: "That date is not inside any date range allocated to you." });
      return;
    }
    viewDateRef.current = target;
    setViewDate(target);
    setExpandedGroupId(null);
    setGroupSessions({});
    setIsLoadingPeriods(true);
    await fetchTodayPeriods();
  }

  async function handleOpenGroup(g: TodayPeriodGroup) {
    if (!g.isOpen) return;
    setExpandedGroupId(g.groupId);
    setIsLoadingStudents(true);
    setLoadError(null);

    try {
      const fetchedSessions: Record<number, StudentAttendanceSession> = {};
      let notes = "";

      await Promise.all(
        g.periods.map(async (p: TodayPeriod) => {
          if (p.session && p.session.entries?.length) {
            fetchedSessions[p.periodNumber] = p.session as StudentAttendanceSession;
            if (p.session.classNotes) notes = p.session.classNotes;
            return;
          }
          const res = await fetch("/api/college/student-attendance", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ assignmentId: p.assignmentId, date: dateStr, periodNumber: p.periodNumber }),
          });
          const json = (await res.json()) as { session?: StudentAttendanceSession; error?: string };
          if (res.ok && json.session) {
            fetchedSessions[p.periodNumber] = json.session;
            if (json.session.classNotes) notes = json.session.classNotes;
          }
        })
      );

      if (Object.keys(fetchedSessions).length === 0) {
        setLoadError("Failed to load attendance sessions");
        return;
      }

      setGroupSessions(fetchedSessions);
      setClassNotes(notes);

      const firstSession = Object.values(fetchedSessions)[0];
      const roster = firstSession
        ? firstSession.entries.map((e) => ({ studentId: e.studentId, name: e.name, rollNumber: e.rollNumber }))
        : [];
      setStudentRoster(roster);

      const initialMode: AttendanceMode = "ABSENTEES";
      setMode(initialMode);

      const initialDraft: Record<string, Record<number, StudentAttendanceMark | null>> = {};

      for (const st of roster) {
        initialDraft[st.studentId] = {};
        for (const p of g.periods) {
          const sess = fetchedSessions[p.periodNumber];
          const savedMarks = sess ? overlayQueuedForSession(sess) : {};
          const existing = savedMarks[st.studentId];
          const sessEntry = sess?.entries.find((e) => e.studentId === st.studentId);

          if (sessEntry?.status === "ON_DUTY") {
            initialDraft[st.studentId][p.periodNumber] = "ON_DUTY";
          } else if (existing != null) {
            initialDraft[st.studentId][p.periodNumber] = existing;
          } else {
            initialDraft[st.studentId][p.periodNumber] = defaultFillFor(initialMode);
          }
        }
      }

      setDraft(initialDraft);
    } catch {
      setLoadError("Failed to load students");
    } finally {
      setIsLoadingStudents(false);
    }
  }

  function handleModeToggle(next: AttendanceMode, checked: boolean) {
    const expandedGroup = groups.find((g: TodayPeriodGroup) => g.groupId === expandedGroupId);
    if (!expandedGroup) return;

    if (checked) {
      setMode(next);
      setDraft((prev) => {
        const nextDraft: Record<string, Record<number, StudentAttendanceMark | null>> = {};
        for (const st of studentRoster) {
          nextDraft[st.studentId] = {};
          for (const p of expandedGroup.periods) {
            const sess = groupSessions[p.periodNumber];
            const sessEntry = sess?.entries.find((e) => e.studentId === st.studentId);
            if (sessEntry?.status === "ON_DUTY" || prev[st.studentId]?.[p.periodNumber] === "ON_DUTY") {
              nextDraft[st.studentId][p.periodNumber] = "ON_DUTY";
            } else {
              nextDraft[st.studentId][p.periodNumber] = defaultFillFor(next);
            }
          }
        }
        return nextDraft;
      });
    } else {
      setMode((prev) => (prev === next ? null : prev));
    }
  }

  function handleCellToggle(studentId: string, periodNumber: number, checked: boolean) {
    if (!mode) return;
    const meaning = checkedMeaningFor(mode);
    const opposite: StudentAttendanceMark = meaning === "PRESENT" ? "ABSENT" : "PRESENT";

    setDraft((prev) => {
      const studentMarks = prev[studentId] ? { ...prev[studentId] } : {};
      if (studentMarks[periodNumber] === "ON_DUTY") return prev;
      studentMarks[periodNumber] = checked ? meaning : opposite;
      return { ...prev, [studentId]: studentMarks };
    });
  }

  function handleColumnBulkSet(periodNumber: number, targetStatus: StudentAttendanceMark) {
    setDraft((prev) => {
      const nextDraft = { ...prev };
      for (const st of studentRoster) {
        const currentVal = nextDraft[st.studentId]?.[periodNumber];
        if (currentVal !== "ON_DUTY") {
          nextDraft[st.studentId] = {
            ...(nextDraft[st.studentId] || {}),
            [periodNumber]: targetStatus,
          };
        }
      }
      return nextDraft;
    });
  }

  function handleRowBulkSet(studentId: string, targetStatus: StudentAttendanceMark) {
    const expandedGroup = groups.find((g: TodayPeriodGroup) => g.groupId === expandedGroupId);
    if (!expandedGroup) return;

    setDraft((prev) => {
      const studentMarks = prev[studentId] ? { ...prev[studentId] } : {};
      for (const p of expandedGroup.periods) {
        if (studentMarks[p.periodNumber] !== "ON_DUTY") {
          studentMarks[p.periodNumber] = targetStatus;
        }
      }
      return { ...prev, [studentId]: studentMarks };
    });
  }

  const expandedGroup = useMemo(
    () => groups.find((g: TodayPeriodGroup) => g.groupId === expandedGroupId) ?? null,
    [groups, expandedGroupId]
  );

  const isQueuedPending = useMemo(
    () => expandedGroup?.periods.some((p: TodayPeriod) => queuedIds.has(p.sessionId)) ?? false,
    [expandedGroup, queuedIds]
  );

  const isAllGroupSubmitted = useMemo(
    () => expandedGroup?.periods.every((p: TodayPeriod) => groupSessions[p.periodNumber]?.status === "SUBMITTED" || p.session?.status === "SUBMITTED") ?? false,
    [expandedGroup, groupSessions]
  );

  const isReadOnly = isAllGroupSubmitted || isQueuedPending;
  const isExpandedOpen = expandedGroup?.isOpen ?? false;

  const totalPossibleMarks = (expandedGroup?.periodNumbers.length ?? 0) * studentRoster.length;

  const markedCount = useMemo(() => {
    if (!expandedGroup) return 0;
    let count = 0;
    for (const st of studentRoster) {
      for (const pNum of expandedGroup.periodNumbers) {
        if (draft[st.studentId]?.[pNum] != null) count++;
      }
    }
    return count;
  }, [expandedGroup, studentRoster, draft]);

  const allMarked = totalPossibleMarks > 0 && markedCount === totalPossibleMarks;
  const hasClassWorkRecord = classNotes.trim().length > 0;
  const canSubmit = allMarked && hasClassWorkRecord && isExpandedOpen && !isReadOnly;

  async function handleSubmit() {
    if (!expandedGroup || !canSubmit) return;
    setIsSubmitting(true);

    const isOffline = typeof navigator !== "undefined" && !navigator.onLine;
    const failedPeriods: string[] = [];

    for (const p of expandedGroup.periods) {
      const sess = groupSessions[p.periodNumber];
      if (!sess) continue;

      const entries = studentRoster.map((st) => ({
        studentId: st.studentId,
        status: draft[st.studentId]?.[p.periodNumber] ?? defaultFillFor(mode || "ABSENTEES"),
      }));

      const expectedUpdatedAt = updatedAtIso(sess);

      if (isOffline) {
        enqueueSubmission({
          sessionId: sess.id,
          assignmentId: sess.assignmentId,
          date: sess.date,
          periodNumber: p.periodNumber,
          subjectName: sess.subjectName,
          sectionName: sess.sectionName,
          entries,
          classNotes,
          expectedUpdatedAt,
        });
        setQueuedIds((prev) => new Set(prev).add(sess.id));
      } else {
        try {
          const res = await fetch(`/api/college/student-attendance/${sess.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ entries, classNotes, submit: true, expectedUpdatedAt }),
          });
          if (!res.ok) {
            const json = (await res.json().catch(() => ({}))) as { error?: string };
            failedPeriods.push(`Period ${p.periodNumber}: ${json.error ?? "Failed to submit"}`);
          }
        } catch (err) {
          if (err instanceof TypeError) {
            enqueueSubmission({
              sessionId: sess.id,
              assignmentId: sess.assignmentId,
              date: sess.date,
              periodNumber: p.periodNumber,
              subjectName: sess.subjectName,
              sectionName: sess.sectionName,
              entries,
              classNotes,
              expectedUpdatedAt,
            });
            setQueuedIds((prev) => new Set(prev).add(sess.id));
          } else {
            failedPeriods.push(`Period ${p.periodNumber}: Network error`);
          }
        }
      }
    }

    setIsSubmitting(false);

    if (isOffline) {
      toast({ variant: "success", title: "Saved on this device", description: "No connection - queued to submit automatically when online." });
    } else if (failedPeriods.length === 0) {
      toast({ variant: "success", title: `Attendance submitted for ${expandedGroup.periodNumbers.length} period${expandedGroup.periodNumbers.length > 1 ? "s" : ""}` });
    } else {
      toast({ variant: "destructive", title: "Some periods failed to submit", description: failedPeriods.join(" | ") });
    }

    void fetchTodayPeriods();
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Attendance"
        description="All classes assigned to you today from the published timetable. Continuous lab periods are grouped into single slots with per-period attendance."
      />

      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => void fetchTodayPeriods()} disabled={isLoadingPeriods}>
          <RefreshCw className="h-4 w-4" /> Refresh
        </Button>
        <span className="text-xs text-muted-foreground">Date: {formatDateDDMMYYYY(dateStr)} (IST)</span>
      </div>

      {allocations.length > 0 && (
        <Card className="border-violet-200 bg-violet-50">
          <CardContent className="space-y-3 py-4 text-sm text-violet-950">
            <p className="font-medium">Lab attendance allocated to you</p>
            <ul className="space-y-1 text-xs">
              {allocations.map((a) => (
                <li key={a.assignmentId}>
                  <strong>{a.subjectName}{a.subjectCode ? ` (${a.subjectCode})` : ""}</strong> · {a.courseName} {ordinalYear(a.year)} · Section {a.sectionName}
                  {" - "}
                  {a.ranges.map((r) => (r.from === r.to ? formatDateDDMMYYYY(r.from) : `${formatDateDDMMYYYY(r.from)} to ${formatDateDDMMYYYY(r.to)}`)).join(", ")}
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap items-center gap-2">
              <Label htmlFor="alloc-date" className="text-xs">Mark for date</Label>
              <input
                id="alloc-date"
                type="date"
                className="h-9 rounded-md border bg-background px-2 text-sm"
                value={viewDate ?? ""}
                max={todayStr()}
                onChange={(e) => void changeViewDate(e.target.value || null)}
              />
              {viewDate && (
                <Button size="sm" variant="outline" onClick={() => void changeViewDate(null)}>Back to today</Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {queuedIds.size > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span className="flex items-center gap-1.5">
            <CloudOff className="h-4 w-4 shrink-0" />
            {`${queuedIds.size} attendance record${queuedIds.size === 1 ? "" : "s"} saved on this device — pending sync.`}
          </span>
          <Button size="sm" variant="outline" onClick={() => void syncPendingSubmissions()} loading={isSyncingQueue}>
            <CloudUpload className="h-3.5 w-3.5" /> Sync Now
          </Button>
        </div>
      )}

      {isLoadingPeriods ? (
        <div className="h-40 rounded-lg border bg-muted/30 animate-pulse" />
      ) : groups.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            <CalendarClock className="mx-auto mb-3 h-8 w-8 text-muted-foreground/60" />
            {viewDate ? (noClassReason ? `No classes on this date - ${noClassReason}.` : "No allocated lab period falls on this date.") : noClassReason ? `No classes today - ${noClassReason}.` : "No class assigned for today."}
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          {/* Mobile view */}
          <div className="divide-y sm:hidden">
            {groups.map((g: TodayPeriodGroup) => {
              const isSubmitted = g.periods.every((p: TodayPeriod) => p.session?.status === "SUBMITTED");
              const isPending = g.periods.some((p: TodayPeriod) => queuedIds.has(p.sessionId));
              const periodLabel = g.periodNumbers.length > 1 ? `Periods ${g.periodNumbers.join(", ")}` : `P${g.periodNumbers[0]}`;
              const badge = isPending ? "bg-amber-100 text-amber-800 border-amber-200" : isSubmitted ? "bg-green-100 text-green-800 border-green-200" : g.phase === "OPEN" ? "bg-emerald-100 text-emerald-800 border-emerald-200" : g.phase === "UPCOMING" ? "bg-slate-100 text-slate-700 border-slate-200" : "bg-amber-100 text-amber-800 border-amber-200";
              const isExpanded = expandedGroupId === g.groupId;
              return (
                <div key={g.groupId} className={`p-4 space-y-2 ${isExpanded ? "bg-blue-50/60" : ""}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">{periodLabel} · {formatTime12h(g.startTime)} – {formatTime12h(g.endTime)}</p>
                      <p className="text-muted-foreground">{g.subjectName} ({g.courseName} {ordinalYear(g.year)})</p>
                      <p className="text-muted-foreground">Section {g.sectionName}{g.labBatch ? ` · Batch ${g.labBatch}` : ""}</p>
                    </div>
                    <span className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${badge}`}>
                      {isPending ? "Pending Sync" : isSubmitted || g.phase === "ENDED" ? "Closed" : g.phase === "UPCOMING" ? "Upcoming" : "Open"}
                    </span>
                  </div>
                  {g.isOpen ? (
                    <Button size="sm" variant={isSubmitted || isPending ? "outline" : "default"} className="w-full" onClick={() => void handleOpenGroup(g)}>
                      {isSubmitted || isPending ? "View" : "Mark Attendance"}
                    </Button>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><Clock className="h-3.5 w-3.5" /> {g.unavailableMessage ? "Not available" : g.phase === "UPCOMING" ? `Opens ${formatTime12h(g.startTime)}` : "Time over"}</span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Desktop Table View */}
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Period(s)</th>
                  <th className="px-4 py-3">Time Window</th>
                  <th className="px-4 py-3">Subject</th>
                  <th className="px-4 py-3">Section</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {groups.map((g: TodayPeriodGroup) => {
                  const isSubmitted = g.periods.every((p: TodayPeriod) => p.session?.status === "SUBMITTED");
                  const isPending = g.periods.some((p: TodayPeriod) => queuedIds.has(p.sessionId));
                  const periodLabel = g.periodNumbers.length > 1 ? `Periods ${g.periodNumbers.join(", ")}` : `P${g.periodNumbers[0]}`;
                  const badge = isPending ? "bg-amber-100 text-amber-800 border-amber-200" : isSubmitted ? "bg-green-100 text-green-800 border-green-200" : g.phase === "OPEN" ? "bg-emerald-100 text-emerald-800 border-emerald-200" : g.phase === "UPCOMING" ? "bg-slate-100 text-slate-700 border-slate-200" : "bg-amber-100 text-amber-800 border-amber-200";
                  const isExpanded = expandedGroupId === g.groupId;
                  return (
                    <tr key={g.groupId} className={isExpanded ? "bg-blue-50/60" : ""}>
                      <td className="px-4 py-3 font-medium">{periodLabel}</td>
                      <td className="px-4 py-3 whitespace-nowrap">{formatTime12h(g.startTime)} – {formatTime12h(g.endTime)}</td>
                      <td className="px-4 py-3">{g.subjectName} <span className="text-muted-foreground">({g.courseName} {ordinalYear(g.year)})</span></td>
                      <td className="px-4 py-3">{g.sectionName}{g.labBatch ? ` (${g.labBatch})` : ""}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${badge}`}>
                          {isPending ? "Pending Sync" : isSubmitted || g.phase === "ENDED" ? "Closed" : g.phase === "UPCOMING" ? "Upcoming" : "Open"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {g.isOpen ? (
                          <Button size="sm" variant={isSubmitted || isPending ? "outline" : "default"} onClick={() => void handleOpenGroup(g)}>
                            {isSubmitted || isPending ? "View" : "Mark Attendance"}
                          </Button>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><Clock className="h-3.5 w-3.5" /> {g.unavailableMessage ? "Not available" : g.phase === "UPCOMING" ? `Opens ${formatTime12h(g.startTime)}` : "Time over"}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="bg-amber-50 px-4 py-2 text-xs text-amber-900 border-t">Attendance open only in time. Grouped continuous lab periods share a unified multi-column attendance marking layout.</div>
        </Card>
      )}

      {expandedGroupId && isLoadingStudents && <div className="h-64 rounded-lg border bg-muted/30 animate-pulse" />}

      {expandedGroupId && !isLoadingStudents && loadError && (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">{loadError}</CardContent>
        </Card>
      )}

      {expandedGroupId && !isLoadingStudents && expandedGroup && studentRoster.length > 0 && (
        <>
          {!isExpandedOpen && (
            <Card className="border-amber-200 bg-amber-50">
              <CardContent className="py-4 text-sm text-amber-900">
                This period group is not open now ({formatTime12h(expandedGroup.startTime)} – {formatTime12h(expandedGroup.closeTime ?? expandedGroup.endTime)}). Attendance open only in time — contact Dept Office for office correction.
              </CardContent>
            </Card>
          )}

          {expandedGroup.labBatch && (
            <Card className="border-blue-200 bg-blue-50">
              <CardContent className="py-3 text-sm text-blue-900">
                Split lab period ({expandedGroup.labBatch}) - roster is only this batch, not the whole section.
              </CardContent>
            </Card>
          )}

          <div className="flex flex-col gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <Info className="h-4 w-4 shrink-0" />
              <span>
                Total Students: <strong>{studentRoster.length}</strong>
                <span className="mx-2 text-blue-300">|</span>
                Periods: <strong>{expandedGroup.periodNumbers.join(", ")}</strong>
                <span className="mx-2 text-blue-300">|</span>
                Marks Recorded: <strong>{markedCount}</strong> / {totalPossibleMarks}
              </span>
            </div>
            {isQueuedPending ? (
              <span className="flex items-center gap-1.5 font-medium text-amber-700">
                <CloudOff className="h-4 w-4" /> Saved on this device — pending sync (read-only)
              </span>
            ) : isReadOnly ? (
              <span className="flex items-center gap-1.5 font-medium text-emerald-700">
                <Lock className="h-4 w-4" /> Closed — attendance submitted (Read-only)
              </span>
            ) : isExpandedOpen ? (
              <span className="flex items-center gap-1.5 font-medium text-blue-700">
                <Pencil className="h-4 w-4" /> Open now — mark per period
              </span>
            ) : (
              <span className="flex items-center gap-1.5 font-medium text-amber-700"><Clock className="h-4 w-4" /> Closed — Contact Dept Office</span>
            )}
          </div>

          <Card className="overflow-hidden">
            {!isReadOnly && isExpandedOpen && (
              <div className="flex flex-wrap items-center justify-between gap-4 border-b px-4 py-3">
                <div className="flex flex-wrap items-center gap-6">
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <Switch checked={mode === "ABSENTEES"} onCheckedChange={(c) => handleModeToggle("ABSENTEES", c)} aria-label="Check absentees" />
                    Check Absentees
                  </label>
                  <label className="flex items-center gap-2 text-sm font-medium">
                    <Switch checked={mode === "PRESENTEES"} onCheckedChange={(c) => handleModeToggle("PRESENTEES", c)} aria-label="Check presentees" />
                    Check Presentees
                  </label>
                </div>
              </div>
            )}

            {!isReadOnly && isExpandedOpen && !mode && (
              <p className="border-b bg-muted/30 px-4 py-2 text-xs text-muted-foreground">Pick one option above — the roster controls unlock once you do.</p>
            )}

            {!isReadOnly && isExpandedOpen && mode && (
              <p className="border-b bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
                {mode === "ABSENTEES" ? "Everyone starts Present. Toggle any period cell or row to mark Absent." : "Everyone starts Absent. Toggle any period cell or row to mark Present."}
              </p>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">S.No</th>
                    <th className="px-4 py-3">Reg No.</th>
                    <th className="px-4 py-3">Student Name</th>
                    {expandedGroup.periodNumbers.map((pNum: number) => {
                      const periodObj = expandedGroup.periods.find((p: TodayPeriod) => p.periodNumber === pNum);
                      return (
                        <th key={pNum} className="px-3 py-3 text-center border-l">
                          <div>Period {pNum}</div>
                          {periodObj && <div className="text-[10px] lowercase font-normal text-muted-foreground">{formatTime12h(periodObj.startTime)} - {formatTime12h(periodObj.endTime)}</div>}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {studentRoster.map((st, i) => (
                    <tr key={st.studentId}>
                      <td className="px-4 py-2.5 text-muted-foreground">{i + 1}</td>
                      <td className="px-4 py-2.5 font-mono text-xs">{st.rollNumber}</td>
                      <td className="px-4 py-2.5 font-medium text-foreground">{st.name}</td>
                      {expandedGroup.periodNumbers.map((pNum: number) => {
                        const status = draft[st.studentId]?.[pNum] ?? null;
                        const meaning = checkedMeaningFor(mode);
                        const isChecked = status === meaning;
                        const isOnDuty = status === "ON_DUTY";

                        return (
                          <td key={pNum} className="px-3 py-2.5 text-center border-l whitespace-nowrap">
                            {isOnDuty ? (
                              <OnDutyTag />
                            ) : (
                              <Switch
                                checked={isChecked}
                                disabled={isReadOnly || !isExpandedOpen || !mode}
                                onCheckedChange={(c) => handleCellToggle(st.studentId, pNum, c)}
                                aria-label={`Mark ${st.name} period ${pNum} ${meaning === "PRESENT" ? "present" : "absent"}`}
                              />
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card className="overflow-hidden">
            <div className="p-4 border-b">
              <Label htmlFor="classNotes" className="text-sm font-medium">Record of the Class Work *</Label>
              <Textarea
                id="classNotes"
                placeholder="What was taught/done in this lab/class session? (required)"
                value={classNotes}
                onChange={(e) => setClassNotes(e.target.value)}
                disabled={isReadOnly || !isExpandedOpen}
                rows={3}
                className="mt-2"
                required
              />
            </div>

            <CardContent className="py-4 flex flex-col sm:flex-row items-center justify-end gap-4">
              {!isReadOnly && isExpandedOpen && (
                <Button onClick={() => void handleSubmit()} disabled={!canSubmit || isSubmitting} className="shrink-0">
                  <Lock className="h-4 w-4" /> Submit Attendance ({expandedGroup.periodNumbers.length} Period{expandedGroup.periodNumbers.length > 1 ? "s" : ""})
                </Button>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
