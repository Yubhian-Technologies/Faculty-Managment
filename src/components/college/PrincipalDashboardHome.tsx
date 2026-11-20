"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle, ArrowRight, Briefcase, CalendarCheck2, CalendarDays, ClipboardCheck, FileCheck, GraduationCap, Inbox,
  PiggyBank, ShieldAlert, ShieldCheck, UserCheck,
} from "lucide-react";
import { useAuthStore } from "@/store/authStore";
import { useCollegeInfo } from "@/hooks/useCollegeInfo";
import { useFacultyDisplayNames } from "@/hooks/useFacultyDisplayNames";
import { useNavVisibility } from "@/hooks/useNavVisibility";
import { useIncidentUnread } from "@/hooks/useIncidentUnread";
import { usePrincipalPendingHiring } from "@/hooks/usePrincipalPendingHiring";
import { isPathHidden } from "@/components/layout/navConfig";
import { istDateKey } from "@/lib/attendance/istTime";
import { isLateCheckIn } from "@/lib/attendance/lateStatus";
import { summarizeFacultyToday, type RosterRow } from "@/lib/dashboard/principalSummary";
import { summarize, totalFor } from "@/lib/students/strength/query";
import { deadlineProgress, type DeadlineProgress, type ProgressGroup } from "@/lib/midBank/progress";
import { LEAVE_TYPE_LABELS } from "@/types/leave";
import type { StrengthPayload } from "@/lib/students/strength/types";
import type { MidTimetable } from "@/types/midTimetable";
import { cn } from "@/lib/utils";
import {
  Bar, Card, CRIT, fmtPct, getJson, GOOD, hhmm12, initials, Kpi, Legend, Panel, SectionTitle, SHORT, shortDay, Tag, TrendChart, WARN,
} from "@/components/dashboard/DashboardParts";
import {
  ClassesTodayDetail, FacultyTodayDetail, KpiDetailDialog, ShortageDetail, StudentsTodayDetail,
  type AbsenteeRow, type BelowRow, type KpiDetailKey, type SectionTodayRow,
} from "@/components/dashboard/KpiDetails";
import type { ClassCell } from "@/lib/dashboard/hodDashboard";

// Shared home dashboard for /principal and /vice-principal (and the College Admin, who signs in as Principal):
// the whole college, with departments where the HOD dashboard has sections. Key numbers -> what is waiting for you
// -> today (departments board, not posted yet, on leave) -> this semester (trend, shortage by department, Mid papers,
// exams, results, strength, faculty attendance this month). Each card loads and fails on its own (Retry); cards
// whose page is hidden by Nav Visibility are left out. Figures: GET /api/college/principal/dashboard (same counting
// as the HOD dashboard and the reports) and the same APIs the linked pages use.

interface TodayData {
  now: string;
  current: { start: string; end: string; next?: boolean } | null;
  classes: {
    due: number; posted: number; running: number; total: number;
    sections?: { id: string; label: string; department: string }[];
    cells?: Record<string, ClassCell>;
    overdue: { section: string; sectionDepartment: string; period: number; subject: string; faculty: string; facultyId: string; facultyDepartment: string; end: string }[];
  };
  students: { pct: number | null; absentAllDay: number; sections?: SectionTodayRow[]; absentees?: AbsenteeRow[] };
  onLeave: { name: string; department: string; isHod: boolean; handoverTo: string | null; leaveType: string; halfDay: string | null; covers: { period: number; section: string; substitute: string }[]; uncovered: number }[];
  departments: string[];
  departmentCodes: Record<string, string>;
  byDepartment: { department: string; total: number; due: number; posted: number; overdue: number; counted: number; present: number; absentAllDay: number; pct: number | null }[];
}
interface SemesterData {
  since: string | null;
  trend: { date: string; pct: number }[];
  shortage: { students: number; below: number; critical: number; belowList?: BelowRow[]; byDepartment: { department: string; students: number; below: number; pct: number | null }[] };
  results: { year: number; label: string; students: number; passed: number; pct: number | null }[];
}
interface FacultyMonth { month: string; departments: { department: string; present: number; marked: number; pct: number | null }[] }
type Roster = (RosterRow & { uid?: string; name?: string })[];
type Group = ProgressGroup & { branch?: string };

