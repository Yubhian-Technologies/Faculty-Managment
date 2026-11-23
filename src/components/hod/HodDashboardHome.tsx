"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle, ArrowRight, CalendarCheck2, CalendarDays, ClipboardCheck, FileCheck, GraduationCap, Inbox,
  ShieldCheck, UserCheck, UsersRound, BookOpenCheck, Repeat2,
} from "lucide-react";
import { useAuthStore } from "@/store/authStore";
import { useFacultyDisplayNames } from "@/hooks/useFacultyDisplayNames";
import { useNavVisibility } from "@/hooks/useNavVisibility";
import { isPathHidden } from "@/components/layout/navConfig";
import { istDateKey } from "@/lib/attendance/istTime";
import { isLateCheckIn } from "@/lib/attendance/lateStatus";
import { summarizeFacultyToday, type RosterRow } from "@/lib/dashboard/principalSummary";
import { summarize, totalFor } from "@/lib/students/strength/query";
import { deadlineProgress, type DeadlineProgress, type ProgressGroup } from "@/lib/midBank/progress";
import { LEAVE_TYPE_LABELS } from "@/types/leave";
import type { StrengthPayload } from "@/lib/students/strength/types";
import type { ClassCell } from "@/lib/dashboard/hodDashboard";
import type { MidTimetable } from "@/types/midTimetable";
import { cn } from "@/lib/utils";
import {
  Bar, Card, CRIT, fmtPct, getJson, GOOD, hhmm12, initials, Kpi, Legend, Panel, SectionTitle, SHORT, shortDay, Tag, TrendChart, WARN,
} from "@/components/dashboard/DashboardParts";
import {
  ClassesTodayDetail, FacultyTodayDetail, KpiDetailDialog, ShortageDetail, StudentsTodayDetail,
  type AbsenteeRow, type BelowRow, type KpiDetailKey,
} from "@/components/dashboard/KpiDetails";

// HOD home: key numbers -> what is waiting for the HOD -> today (classes, students, faculty, leave) -> this semester
// (trend, shortage, Mid papers, exams, results) -> the HOD's own day. Everything is the HOD's own department tree.
// Each card loads on its own and fails on its own (Retry); a card whose page the HOD can't open is left out.
// Numbers come from GET /api/college/hod/dashboard (today / semester) and the same APIs the linked pages use.

// ── Types of what the server sends ──────────────────────────────────────────