export function PrincipalDashboardHome({ fallbackName }: { fallbackName: string }) {
  const user = useAuthStore((s) => s.user);
  const { nameFor } = useFacultyDisplayNames();
  const { collegeInfo } = useCollegeInfo();
  const { hiddenModules, hiddenItems } = useNavVisibility();
  const shown = (href: string) => !user?.role || !isPathHidden(href, user.role, hiddenModules, hiddenItems);
  const today = istDateKey();
  const todayLabel = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" });
  const hour = Number(new Date().toLocaleString("en-IN", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" }));
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const roleLabel = user?.realRole === "COLLEGE_ADMIN" ? "College Admin" : user?.role === "VICE_PRINCIPAL" ? "Vice Principal" : "Principal";

  const day = useQuery({ queryKey: ["pdash2", "today", today], queryFn: () => getJson<TodayData>("/api/college/principal/dashboard?part=today"), staleTime: 60_000, refetchInterval: 5 * 60_000 });
  const sem = useQuery({ queryKey: ["pdash2", "semester"], queryFn: () => getJson<SemesterData>("/api/college/principal/dashboard?part=semester"), staleTime: 10 * 60_000 });
  const month = useQuery({ queryKey: ["pdash2", "month"], queryFn: () => getJson<FacultyMonth>("/api/college/principal/dashboard?part=facultyMonth"), staleTime: 10 * 60_000, enabled: shown("/principal/attendance-report") });
  const strength = useQuery({ queryKey: ["pdash2", "strength"], queryFn: () => getJson<StrengthPayload>("/api/college/student-strength"), staleTime: 10 * 60_000, enabled: shown("/principal/students") });
  const roster = useQuery({ queryKey: ["pdash2", "roster", today], queryFn: () => getJson<{ roster: Roster }>(`/api/college/attendance/report?date=${today}`).then((d) => d.roster ?? []), staleTime: 2 * 60_000 });

  // Waiting for you - each count from the list its own page shows.
  const leave = useQuery({ queryKey: ["pdash2", "leave"], queryFn: () => getJson<{ requests?: unknown[] }>("/api/leave/applications?scope=approvals").then((d) => d.requests?.length ?? 0), staleTime: 60_000, enabled: shown("/principal/leave-approvals") });
  const certs = useQuery({ queryKey: ["pdash2", "certs"], queryFn: () => getJson<{ requests?: unknown[] }>("/api/college/certificate-requests?view=inbox").then((d) => d.requests?.length ?? 0), staleTime: 60_000, enabled: shown("/certificates") });
  const budget = useQuery({
    queryKey: ["pdash2", "budget"], staleTime: 60_000, enabled: shown("/principal/budget"),
    queryFn: () => getJson<{ requests?: { status?: string; totalAmount?: number; amount?: number }[] }>("/api/college/budget-requests").then((d) => {
      const list = (d.requests ?? []).filter((r) => r.status === "PENDING_PRINCIPAL_VERIFICATION");
      return { count: list.length, amount: list.reduce((n, r) => n + (Number(r.totalAmount ?? r.amount) || 0), 0) };
    }),
  });
  const perms = useQuery({ queryKey: ["pdash2", "perms"], queryFn: () => getJson<{ requests?: unknown[] }>("/api/college/student-permissions?view=inbox&limit=100").then((d) => d.requests?.length ?? 0), staleTime: 60_000, enabled: shown("/principal/student-permissions") });
  const hiring = usePrincipalPendingHiring();
  const incidents = useIncidentUnread();

  const banks = useQuery({
    queryKey: ["pdash2", "banks"], staleTime: 5 * 60_000,
    queryFn: async () => {
      const d = await getJson<{ deadlines?: { id: string; locked: boolean; deadline: string; midNumber?: number }[] }>("/api/college/mid-bank-deadlines");
      const open = (d.deadlines ?? []).filter((x) => !x.locked);
      const all = await Promise.all(open.map(async (x) => {
        try { return { deadline: x, groups: (await getJson<{ groups: Group[] }>(`/api/college/mid-bank-deadlines/${encodeURIComponent(x.id)}/progress`)).groups }; }
        catch { return null; }
      }));
      const ok = all.filter((x): x is { deadline: (typeof open)[number]; groups: Group[] } => !!x);
      if (!ok.length) return null;
      const groups = ok.flatMap((x) => x.groups);
      const byBranch = new Map<string, Group[]>();
      for (const g of groups) if (g.branch) byBranch.set(g.branch, [...(byBranch.get(g.branch) ?? []), g]);
      return {
        deadline: ok.map((x) => x.deadline).sort((a, b) => a.deadline.localeCompare(b.deadline))[0],
        progress: deadlineProgress(groups),
        branches: [...byBranch.entries()].map(([branch, gs]) => {
          const p: DeadlineProgress = deadlineProgress(gs);
          return { branch, pct: p.subjects ? Math.round((p.subjectsApproved / p.subjects) * 100) : 0 };
        }).sort((a, b) => b.pct - a.pct),
      };
    },
  });
  const exams = useQuery({
    queryKey: ["pdash2", "exams", today], staleTime: 10 * 60_000,
    queryFn: () => getJson<{ timetables?: MidTimetable[] }>("/api/college/mid-timetables/published").then((d) => {
      const byDate = new Map<string, { count: number; years: Set<number>; mid: number; subjects: Set<string> }>();
      for (const t of d.timetables ?? []) for (const s of t.slots) {
        if (s.date < today) continue;
        const cur = byDate.get(s.date) ?? { count: 0, years: new Set<number>(), mid: t.midNumber, subjects: new Set<string>() };
        if (!cur.subjects.has(s.subjectId)) { cur.subjects.add(s.subjectId); cur.count += 1; }
        cur.years.add(t.year);
        byDate.set(s.date, cur);
      }
      return [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(0, 4)
        .map(([date, v]) => ({ date, count: v.count, mid: v.mid, years: [...v.years].sort() }));
    }),
  });

  // ── Derived ──
  // Which number card's full list is open.
  const [detail, setDetail] = useState<KpiDetailKey | null>(null);
  const closeDetail = () => setDetail(null);

  const faculty = useMemo(() => {
    if (!roster.data) return null;
    const rows = roster.data.filter((r) => r.role !== "COLLEGE_STAFF");
    const sum = summarizeFacultyToday(rows);
    const late = rows.filter((r) => r.status === "PRESENT" && isLateCheckIn(r.checkIn, r.permittedCheckInTime, r.lateAfter)).length;
    const onLeaveBy = new Map<string, number>();
    for (const r of rows) if (r.status === "ON_LEAVE") onLeaveBy.set(r.department || "", (onLeaveBy.get(r.department || "") ?? 0) + 1);
    return { ...sum, late, onLeaveBy };
  }, [roster.data]);

  const students = useMemo(() => {
    const p = strength.data;
    if (!p?.cells) return null;
    const sum = summarize(p.cells, p.meta, "ENROLLED");
    const years = Array.from({ length: p.meta.maxYear || 0 }, (_, i) => i + 1)
      .map((y) => ({ year: y, count: totalFor(p.cells, { status: "ENROLLED", year: y }) }))
      .filter((y) => y.count > 0);
    return { total: sum.total, years };
  }, [strength.data]);

  const codeOf = (dept: string) => day.data?.departmentCodes?.[dept] || dept.split(/[\s-]+/).filter((w) => /^[A-Za-z]/.test(w) && !/^(and|of|&)$/i.test(w)).map((w) => w[0]).join("").toUpperCase().slice(0, 5);

  // Departments board: today's classes and students (server), faculty present / on leave (roster), shortage (semester).
  const board = useMemo(() => {
    if (!day.data) return [];
    const fac = new Map((faculty?.departments ?? []).map((d) => [d.department, d]));
    const short = new Map((sem.data?.shortage.byDepartment ?? []).map((d) => [d.department, d]));
    const names = new Set([...day.data.byDepartment.map((d) => d.department), ...fac.keys()].filter((n) => n && n !== "Not set"));
    return [...names].map((department) => {
      const t = day.data!.byDepartment.find((d) => d.department === department);
      const f = fac.get(department);
      return {
        department, code: codeOf(department),
        due: t?.due ?? 0, posted: t?.posted ?? 0, overdue: t?.overdue ?? 0, pct: t?.pct ?? null, absentAllDay: t?.absentAllDay ?? 0,
        facultyPresent: f ? `${f.present}/${f.total}` : "-", onLeave: faculty?.onLeaveBy.get(department) ?? 0,
        below: short.get(department)?.pct ?? null,
      };
    }).sort((a, b) => (a.pct ?? 101) - (b.pct ?? 101) || b.overdue - a.overdue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day.data, faculty, sem.data]);

  // Not posted yet, per faculty member.
  const notPosted = useMemo(() => {
    const by = new Map<string, { name: string; department: string; items: string[] }>();
    for (const o of day.data?.classes.overdue ?? []) {
      const k = o.facultyId || o.faculty;
      const cur = by.get(k) ?? { name: o.faculty, department: o.facultyDepartment, items: [] };
      cur.items.push(`P${o.period} · ${o.section} ${o.subject}`);
      by.set(k, cur);
    }
    return [...by.values()].sort((a, b) => b.items.length - a.items.length || a.name.localeCompare(b.name));
  }, [day.data]);

  const waiting = [
    { key: "leave", show: shown("/principal/leave-approvals"), label: "Leave Approvals", sub: "HODs and staff", href: "/principal/leave-approvals", count: leave.data, hot: true, icon: CalendarCheck2 },
    { key: "budget", show: shown("/principal/budget"), label: "Budget Verification", sub: budget.data?.amount ? `₹${budget.data.amount.toLocaleString("en-IN")} across ${budget.data.count} request${budget.data.count === 1 ? "" : "s"}` : "Waiting for your verification", href: "/principal/budget", count: budget.data?.count, hot: true, icon: PiggyBank },
    { key: "certs", show: shown("/certificates"), label: "Certificates", sub: "Waiting for your approval", href: "/certificates", count: certs.data, hot: false, icon: FileCheck },
    { key: "perms", show: shown("/principal/student-permissions"), label: "Student Permissions", sub: "On duty requests", href: "/principal/student-permissions", count: perms.data, hot: false, icon: ShieldCheck },
    { key: "hiring", show: shown("/principal/vacancies"), label: "Hiring", sub: "Vacancy requests to review", href: "/principal/vacancies", count: hiring.loading ? undefined : hiring.pendingCount, hot: false, icon: Briefcase },
    { key: "incidents", show: shown("/principal/incident-record"), label: "Incident Reports", sub: "Unread", href: "/principal/incident-record", count: incidents, hot: true, icon: ShieldAlert },
  ].filter((w) => w.show);
  const waitingTotal = waiting.reduce((n, w) => n + (w.count ?? 0), 0);
  const waitingHot = waiting.filter((w) => w.hot).reduce((n, w) => n + (w.count ?? 0), 0);
  const waitingLoading = waiting.some((w) => w.count === undefined);
  const activeWaiting = waiting.filter((w) => (w.count ?? 0) > 0);

  const cls = day.data?.classes;
  const overdueFaculty = notPosted.length;
  const myName = user ? nameFor("dashboardName", { uid: user.uid }, user.name) : fallbackName;
  const roman = (y: number) => ["I", "II", "III", "IV", "V", "VI"][y - 1] ?? String(y);

  return (
    <div className="mx-auto max-w-[1320px] space-y-5 pb-10">
      {/* Banner */}
      <section className="relative overflow-hidden rounded-[20px] bg-gradient-to-r from-[#1c5cab] to-[#2a78d6] px-5 pb-10 pt-6 text-white sm:px-7">
        <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-white/[0.07]" />
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{greeting}, {myName}</h1>
            <p className="mt-1 text-sm text-white/85">{todayLabel}{collegeInfo?.name ? ` · ${collegeInfo.name}` : ""}</p>
            <div className="mt-3 flex flex-wrap gap-2 text-xs font-medium">
              <span className="rounded-full border border-white/25 bg-white/15 px-2.5 py-1">{roleLabel}</span>
              {day.data && <span className="rounded-full border border-white/25 bg-white/15 px-2.5 py-1">{day.data.departments.length} departments</span>}
              {exams.data?.[0] && <span className="rounded-full border border-white/25 bg-white/15 px-2.5 py-1">Mid-{exams.data[0].mid} from {shortDay(exams.data[0].date)}</span>}
              {sem.data?.since && <span className="rounded-full border border-white/25 bg-white/15 px-2.5 py-1">Semester since {shortDay(sem.data.since)}</span>}
            </div>
          </div>
          <div className="min-w-[230px] rounded-xl border border-white/20 bg-white/10 px-4 py-3">
            <p className="text-[11px] font-medium uppercase tracking-wider text-white/75">{day.data?.current?.next ? "Next class" : "Right now"}</p>
            {day.isLoading ? <div className="mt-1 h-5 w-32 animate-pulse rounded bg-white/20" /> : day.data?.current ? (
              <>
                <p className="mt-0.5 text-[15px] font-semibold">{hhmm12(day.data.current.start)} – {hhmm12(day.data.current.end)}</p>
                <p className="text-xs text-white/85">{cls?.running ?? 0} classes running · {cls?.overdue.length ?? 0} not posted yet</p>
              </>
            ) : <p className="mt-0.5 text-sm font-medium">No more classes today</p>}
          </div>
        </div>
      </section>

      {/* Key numbers */}
      <section aria-label="Key numbers" className="relative z-10 -mt-12 grid grid-cols-2 gap-3 sm:px-2 md:grid-cols-3 xl:grid-cols-6">
        <Kpi icon={GraduationCap} label="Students" href="/principal/students?tab=strength" loading={strength.isLoading} error={strength.isError || !shown("/principal/students")}
          value={students ? students.total.toLocaleString("en-IN") : "-"}
          sub={students?.years.map((y) => `${roman(y.year)} ${y.count.toLocaleString("en-IN")}`).join(" · ")} />
        <Kpi icon={ClipboardCheck} label="Student Attendance Today" onOpen={() => setDetail("students")} loading={day.isLoading} error={day.isError}
          value={day.data?.students.pct == null ? "-" : day.data.students.pct.toFixed(1)} unit={day.data?.students.pct == null ? undefined : "%"}
          meter={day.data?.students.pct != null ? [{ value: day.data.students.pct, color: day.data.students.pct < SHORT ? CRIT : "hsl(var(--primary))" }] : undefined}
          sub={day.data ? `${day.data.students.absentAllDay} absent all day` : undefined} />
        <Kpi icon={CalendarDays} label="Classes Today" onOpen={() => setDetail("classes")} loading={day.isLoading} error={day.isError}
          value={cls ? cls.posted : "-"} unit={cls ? ` / ${cls.due} posted` : undefined}
          meter={cls && cls.due ? [{ value: (cls.posted / cls.due) * 100, color: GOOD }, { value: (cls.overdue.length / cls.due) * 100, color: CRIT }] : undefined}
          sub={cls ? (cls.overdue.length ? <Tag tone="crit">{cls.overdue.length} overdue · {overdueFaculty} faculty</Tag> : <Tag tone="good">All posted</Tag>) : undefined} />
        <Kpi icon={UserCheck} label="Faculty Present" onOpen={() => setDetail("faculty")} loading={roster.isLoading} error={roster.isError}
          value={faculty ? faculty.present + faculty.halfDay + faculty.onDuty : "-"} unit={faculty ? ` / ${faculty.total}` : undefined}
          meter={faculty && faculty.total ? [
            { value: ((faculty.present - faculty.late + faculty.halfDay + faculty.onDuty) / faculty.total) * 100, color: GOOD },
            { value: (faculty.late / faculty.total) * 100, color: WARN },
            { value: (faculty.onLeave / faculty.total) * 100, color: "hsl(var(--primary))" },
            { value: ((faculty.notIn + faculty.absent) / faculty.total) * 100, color: CRIT },
          ] : undefined}
          sub={faculty ? `${faculty.late} late · ${faculty.onLeave} on leave · ${faculty.notIn + faculty.absent} not in` : undefined} />
        <Kpi icon={AlertTriangle} tone="crit" label={`Below ${SHORT}%`} onOpen={() => setDetail("shortage")} loading={sem.isLoading} error={sem.isError}
          value={sem.data ? sem.data.shortage.below.toLocaleString("en-IN") : "-"}
          sub={sem.data && sem.data.shortage.students ? <>{((sem.data.shortage.below / sem.data.shortage.students) * 100).toFixed(1)}% of students{sem.data.shortage.critical > 0 && <> · <Tag tone="crit">{sem.data.shortage.critical} below 65%</Tag></>}</> : undefined} />
        <Kpi icon={Inbox} label="Waiting for You" href="#waiting" loading={waitingLoading && waitingTotal === 0} error={false}
          value={waitingTotal} sub={waitingHot ? `${waitingHot} need you today` : "Nothing urgent"} />
      </section>

      {/* Waiting */}
      {/* The number cards' full lists (whole college, with the department) */}
      <KpiDetailDialog open={detail === "students"} onClose={closeDetail} title="Student Attendance Today"
        sub={day.data ? `${fmtPct(day.data.students.pct)} so far · ${day.data.students.absentAllDay} absent all day` : undefined}
        pageHref="/principal/attendance-reports" pageLabel="Attendance Reports">
        {day.data && <StudentsTodayDetail showDepartment sections={day.data.students.sections ?? []} absentees={day.data.students.absentees ?? []} />}
      </KpiDetailDialog>
      <KpiDetailDialog open={detail === "classes"} onClose={closeDetail} title="Classes Today"
        sub={day.data ? `${day.data.classes.posted} of ${day.data.classes.due} posted · ${day.data.classes.overdue.length} not posted · ${day.data.classes.running} running now` : undefined}
        pageHref="/principal/faculty-not-posted" pageLabel="Faculty Not Posted">
        {day.data && <ClassesTodayDetail showDepartment sections={day.data.classes.sections ?? []} cells={day.data.classes.cells ?? {}} />}
      </KpiDetailDialog>
      <KpiDetailDialog open={detail === "faculty"} onClose={closeDetail} title="Faculty Attendance Today"
        sub={faculty ? `${faculty.present + faculty.halfDay + faculty.onDuty} of ${faculty.total} in · ${faculty.late} late · ${faculty.onLeave} on leave` : undefined}
        pageHref="/principal/attendance-report" pageLabel="Faculty Attendance">
        {roster.data && <FacultyTodayDetail showDepartment roster={roster.data} />}
      </KpiDetailDialog>
      <KpiDetailDialog open={detail === "shortage"} onClose={closeDetail} title={`Students Below ${SHORT}%`}
        sub={sem.data ? `This semester so far · ${sem.data.shortage.below} of ${sem.data.shortage.students} students` : undefined}
        pageHref="/principal/attendance-reports" pageLabel="Attendance Reports">
        {sem.data && <ShortageDetail showDepartment list={sem.data.shortage.belowList ?? []} critical={sem.data.shortage.critical} />}
      </KpiDetailDialog>

      <section id="waiting" className="scroll-mt-20 space-y-2.5 rounded-2xl">
        <SectionTitle title="Waiting for You" sub="Each opens its own page" />
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

      {/* Today */}
      <section className="space-y-3">
        <SectionTitle title="Today" sub={day.data ? `Updated ${hhmm12(day.data.now)} · refreshes every 5 minutes` : undefined} />
        <Panel id="departments" title="Departments Today" sub="Lowest student attendance first" href="/principal/attendance-reports" linkLabel="Attendance Reports"
          loading={day.isLoading} error={day.isError} onRetry={() => void day.refetch()}>
          {board.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No classes or attendance today.</p> : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[760px] text-sm">
                  <thead>
                    <tr className="border-b text-left text-[11px] font-medium text-muted-foreground">
                      <th className="px-2.5 py-2 font-medium">Department</th>
                      <th className="px-2.5 py-2 font-medium">Classes Posted</th>
                      <th className="px-2.5 py-2 font-medium">Not Posted</th>
                      <th className="px-2.5 py-2 font-medium">Student Attendance</th>
                      <th className="px-2.5 py-2 font-medium">Faculty Present</th>
                      <th className="px-2.5 py-2 font-medium">On Leave</th>
                      <th className="px-2.5 py-2 font-medium">Below {SHORT}%</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {board.map((d) => (
                      <tr key={d.department} className="hover:bg-muted/40">
                        <td className="px-2.5 py-2">
                          <span className="block font-semibold leading-tight">{d.code}</span>
                          <span className="block max-w-[220px] truncate text-[11px] text-muted-foreground" title={d.department}>{d.department}</span>
                        </td>
                        <td className="px-2.5 py-2">
                          <div className="flex items-center gap-2">
                            <div className="flex h-1.5 min-w-[70px] flex-1 gap-0.5 overflow-hidden rounded-full bg-muted">
                              {d.due > 0 && <i className="block h-full rounded-full" style={{ width: `${(d.posted / d.due) * 100}%`, background: GOOD }} />}
                              {d.due > 0 && d.overdue > 0 && <i className="block h-full rounded-full" style={{ width: `${(d.overdue / d.due) * 100}%`, background: CRIT }} />}
                            </div>
                            <span className="w-14 text-right font-semibold tabular-nums">{d.posted}/{d.due}</span>
                          </div>
                        </td>
                        <td className="px-2.5 py-2">{d.overdue ? <Tag tone="crit">{d.overdue}</Tag> : <Tag tone="good">0</Tag>}</td>
                        <td className="px-2.5 py-2">
                          {d.pct == null ? <span className="text-muted-foreground">Not posted yet</span> : (
                            <div className="flex items-center gap-2">
                              <div className="h-1.5 min-w-[70px] flex-1 overflow-hidden rounded-full bg-muted">
                                <i className="block h-full rounded-full" style={{ width: `${d.pct}%`, background: d.pct < SHORT ? CRIT : "hsl(var(--primary))" }} />
                              </div>
                              <span className="w-14 text-right font-semibold tabular-nums">{fmtPct(d.pct)}</span>
                            </div>
                          )}
                        </td>
                        <td className="px-2.5 py-2 font-semibold tabular-nums">{d.facultyPresent}</td>
                        <td className="px-2.5 py-2 font-semibold tabular-nums">{d.onLeave}</td>
                        <td className={cn("px-2.5 py-2 font-semibold tabular-nums", d.below != null && d.below >= 25 ? "text-red-600" : "")}>{d.below == null ? "-" : `${d.below.toFixed(1)}%`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Legend items={[{ color: GOOD, label: "Posted" }, { color: CRIT, label: `Not posted / below ${SHORT}%` }, { color: "hsl(var(--primary))", label: "Attendance %" }]} />
            </>
          )}
        </Panel>

        <div className="grid gap-3.5 md:grid-cols-2">
          <Panel id="not-posted" title="Not Posted Yet" sub={day.data ? `Periods that have ended without attendance · ${overdueFaculty} faculty` : undefined}
            href="/principal/faculty-not-posted" linkLabel="Faculty Not Posted" loading={day.isLoading} error={day.isError} onRetry={() => void day.refetch()}>
            {notPosted.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">Every period that has ended is posted.</p> : (
              <>
                <ul className="space-y-2.5">
                  {notPosted.slice(0, 6).map((n, i) => (
                    <li key={i} className="flex items-start gap-2.5 text-sm">
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/10 text-[11px] font-bold text-primary">{initials(n.name)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="font-medium">{n.name}</span>{n.department && <span className="text-muted-foreground"> · {codeOf(n.department)}</span>}
                        <span className="block truncate text-[11px] text-muted-foreground">{n.items.join(" · ")}</span>
                      </span>
                      <Tag tone="crit">{n.items.length} period{n.items.length === 1 ? "" : "s"}</Tag>
                    </li>
                  ))}
                </ul>
                {notPosted.length > 6 && <p className="mt-2 text-xs text-muted-foreground">and {notPosted.length - 6} more faculty</p>}
              </>
            )}
          </Panel>
          <Panel title="On Leave Today" sub={day.data ? `${day.data.onLeave.length} faculty · HODs and uncovered classes first` : undefined}
            href="/principal/leave-approvals" linkLabel="Leave" loading={day.isLoading} error={day.isError} onRetry={() => void day.refetch()}>
            {day.data && (day.data.onLeave.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">Nobody is on leave today.</p> : (
              <>
                <ul className="space-y-2.5">
                  {day.data.onLeave.slice(0, 6).map((l, i) => (
                    <li key={i} className="flex items-start gap-2.5 text-sm">
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/10 text-[11px] font-bold text-primary">{initials(l.name)}</span>
                      <span className="min-w-0 flex-1">
                        <span className="font-medium">{l.name}</span>
                        <span className="text-muted-foreground"> · {l.isHod ? "HOD, " : ""}{codeOf(l.department)} · {LEAVE_TYPE_LABELS[l.leaveType as keyof typeof LEAVE_TYPE_LABELS] ?? l.leaveType}{l.halfDay ? ` (${l.halfDay === "FN" ? "Forenoon" : "Afternoon"})` : ""}</span>
                        <span className="block truncate text-[11px] text-muted-foreground">
                          {l.isHod && l.handoverTo ? `HOD duties with ${l.handoverTo}` : l.covers.length ? l.covers.map((c) => `P${c.period} ${c.section} → ${c.substitute}`).join(" · ") : l.uncovered ? "Classes not assigned to anyone" : "No classes today"}
                        </span>
                      </span>
                      {l.uncovered > 0 ? <Tag tone="crit">{l.uncovered} uncovered</Tag> : l.isHod ? <Tag tone="warn">HOD</Tag> : <Tag tone="good">Covered</Tag>}
                    </li>
                  ))}
                </ul>
                {day.data.onLeave.length > 6 && <p className="mt-2 text-xs text-muted-foreground">and {day.data.onLeave.length - 6} more</p>}
              </>
            ))}
          </Panel>
        </div>
      </section>

      {/* This semester */}
      <section className="space-y-3">
        <SectionTitle title="This Semester" sub={sem.data?.since ? `Since ${shortDay(sem.data.since)} · counted the same way as the reports` : "Counted the same way as the reports"} />
        <div className="grid gap-3.5 lg:grid-cols-[2fr_1fr]">
          <Panel title="Student Attendance Trend" sub="College average, last 14 class days" href="/principal/attendance-reports" linkLabel="Reports"
            loading={sem.isLoading} error={sem.isError} onRetry={() => void sem.refetch()}>
            {sem.data && <TrendChart points={sem.data.trend} />}
          </Panel>
          <Panel id="shortage" title="Shortage by Department" sub={`Share of students below ${SHORT}%`} loading={sem.isLoading} error={sem.isError} onRetry={() => void sem.refetch()}>
            {sem.data && (sem.data.shortage.byDepartment.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No attendance this semester yet.</p> : (
              <div className="space-y-2">
                {[...sem.data.shortage.byDepartment].sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0)).slice(0, 10).map((d) => (
                  <Bar key={d.department} label={codeOf(d.department)} title={`${d.department}: ${d.below} of ${d.students} students below ${SHORT}%`}
                    value={d.pct ?? 0} max={Math.max(...sem.data!.shortage.byDepartment.map((x) => x.pct ?? 0), 1)} text={fmtPct(d.pct)} sub={`${d.below} students`} />
                ))}
              </div>
            ))}
          </Panel>
        </div>

        <div className="grid gap-3.5 md:grid-cols-2 xl:grid-cols-3">
          <Panel title={banks.data ? `Mid-${banks.data.deadline.midNumber ?? ""} Question Papers` : "Mid Question Papers"}
            sub={banks.data ? `Deadline ${shortDay(banks.data.deadline.deadline)} · ${banks.data.progress.subjects} subjects` : undefined}
            loading={banks.isLoading} error={banks.isError} onRetry={() => void banks.refetch()}>
            {!banks.data ? <p className="py-6 text-center text-sm text-muted-foreground">No open question paper deadline.</p> : (() => {
              const p = banks.data.progress;
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
                  {banks.data.branches.length > 0 && (
                    <div className="mt-4 space-y-2">
                      <p className="text-xs font-semibold">Approved, by department</p>
                      {banks.data.branches.slice(0, 6).map((b) => <Bar key={b.branch} label={codeOf(b.branch)} title={b.branch} value={b.pct} text={`${b.pct}%`} />)}
                    </div>
                  )}
                </>
              );
            })()}
          </Panel>
          <Panel title="Coming Up" sub="Published Mid timetable" href="/principal/mid-timetable" linkLabel="Mid Timetable" loading={exams.isLoading} error={exams.isError} onRetry={() => void exams.refetch()}>
            {exams.data && (exams.data.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No upcoming Mid exams.</p> : (
              <ul className="divide-y">
                {exams.data.map((e) => (
                  <li key={e.date} className="flex items-center gap-3 py-2 text-sm">
                    <span className="w-12 shrink-0 rounded-lg bg-primary/10 py-1 text-center text-primary">
                      <b className="block text-base leading-tight">{e.date.slice(8, 10)}</b>
                      <span className="text-[10px] font-semibold uppercase">{new Date(`${e.date}T00:00:00`).toLocaleDateString("en-IN", { month: "short" })}</span>
                    </span>
                    <span className="min-w-0"><span className="block font-medium">Mid-{e.mid} · {e.count} exam{e.count === 1 ? "" : "s"}</span><span className="block text-xs text-muted-foreground">{e.years.map(roman).join(", ")} Year</span></span>
                  </li>
                ))}
              </ul>
            ))}
          </Panel>
          {shown("/principal/results-analysis") && (
            <Panel title="Latest Results" sub="Regular · published · all subjects passed" href="/principal/results-analysis" linkLabel="Results Analysis"
              loading={sem.isLoading} error={sem.isError} onRetry={() => void sem.refetch()}>
              {sem.data && (sem.data.results.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No published results yet.</p> : (
                <div className="space-y-2">
                  {sem.data.results.map((r) => <Bar key={r.year} label={r.label} value={r.pct ?? 0} text={fmtPct(r.pct)} sub={`${r.passed}/${r.students}`} />)}
                </div>
              ))}
            </Panel>
          )}
        </div>

        <div className="grid gap-3.5 md:grid-cols-2">
          {shown("/principal/students") && (
            <Panel title="Student Strength" sub="Enrolled, by year of study" href="/principal/students?tab=strength" linkLabel="Students"
              loading={strength.isLoading} error={strength.isError} onRetry={() => void strength.refetch()}>
              {students && (
                <div className="space-y-2">
                  {students.years.map((y) => (
                    <Bar key={y.year} label={`${roman(y.year)} Year`} value={y.count} max={Math.max(...students.years.map((x) => x.count), 1)} text={y.count.toLocaleString("en-IN")} />
                  ))}
                </div>
              )}
            </Panel>
          )}
          {shown("/principal/attendance-report") && (
            <Panel title="Faculty Attendance This Month" sub="Present share of the days marked · lowest first" href="/principal/attendance-report" linkLabel="Attendance"
              loading={month.isLoading} error={month.isError} onRetry={() => void month.refetch()}>
              {month.data && (month.data.departments.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No attendance marked this month yet.</p> : (
                <div className="space-y-2">
                  {month.data.departments.slice(0, 10).map((d) => (
                    <Bar key={d.department} label={codeOf(d.department)} title={`${d.department}: ${d.present} of ${d.marked} days present`} value={d.pct ?? 0} text={fmtPct(d.pct)} />
                  ))}
                </div>
              ))}
            </Panel>
          )}
        </div>
      </section>
    </div>
  );
}