interface TodayData {
  date: string;
  now: string;
  current: { start: string; end: string; next?: boolean } | null;
  classes: {
    periods: number[];
    sections: { id: string; label: string; department: string }[];
    cells: Record<string, ClassCell>;
    due: number; posted: number; running: number; total: number;
    overdue: { section: string; period: number; subject: string; faculty: string; end: string }[];
  };
  students: {
    pct: number | null;
    absentAllDay: number;
    sections: { sectionId: string; label: string; department: string; pct: number | null; absentAllDay: number; students: number }[];
    absentees?: AbsenteeRow[];
  };
  onLeave: { name: string; leaveType: string; halfDay: string | null; covers: { period: number; section: string; substitute: string }[]; uncovered: number;
    uncoveredPeriods?: { period: number; section: string; subject: string; start: string; end: string }[] }[];
  departments: string[];
}
interface SemesterData {
  since: string | null;
  trend: { date: string; pct: number }[];
  shortage: {
    students: number; below: number; critical: number;
    criticalList: { name: string; rollNumber: string; section: string; pct: number }[];
    belowList?: BelowRow[];
    bySubject: { label: string; name: string; below: number }[];
  };
  results: { year: number; label: string; semester: number; examHeld: string; students: number; passed: number; pct: number | null }[];
  computedAt: string;
}
type Roster = (RosterRow & { uid?: string; name?: string; designation?: string })[];
/** India time now as "HH:MM" (every college is IST). */
const istHHMM = () => new Date().toLocaleTimeString("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hour12: false });

interface MyPeriod { periodNumber: number; startTime: string; endTime: string; sectionName: string; subjectName: string; phase: string; sessionStatus: string | null }

// ── Class grid ──────────────────────────────────────────────────────────────

const CELL: Record<ClassCell["status"], { cls: string; mark: string; label: string }> = {
  POSTED: { cls: "bg-emerald-500 text-white", mark: "✓", label: "Posted" },
  NOW: { cls: "bg-blue-600 text-white ring-2 ring-inset ring-blue-300", mark: "●", label: "Running now" },
  OVERDUE: { cls: "bg-red-500 text-white", mark: "!", label: "Not posted" },
  UPCOMING: { cls: "bg-slate-100 text-slate-400 ring-1 ring-inset ring-slate-200", mark: "", label: "Later today" },
};

function ClassGrid({ data, onMore }: { data: TodayData["classes"]; onMore?: () => void }) {
  // With many sections the grid scrolls inside the card (period row and section names stay in view), and the
  // HOD can narrow it to the sections with a period not posted yet.
  const [onlyOverdue, setOnlyOverdue] = useState(false);
  // A posted cell clicked: its absentees are listed under the grid.
  const [picked, setPicked] = useState<string | null>(null);
  if (data.total === 0) return <p className="py-6 text-center text-sm text-muted-foreground">No Classes Scheduled Today</p>;
  const overdueIds = new Set(data.sections.filter((s) => data.periods.some((p) => data.cells[`${s.id}|${p}`]?.status === "OVERDUE")).map((s) => s.id));
  const rows = onlyOverdue ? data.sections.filter((s) => overdueIds.has(s.id)) : data.sections;
  const many = data.sections.length > 5;
  return (
    <>
      {many && (
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>{rows.length} of {data.sections.length} sections</span>
          <div className="inline-flex rounded-lg border bg-muted/40 p-0.5" role="tablist" aria-label="Which sections">
            {([[false, "All Sections"], [true, `Only Not Posted (${overdueIds.size})`]] as const).map(([v, label]) => (
              <button key={label} type="button" role="tab" aria-selected={onlyOverdue === v} onClick={() => setOnlyOverdue(v)}
                className={cn("rounded-md px-2.5 py-1 font-medium", onlyOverdue === v ? "bg-background text-foreground shadow-sm" : "hover:text-foreground")}>{label}</button>
            ))}
          </div>
        </div>
      )}
      {rows.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Every section has posted all its periods so far.</p>
      ) : (
      <div className={cn("overflow-auto", many && "max-h-[340px] rounded-lg")}>
        <table className="w-full border-separate border-spacing-1 text-xs">
          <thead className="sticky top-0 z-10 bg-card">
            <tr>
              <th className="sticky left-0 z-10 bg-card" />
              {data.periods.map((p) => <th key={p} className="py-1 font-medium text-muted-foreground">P{p}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((s) => (
              <tr key={s.id}>
                <th scope="row" className="sticky left-0 z-[1] whitespace-nowrap bg-card pr-2 text-left font-semibold text-foreground/80">
                  {s.label}
                </th>
                {data.periods.map((p) => {
                  const c = data.cells[`${s.id}|${p}`];
                  if (!c) return <td key={p} className="h-7 min-w-10 text-center text-muted-foreground/60">–</td>;
                  const look = CELL[c.status];
                  const covered = c.covered && c.status !== "OVERDUE";
                  // Posted: the head-count, present / marked (below 75% shown amber); click for the absentees.
                  const counted = c.status === "POSTED" && !!c.total;
                  const low = counted && (c.present ?? 0) / c.total! < SHORT / 100;
                  const key = `${s.id}|${p}`;
                  const title = `${s.label} · P${p}${c.start ? ` (${hhmm12(c.start)})` : ""} · ${c.subject} · ${c.faculty} · ${covered ? "Substitute / adjusted · " : ""}${counted ? `${c.present} present of ${c.total} · ${c.total! - c.present!} absent` : look.label}`;
                  if (counted) {
                    return (
                      <td key={p} title={title} className="p-0">
                        <button type="button" onClick={() => setPicked(picked === key ? null : key)}
                          className={cn("h-7 w-full min-w-12 rounded-md px-1 text-center text-[11px] font-semibold tabular-nums",
                            low ? "bg-amber-100 text-amber-900 ring-1 ring-inset ring-amber-300" : "bg-emerald-500 text-white",
                            covered && "ring-2 ring-inset ring-amber-400", picked === key && "outline outline-2 outline-offset-1 outline-primary")}>
                          {c.present}/{c.total}
                        </button>
                      </td>
                    );
                  }
                  return (
                    <td key={p} title={title}
                      className={cn("h-7 min-w-12 rounded-md text-center font-semibold", covered ? "bg-amber-400 text-amber-950" : look.cls)}>
                      {covered ? "⇄" : look.mark}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          {/* Each period's head-count over every section posted so far. */}
          <tfoot className="sticky bottom-0 bg-card">
            <tr>
              <th scope="row" className="sticky left-0 z-[1] bg-card pr-2 pt-1 text-left font-semibold">Total</th>
              {data.periods.map((p) => {
                const cs = data.sections.map((sec) => data.cells[`${sec.id}|${p}`]).filter((c) => c?.status === "POSTED" && c.total);
                const pr = cs.reduce((n, c) => n + (c!.present ?? 0), 0), tot = cs.reduce((n, c) => n + (c!.total ?? 0), 0);
                return <td key={p} className="pt-1 text-center text-[11px] font-semibold tabular-nums text-foreground/80" title={tot ? `${cs.length} section${cs.length === 1 ? "" : "s"} posted` : "Nothing posted yet"}>{tot ? `${pr}/${tot}` : "–"}</td>;
              })}
            </tr>
          </tfoot>
        </table>
      </div>
      )}
      {picked && data.cells[picked]?.total ? (() => {
        const c = data.cells[picked];
        const [sid, p] = picked.split("|");
        const sec = data.sections.find((x) => x.id === sid);
        const absent = c.absent ?? [];
        return (
          <div className="mt-2 rounded-lg border bg-muted/30 p-2.5 text-xs">
            <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold">{sec?.label} · P{p} · {c.subject} · {c.faculty} - {c.present} present of {c.total}, {absent.length} absent</p>
              <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => setPicked(null)}>Close</button>
            </div>
            {absent.length === 0 ? <p className="text-muted-foreground">Everyone was present.</p> : (
              <ul className="grid gap-x-4 gap-y-0.5 sm:grid-cols-2 lg:grid-cols-3">
                {absent.map((a) => <li key={a.rollNumber + a.name} className="truncate"><span className="tabular-nums text-muted-foreground">{a.rollNumber}</span> {a.name}</li>)}
              </ul>
            )}
          </div>
        );
      })() : null}
      <Legend items={[
        { color: "#10b981", label: "Posted (present / marked)" }, { color: "#fcd34d", label: `Posted, below ${SHORT}%` }, { color: "#2563eb", label: "Running now ●" },
        { color: "#ef4444", label: "Not posted !" }, { color: "#fbbf24", label: "Substitute / adjusted ⇄" }, { color: "#cbd5e1", label: "Later today" },
      ]} />
      {data.overdue.length > 0 && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-2.5">
          <p className="mb-1.5 text-xs font-semibold text-red-700">Not posted yet</p>
          <ul className="grid gap-1 text-xs sm:grid-cols-2">
            {data.overdue.slice(0, 8).map((o, i) => (
              <li key={i} className="truncate"><span className="font-medium">P{o.period} · {o.section}</span> <span className="text-muted-foreground">{o.subject} · {o.faculty}</span></li>
            ))}
          </ul>
          {data.overdue.length > 8 && (
            <button type="button" onClick={onMore} className="mt-1.5 text-xs font-medium text-red-700 hover:underline">
              and {data.overdue.length - 8} more - see all →
            </button>
          )}
        </div>
      )}
    </>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

export function HodDashboardHome() {
  const user = useAuthStore((s) => s.user);
  const { nameFor } = useFacultyDisplayNames();
  const { hiddenModules, hiddenItems } = useNavVisibility();
  const shown = (href: string) => !user?.role || !isPathHidden(href, user.role, hiddenModules, hiddenItems);
  const today = istDateKey();
  const todayLabel = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" });
  const hour = Number(new Date().toLocaleString("en-IN", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" }));
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  const day = useQuery({ queryKey: ["hdash", "today", today], queryFn: () => getJson<TodayData>("/api/college/hod/dashboard?part=today"), staleTime: 60_000, refetchInterval: 5 * 60_000 });
  const sem = useQuery({ queryKey: ["hdash", "semester"], queryFn: () => getJson<SemesterData>("/api/college/hod/dashboard?part=semester"), staleTime: 10 * 60_000 });
  const strength = useQuery({ queryKey: ["hdash", "strength"], queryFn: () => getJson<StrengthPayload>("/api/college/student-strength"), staleTime: 10 * 60_000, enabled: shown("/hod/students") });
  const roster = useQuery({ queryKey: ["hdash", "roster", today], queryFn: () => getJson<{ roster: Roster }>(`/api/college/attendance/report?date=${today}`).then((d) => d.roster ?? []), staleTime: 2 * 60_000 });
  const leaveQ = useQuery({ queryKey: ["hdash", "leave"], queryFn: () => getJson<{ requests?: unknown[] }>("/api/leave/applications?scope=approvals").then((d) => d.requests?.length ?? 0), staleTime: 60_000, enabled: shown("/hod/leave-approvals") });
  const permQ = useQuery({ queryKey: ["hdash", "perms"], queryFn: () => getJson<{ requests?: unknown[] }>("/api/college/student-permissions?view=inbox&limit=100").then((d) => d.requests?.length ?? 0), staleTime: 60_000, enabled: shown("/hod/student-permissions") });
  const certQ = useQuery({ queryKey: ["hdash", "certs"], queryFn: () => getJson<{ requests?: unknown[] }>("/api/college/certificate-requests?view=inbox").then((d) => d.requests?.length ?? 0), staleTime: 60_000, enabled: shown("/hod/certificate-requests") });
  const coverQ = useQuery({ queryKey: ["hdash", "cover"], queryFn: () => getJson<{ items?: unknown[] }>("/api/leave/adjustment-requests").then((d) => d.items?.length ?? 0), staleTime: 60_000 });
  const banks = useQuery({
    queryKey: ["hdash", "banks"],
    enabled: shown("/hod/question-banks"),
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const d = await getJson<{ deadlines?: { id: string; locked: boolean; deadline: string; midNumber?: number; courseName?: string; year?: number }[] }>("/api/college/mid-bank-deadlines");
      const open = (d.deadlines ?? []).filter((x) => !x.locked);
      const progress = await Promise.all(open.map(async (x) => {
        try {
          const p = await getJson<{ groups: ProgressGroup[] }>(`/api/college/mid-bank-deadlines/${encodeURIComponent(x.id)}/progress`);
          return { deadline: x, progress: deadlineProgress(p.groups), groups: p.groups };
        } catch { return null; }
      }));
      return progress.filter((p): p is { deadline: (typeof open)[number]; progress: DeadlineProgress; groups: ProgressGroup[] } => !!p);
    },
  });
  const exams = useQuery({
    queryKey: ["hdash", "exams", today],
    staleTime: 10 * 60_000,
    queryFn: () => getJson<{ timetables?: MidTimetable[] }>("/api/college/mid-timetables/published").then((d) => {
      const seen = new Set<string>();
      const rows: { date: string; subject: string; code: string; year: number; branch: string; time: string; mid: number }[] = [];
      for (const t of d.timetables ?? []) for (const s of t.slots) {
        if (s.date < today) continue;
        const k = `${s.date}|${s.subjectId}`;
        if (seen.has(k)) continue;
        seen.add(k);
        const sess = t.sessions.find((x) => x.id === s.sessionId);
        rows.push({ date: s.date, subject: s.subjectName, code: s.subjectCode, year: t.year, branch: t.branch, time: sess ? `${hhmm12(sess.from)} – ${hhmm12(sess.to)}` : "", mid: t.midNumber });
      }
      return rows.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time)).slice(0, 4);
    }),
  });
  const myDay = useQuery({ queryKey: ["hdash", "mine", today], queryFn: () => getJson<{ periods?: MyPeriod[] }>("/api/college/student-attendance/today-periods").then((d) => d.periods ?? []), staleTime: 2 * 60_000, refetchInterval: 2 * 60_000 });
  // India time now ("HH:MM"), ticking every minute - My Teaching Schedule's Now / Next follows the clock, not the load.
  const [nowHM, setNowHM] = useState(istHHMM);
  useEffect(() => { const t = setInterval(() => setNowHM(istHHMM()), 30_000); return () => clearInterval(t); }, []);

  // Which number card's full list is open.
  const [detail, setDetail] = useState<KpiDetailKey | null>(null);
  const closeDetail = () => setDetail(null);

  // ── Derived ──
  const faculty = useMemo(() => {
    if (!roster.data) return null;
    const rows = roster.data.filter((r) => r.role !== "COLLEGE_STAFF");
    const sum = summarizeFacultyToday(rows);
    const staff = roster.data.length - rows.length;
    const notIn = rows.filter((r) => !["PRESENT", "HALF_DAY", "ON_DUTY", "ON_LEAVE", "ABSENT", "HOLIDAY", "WEEKEND"].includes(r.status));
    const late = rows.filter((r) => r.status === "PRESENT" && isLateCheckIn(r.checkIn, r.permittedCheckInTime, r.lateAfter));
    const me = user ? roster.data.find((r) => r.uid === user.uid) : undefined;
    return { ...sum, staff, notIn, late, me };
  }, [roster.data, user]);

  const students = useMemo(() => {
    const p = strength.data;
    if (!p?.cells) return null;
    const sum = summarize(p.cells, p.meta, "ENROLLED");
    const years = Array.from({ length: p.meta.maxYear || 0 }, (_, i) => i + 1)
      .map((y) => ({ year: y, count: totalFor(p.cells, { status: "ENROLLED", year: y }) }))
      .filter((y) => y.count > 0);
    // One year of study (a 1st-year HOD): its sections instead of a one-item year list.
    const sections = new Set(p.cells.filter((c) => c.count > 0 && c.section && totalFor([c], { status: "ENROLLED" }) > 0).map((c) => `${c.branch}|${c.year}|${c.section}`)).size;
    return { total: sum.total, years, sections };
  }, [strength.data]);

  const banksWaiting = (banks.data ?? []).reduce((n, b) => n + b.progress.banksSubmitted, 0);
  const uncovered = (day.data?.onLeave ?? []).reduce((n, l) => n + l.uncovered, 0);
  const waiting = [
    { key: "leave", show: shown("/hod/leave-approvals"), label: "Pending Leave Approvals", sub: "Awaiting Your Approval", href: "/hod/leave-approvals", count: leaveQ.data, hot: true, icon: CalendarCheck2 },
    { key: "banks", show: shown("/hod/question-banks"), label: "Question Papers to Approve", sub: banks.data?.[0] ? `Mid-${banks.data[0].deadline.midNumber ?? ""} · deadline ${shortDay(banks.data[0].deadline.deadline)}` : "Submitted by your faculty", href: "/hod/question-banks", count: banks.data ? banksWaiting : undefined, hot: true, icon: BookOpenCheck },
    { key: "uncovered", show: true, label: "Periods Without Cover", sub: "Faculty on leave today", href: "/hod/leave-approvals", count: day.data ? uncovered : undefined, hot: true, icon: AlertTriangle },
    { key: "perms", show: shown("/hod/student-permissions"), label: "Student Permissions", sub: "On duty requests", href: "/hod/student-permissions", count: permQ.data, hot: false, icon: ShieldCheck },
    { key: "cover", show: true, label: "Class Substitution Requests", sub: "Requests Requiring Your Action", href: "/leave/adjustments", count: coverQ.data, hot: false, icon: Repeat2 },
    { key: "certs", show: shown("/hod/certificate-requests"), label: "Certificates", sub: "Waiting for your approval", href: "/hod/certificate-requests", count: certQ.data, hot: false, icon: FileCheck },
  ].filter((w) => w.show);
  const waitingTotal = waiting.reduce((n, w) => n + (w.count ?? 0), 0);
  const waitingHot = waiting.filter((w) => w.hot).reduce((n, w) => n + (w.count ?? 0), 0);
  const waitingLoading = waiting.some((w) => w.count === undefined);
  const activeWaiting = waiting.filter((w) => (w.count ?? 0) > 0);

  const cls = day.data?.classes;
  const dueOverdue = cls ? cls.overdue.length : 0;
  const deptLabel = day.data?.departments.length === 1 ? day.data.departments[0] : day.data?.departments.length ? `${day.data.departments.length} departments` : user?.department ?? "";
  const firstBank = banks.data?.[0];
  const myName = user ? nameFor("dashboardName", { uid: user.uid }, user.name) : "HOD";

  return (
    <div className="mx-auto max-w-[1320px] space-y-5 pb-10">
      {/* Banner */}
      <section className="relative overflow-hidden rounded-[20px] bg-gradient-to-r from-[#1c5cab] to-[#2a78d6] px-5 pb-10 pt-6 text-white sm:px-7">
        <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-white/[0.07]" />
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{greeting}, {myName}</h1>
            <p className="mt-1 text-sm text-white/85">{todayLabel}{deptLabel ? ` · ${deptLabel}` : ""}</p>
            <div className="mt-3 flex flex-wrap gap-2 text-xs font-medium">
              <span className="rounded-full border border-white/25 bg-white/15 px-2.5 py-1">HOD</span>
              {exams.data?.[0] && <span className="rounded-full border border-white/25 bg-white/15 px-2.5 py-1">Mid-{exams.data[0].mid} from {shortDay(exams.data[0].date)}</span>}
              {sem.data?.since && <span className="rounded-full border border-white/25 bg-white/15 px-2.5 py-1">Semester Commenced: {new Date(`${sem.data.since}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "long" })}</span>}
            </div>
          </div>
          <div className="min-w-[230px] rounded-xl border border-white/20 bg-white/10 px-4 py-3">
            <p className="text-[11px] font-medium uppercase tracking-wider text-white/75">{day.data?.current?.next ? "Next class" : "Current Academic Status"}</p>
            {day.isLoading ? <div className="mt-1 h-5 w-32 animate-pulse rounded bg-white/20" /> : day.data?.current ? (
              <>
                <p className="mt-0.5 text-[15px] font-semibold">{hhmm12(day.data.current.start)} – {hhmm12(day.data.current.end)}</p>
                <p className="text-xs text-white/85">{cls?.running ?? 0} classes running · {dueOverdue} not posted yet</p>
              </>
            ) : <p className="mt-0.5 text-sm font-medium">No Classes Scheduled for Today</p>}
          </div>
        </div>
      </section>

      {/* Key numbers */}
      <section aria-label="Key numbers" className="relative z-10 -mt-12 grid grid-cols-2 gap-3 px-0 sm:px-2 md:grid-cols-3 xl:grid-cols-6">
        <Kpi icon={GraduationCap} label="Total Student Strength" href="/hod/students" loading={strength.isLoading} error={strength.isError || !shown("/hod/students")}
          value={students ? students.total.toLocaleString("en-IN") : "-"}
          sub={students ? (students.years.length > 1 ? students.years.map((y) => `${["I", "II", "III", "IV", "V"][y.year - 1] ?? y.year} ${y.count}`).join(" · ") : `${students.sections} section${students.sections === 1 ? "" : "s"}`) : undefined} />
        <Kpi icon={ClipboardCheck} label="Today's Student Attendance" onOpen={() => setDetail("students")} loading={day.isLoading} error={day.isError}
          value={day.data?.students.pct == null ? <span className="text-base font-semibold text-muted-foreground">Not yet recorded</span> : day.data.students.pct.toFixed(1)} unit={day.data?.students.pct == null ? undefined : "%"}
          meter={day.data?.students.pct != null ? [{ value: day.data.students.pct, color: day.data.students.pct < SHORT ? CRIT : "hsl(var(--primary))" }] : undefined}
          sub={day.data?.students.pct != null ? `${day.data.students.absentAllDay} absent all day` : undefined} />
        <Kpi icon={CalendarDays} label="Today's Class Status" onOpen={() => setDetail("classes")} loading={day.isLoading} error={day.isError}
          value={cls ? cls.posted : "-"} unit={cls ? ` / ${cls.due} posted` : undefined}
          meter={cls && cls.due ? [{ value: (cls.posted / cls.due) * 100, color: GOOD }, { value: (dueOverdue / cls.due) * 100, color: CRIT }] : undefined}
          sub={cls ? (dueOverdue ? <Tag tone="crit">{dueOverdue} overdue</Tag>
            // "Fully recorded" only once every period that has started is posted; before any is due, say so.
            : cls.due > 0 && cls.posted >= cls.due ? <Tag tone="good">Attendance Fully Recorded</Tag>
            : cls.due === 0 ? <Tag tone="info">None due yet</Tag>
            : <Tag tone="info">{cls.due - cls.posted} in progress</Tag>) : undefined} />
        <Kpi icon={UserCheck} label="Faculty Attendance Status" onOpen={() => setDetail("faculty")} loading={roster.isLoading} error={roster.isError}
          value={faculty ? faculty.present + faculty.halfDay + faculty.onDuty : "-"} unit={faculty ? ` / ${faculty.total}` : undefined}
          meter={faculty && faculty.total ? [
            { value: ((faculty.present - faculty.late.length + faculty.halfDay + faculty.onDuty) / faculty.total) * 100, color: GOOD },
            { value: (faculty.late.length / faculty.total) * 100, color: WARN },
            { value: (faculty.onLeave / faculty.total) * 100, color: "hsl(var(--primary))" },
            { value: ((faculty.notIn.length + faculty.absent) / faculty.total) * 100, color: CRIT },
          ] : undefined}
          sub={faculty ? `${faculty.late.length} late · ${faculty.onLeave} on leave · ${faculty.notIn.length} Not Yet Marked Present` : undefined} />
        <Kpi icon={AlertTriangle} tone="crit" label={`Students Below ${SHORT}% Attendance`} onOpen={() => setDetail("shortage")} loading={sem.isLoading} error={sem.isError}
          value={sem.data ? sem.data.shortage.below : "-"}
          sub={sem.data && sem.data.shortage.students ? <>{((sem.data.shortage.below / sem.data.shortage.students) * 100).toFixed(1)}% of students{sem.data.shortage.critical > 0 && <> · <Tag tone="crit">{sem.data.shortage.critical} below 65%</Tag></>}</> : undefined} />
        <Kpi icon={Inbox} label="Pending Actions" href="#waiting" loading={waitingLoading && waitingTotal === 0} error={false}
          value={waitingTotal} sub={waitingHot ? `${waitingHot} need you today` : "Nothing urgent"} />
      </section>

      {/* The number cards' full lists */}
      <KpiDetailDialog open={detail === "students"} onClose={closeDetail} title="Today's Student Attendance"
        sub={day.data ? `${fmtPct(day.data.students.pct)} so far · ${day.data.students.absentAllDay} absent all day` : undefined}
        pageHref="/hod/attendance-reports" pageLabel="Attendance Reports">
        {day.data && <StudentsTodayDetail sections={day.data.students.sections} absentees={day.data.students.absentees ?? []} />}
      </KpiDetailDialog>
      <KpiDetailDialog open={detail === "classes"} onClose={closeDetail} title="Today's Class Status"
        sub={cls ? `${cls.posted} of ${cls.due} posted · ${dueOverdue} not posted · ${cls.running} running now` : undefined}
        pageHref="/hod/attendance-reports" pageLabel="Attendance Reports">
        {cls && <ClassesTodayDetail sections={cls.sections} cells={cls.cells} />}
      </KpiDetailDialog>
      <KpiDetailDialog open={detail === "faculty"} onClose={closeDetail} title="Faculty Attendance Today"
        sub={faculty ? `${faculty.present + faculty.halfDay + faculty.onDuty} of ${faculty.total} in · ${faculty.late.length} late · ${faculty.onLeave} on leave` : undefined}
        pageHref="/hod/faculty-attendance" pageLabel="Faculty Attendance">
        {roster.data && <FacultyTodayDetail roster={roster.data} />}
      </KpiDetailDialog>
      <KpiDetailDialog open={detail === "shortage"} onClose={closeDetail} title={`Students Below ${SHORT}%`}
        sub={sem.data ? `This semester so far · ${sem.data.shortage.below} of ${sem.data.shortage.students} students` : undefined}
        pageHref="/hod/attendance-reports" pageLabel="Attendance Reports">
        {sem.data && <ShortageDetail list={sem.data.shortage.belowList ?? []} critical={sem.data.shortage.critical} />}
      </KpiDetailDialog>

      {/* Waiting */}
      {/* Nothing waiting: the Pending Actions card already says "0 · Nothing urgent" - no second, empty section. */}
      {!(activeWaiting.length === 0 && !waitingLoading) && (
      <section id="waiting" className="scroll-mt-20 space-y-2.5 rounded-2xl">
        <SectionTitle title="Pending Actions" sub="Select an item to review and take action" />
        {activeWaiting.length === 0 && !waitingLoading ? (
          <Card className="flex items-center gap-3 p-4 text-sm text-muted-foreground"><ShieldCheck className="h-5 w-5 text-emerald-600" />Nothing is waiting for you right now.</Card>
        ) : (
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {(activeWaiting.length ? activeWaiting : waiting).map((w) => (
              <Link key={w.key} href={w.href} className="flex items-center gap-3 rounded-2xl border bg-card p-3.5 shadow-sm transition hover:border-primary">
                <span className={cn("grid h-10 min-w-10 place-items-center rounded-xl px-2 text-base font-bold tabular-nums",
                  w.hot && (w.count ?? 0) > 0 ? "bg-red-50 text-red-600" : "bg-primary/10 text-primary")}>
                  {w.count === undefined ? <span className="h-4 w-4 animate-pulse rounded bg-current/20" /> : w.count}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{w.label}</span>
                  <span className="block truncate text-xs text-muted-foreground">{w.sub}</span>
                </span>
                <ArrowRight className="ml-auto h-4 w-4 shrink-0 text-muted-foreground" />
              </Link>
            ))}
          </div>
        )}
      </section>
      )}

      {/* Today */}
      <section className="space-y-3">
        <SectionTitle title="Today's Academic Overview" sub={day.data ? `Updated: ${hhmm12(day.data.now)}` : undefined} />
        <div className="grid gap-3.5 lg:grid-cols-[2fr_1fr]">
          <Panel id="classes" title="Today's Class Schedule" sub="Section-wise and Period-wise Schedule" href="/hod/attendance-reports" linkLabel="View Attendance Reports"
            loading={day.isLoading} error={day.isError} onRetry={() => void day.refetch()}>
            {cls && <ClassGrid data={cls} onMore={() => setDetail("classes")} />}
          </Panel>
          <Panel id="by-section" title="Section-wise Student Attendance" sub="Today's Attendance – Ascending Order" loading={day.isLoading} error={day.isError} onRetry={() => void day.refetch()}>
            {day.data && (day.data.students.sections.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Attendance Not Yet Recorded</p>
            ) : (
              <>
                <div className="space-y-2">
                  {day.data.students.sections.slice(0, 10).map((s) => (
                    <Bar key={s.sectionId} label={s.label} value={s.pct ?? 0} text={fmtPct(s.pct)} sub={s.absentAllDay ? `${s.absentAllDay} absent` : undefined} low={s.pct != null && s.pct < SHORT} refLine={SHORT} />
                  ))}
                </div>
                {day.data.students.sections.length > 10 && <p className="mt-2 text-xs text-muted-foreground">Lowest 10 of {day.data.students.sections.length} sections.</p>}
                <Legend items={[{ color: "hsl(var(--muted-foreground))", label: "- - 75% line" }, { color: CRIT, label: "Below 75%" }]} />
              </>
            ))}
          </Panel>
        </div>

        <div className="grid gap-3.5 md:grid-cols-2">
          <Panel id="faculty" title="Faculty Attendance Status" sub={faculty ? `Total Faculty: ${faculty.total}${faculty.staff ? ` · ${faculty.staff} supporting staff` : ""}` : undefined}
            href="/hod/faculty-attendance" linkLabel="View Faculty Attendance" loading={roster.isLoading} error={roster.isError} onRetry={() => void roster.refetch()}>
            {faculty && (
              <>
                <div className="flex h-3 gap-0.5 overflow-hidden rounded-full bg-muted">
                  {[
                    { n: faculty.present - faculty.late.length + faculty.halfDay + faculty.onDuty, c: GOOD },
                    { n: faculty.late.length, c: WARN }, { n: faculty.onLeave, c: "hsl(var(--primary))" }, { n: faculty.notIn.length + faculty.absent, c: CRIT },
                  ].filter((s) => s.n > 0).map((s, i) => <i key={i} className="block h-full" style={{ flex: s.n, background: s.c }} />)}
                </div>
                <Legend items={[
                  { color: GOOD, label: `Present: ${faculty.present - faculty.late.length + faculty.halfDay + faculty.onDuty}` },
                  { color: WARN, label: `Late Arrivals: ${faculty.late.length}` },
                  { color: "hsl(var(--primary))", label: `On Approved Leave: ${faculty.onLeave}` },
                  { color: CRIT, label: `Attendance Not Marked: ${faculty.notIn.length + faculty.absent}` },
                ]} />
                <ul className="mt-3 space-y-2">
                  {[...faculty.notIn.map((r) => ({ r, tag: <Tag tone="crit">Not Yet Checked In</Tag>, note: r.designation ?? "" })),
                    ...faculty.late.map((r) => ({ r, tag: <Tag tone="warn">Late</Tag>, note: r.checkIn ? `In at ${hhmm12(r.checkIn)}` : "" }))]
                    .slice(0, 6).map(({ r, tag, note }, i) => (
                      <li key={i} className="flex items-center gap-2.5 text-sm">
                        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/10 text-[11px] font-bold text-primary">{initials(r.name ?? "")}</span>
                        <span className="min-w-0 flex-1 truncate">{r.name}{note && <span className="block text-[11px] text-muted-foreground">{note}</span>}</span>
                        {tag}
                      </li>
                    ))}
                  {faculty.notIn.length + faculty.late.length === 0 && <li className="text-sm text-muted-foreground">Everyone expected today has checked in on time.</li>}
                </ul>
              </>
            )}
          </Panel>
          <Panel title="Faculty on Leave Today" sub="Leave Details & Class Substitution Arrangements" href="/hod/leave-history" linkLabel="View Leave Register"
            loading={day.isLoading} error={day.isError} onRetry={() => void day.refetch()}>
            {day.data && (day.data.onLeave.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No Faculty Members on Leave Today</p>
            ) : (
              <ul className="space-y-2.5">
                {day.data.onLeave.map((l, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-sm">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/10 text-[11px] font-bold text-primary">{initials(l.name)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{l.name}</span>
                      <span className="text-muted-foreground"> · {LEAVE_TYPE_LABELS[l.leaveType as keyof typeof LEAVE_TYPE_LABELS] ?? l.leaveType}{l.halfDay ? ` (${l.halfDay === "FN" ? "Forenoon" : "Afternoon"})` : ""}</span>
                      {l.covers.length > 0 && <span className="block truncate text-[11px] text-muted-foreground">{l.covers.map((c) => `P${c.period} ${c.section} → ${c.substitute}`).join(" · ")}</span>}
                      {(l.uncoveredPeriods?.length ?? 0) > 0 && (
                        <span className="block text-[11px] text-red-700">
                          No substitute: {l.uncoveredPeriods!.map((u) => `P${u.period} ${u.section}${u.subject ? ` (${u.subject})` : ""}`).join(" · ")}
                        </span>
                      )}
                    </span>
                    {l.uncovered > 0 ? <Tag tone="crit">{l.uncovered} without substitute</Tag> : <Tag tone="good">Covered</Tag>}
                  </li>
                ))}
              </ul>
            ))}
          </Panel>
        </div>
      </section>

      {/* This semester */}
      <section className="space-y-3">
        <SectionTitle title="Current Semester Overview" sub={sem.data?.since ? `Semester Commencement: ${new Date(`${sem.data.since}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "long" })} ${sem.data.since.slice(0, 4)}` : undefined} />
        <div className="grid gap-3.5 lg:grid-cols-[2fr_1fr]">
          <Panel title="Semester-wise Student Attendance Trends" sub="Department-wise Average Attendance for Last 14 Working Days" href="/hod/attendance-reports" linkLabel="View Detailed Reports"
            loading={sem.isLoading} error={sem.isError} onRetry={() => void sem.refetch()}>
            {sem.data && <TrendChart points={sem.data.trend} />}
          </Panel>
          <Panel id="shortage" title="Subject-wise Attendance Shortage" sub={`Number of Students Below ${SHORT}% Attendance in Each Subject`} loading={sem.isLoading} error={sem.isError} onRetry={() => void sem.refetch()}>
            {sem.data && (sem.data.shortage.bySubject.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No subject has students below {SHORT}%.</p>
            ) : (
              <div className="space-y-2">
                {sem.data.shortage.bySubject.map((s) => {
                  const max = Math.max(...sem.data!.shortage.bySubject.map((x) => x.below));
                  return <Bar key={s.label + s.name} wide label={s.name || s.label} title={`${s.name}${s.label ? ` (${s.label})` : ""}: ${s.below} students below ${SHORT}%`} value={s.below} max={max} text={`${s.below}`} sub="students" />;
                })}
              </div>
            ))}
            {sem.data && sem.data.shortage.criticalList.length > 0 && (
              <details className="mt-3 rounded-lg border p-2.5 text-xs">
                <summary className="cursor-pointer font-semibold">Below 65% ({sem.data.shortage.critical})</summary>
                <ul className="mt-2 space-y-1">
                  {sem.data.shortage.criticalList.map((c) => (
                    <li key={c.rollNumber + c.section} className="flex justify-between gap-2"><span className="truncate">{c.name} <span className="text-muted-foreground">{c.rollNumber} · {c.section}</span></span><span className="font-semibold text-red-600 tabular-nums">{c.pct.toFixed(1)}%</span></li>
                  ))}
                </ul>
              </details>
            )}
          </Panel>
        </div>

        <div className="grid gap-3.5 md:grid-cols-2 xl:grid-cols-[1.3fr_1fr_1fr]">
          {shown("/hod/question-banks") && (
            <Panel title={firstBank ? `Mid-${firstBank.deadline.midNumber ?? ""} Question Papers` : "Mid Question Papers"}
              sub={firstBank ? `Deadline ${shortDay(firstBank.deadline.deadline)} · ${firstBank.progress.subjects} subjects` : undefined}
              href="/hod/question-banks" linkLabel="View Question Banks" loading={banks.isLoading} error={banks.isError} onRetry={() => void banks.refetch()}>
              {!firstBank ? <p className="py-1 text-sm text-muted-foreground">No Pending Question Paper Submissions</p> : (() => {
                const p = firstBank.progress;
                const approved = p.subjectsApproved;
                const submitted = Math.max(0, p.banksSubmitted);
                const started = Math.max(0, p.subjectsStarted - approved - submitted);
                const notStarted = Math.max(0, p.subjects - p.subjectsStarted);
                const segs = [
                  { n: approved, c: GOOD, l: "Approved" }, { n: submitted, c: "#86b6ef", l: "Submitted" },
                  { n: started, c: "#cde2fb", l: "In progress" }, { n: notStarted, c: "hsl(var(--muted))", l: "Not started" },
                ];
                return (
                  <>
                    <div className="flex h-3.5 gap-0.5 overflow-hidden rounded-full bg-muted">
                      {segs.filter((s) => s.n > 0).map((s) => <i key={s.l} className="block h-full" style={{ flex: s.n, background: s.c }} />)}
                    </div>
                    <Legend items={segs.map((s) => ({ color: s.c, label: `${s.l} ${s.n}` }))} />
                    <div className="mt-4">
                      <div className="mb-1 flex justify-between text-xs"><b className="font-semibold">Sections Ready</b><span className="text-muted-foreground">{p.ready} / {p.sections}</span></div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted"><i className="block h-full rounded-full bg-primary" style={{ width: `${p.sections ? (p.ready / p.sections) * 100 : 0}%` }} /></div>
                    </div>
                  </>
                );
              })()}
            </Panel>
          )}
          <Panel title="Upcoming Examinations" sub="Published Mid-Semester Examination Schedule" href="/panel/mid-timetable" linkLabel="View Timetable" loading={exams.isLoading} error={exams.isError} onRetry={() => void exams.refetch()}>
            {exams.data && (exams.data.length === 0 ? <p className="py-1 text-sm text-muted-foreground">No Mid-Semester Examinations Scheduled</p> : (
              <ul className="divide-y">
                {exams.data.map((e, i) => (
                  <li key={i} className="flex items-center gap-3 py-2 text-sm">
                    <span className="w-12 shrink-0 rounded-lg bg-primary/10 py-1 text-center text-primary">
                      <b className="block text-base leading-tight">{e.date.slice(8, 10)}</b>
                      <span className="text-[10px] font-semibold uppercase">{new Date(`${e.date}T00:00:00`).toLocaleDateString("en-IN", { month: "short" })}</span>
                    </span>
                    <span className="min-w-0"><span className="block truncate font-medium">{e.subject}</span><span className="block text-xs text-muted-foreground">{["I", "II", "III", "IV", "V"][e.year - 1] ?? e.year} Year · {e.branch}{e.time ? ` · ${e.time}` : ""}</span></span>
                  </li>
                ))}
              </ul>
            ))}
          </Panel>
          {shown("/hod/results-analysis") && (
            <Panel title="Recent Examination Results" sub="Regular Examinations · Published Results · Overall Pass Status" href="/hod/results-analysis" linkLabel="View Result Analysis"
              loading={sem.isLoading} error={sem.isError} onRetry={() => void sem.refetch()}>
              {sem.data && (sem.data.results.length === 0 ? <p className="py-1 text-sm text-muted-foreground">No Examination Results Published Yet</p> : (
                <div className="space-y-2">
                  {sem.data.results.map((r) => <Bar key={r.year} label={r.label} value={r.pct ?? 0} text={fmtPct(r.pct)} sub={`${r.passed}/${r.students}`} />)}
                </div>
              ))}
            </Panel>
          )}
        </div>
      </section>

      {/* My day */}
      <section className="space-y-3">
        <SectionTitle title="My Academic Overview" sub="Personal Class Schedule, Attendance and Leave Details" />
        <Card className="grid gap-4 p-4 sm:p-5 lg:grid-cols-[1.2fr_1fr_1fr]">
          <div className="space-y-1.5">
            <p className="text-sm font-semibold">My Teaching Schedule</p>
            {myDay.isLoading ? <div className="h-8 animate-pulse rounded-lg bg-muted" /> : (myDay.data ?? []).length === 0 ? (
              <p className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">No Classes Assigned Today</p>
            ) : (() => {
              const list = myDay.data!;
              const posted = (p: MyPeriod) => p.sessionStatus === "SUBMITTED";
              const running = (p: MyPeriod) => p.startTime <= nowHM && nowHM < p.endTime;
              const ended = (p: MyPeriod) => p.endTime <= nowHM;
              // Highlighted: the class running now, else the next one to start.
              const now = list.find((p) => running(p));
              const next = now ? undefined : list.find((p) => p.startTime > nowHM);
              return list.map((p) => (
                <Link key={`${p.periodNumber}-${p.sectionName}`} href="/panel/mark-attendance"
                  className={cn("flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs", p === now || p === next ? "bg-primary/10 font-semibold text-primary" : "bg-muted/50")}>
                  <span className="truncate">P{p.periodNumber} · {p.sectionName} · {p.subjectName}</span>
                  <span className={cn("shrink-0", !posted(p) && ended(p) && "font-medium text-red-600")}>
                    {posted(p) ? "✓ Posted" : p === now ? `Now · till ${hhmm12(p.endTime)}` : p === next ? `Next · ${hhmm12(p.startTime)}` : ended(p) ? "Not posted" : hhmm12(p.startTime)}
                  </span>
                </Link>
              ));
            })()}
          </div>
          <div className="space-y-1.5">
            <p className="text-sm font-semibold">My Attendance Status</p>
            <Link href="/hod/attendance" className="flex justify-between rounded-lg bg-muted/50 px-3 py-2 text-xs">
              <span>Today&apos;s Attendance</span>
              <span className="font-medium">{faculty?.me?.checkIn ? `Checked in ${hhmm12(faculty.me.checkIn)}` : faculty?.me?.status === "ON_LEAVE" ? "On leave" : "Attendance Not Yet Marked"}</span>
            </Link>
            <Link href="/hod/attendance" className="flex justify-between rounded-lg bg-muted/50 px-3 py-2 text-xs"><span>My Attendance History</span><span>View Details →</span></Link>
          </div>
          <div className="space-y-1.5">
            <p className="text-sm font-semibold">Quick Access</p>
            <Link href="/hod/leave" className="flex justify-between rounded-lg bg-muted/50 px-3 py-2 text-xs"><span>Leave Management</span><span>Apply for Leave / View Balance →</span></Link>
            <Link href="/hod/pipeline" className="flex justify-between rounded-lg bg-muted/50 px-3 py-2 text-xs"><span>Faculty Recruitment</span><span>Recruitment Status →</span></Link>
            <Link href="/hod/faculty" className="flex justify-between rounded-lg bg-muted/50 px-3 py-2 text-xs"><span><UsersRound className="mr-1 inline h-3.5 w-3.5" />Faculty Directory</span><span>View Faculty Directory →</span></Link>
          </div>
        </Card>
      </section>
    </div>
  );
}
