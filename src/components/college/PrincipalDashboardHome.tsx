"use client";

import { useMemo, type ComponentType, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import {
  AlertTriangle, ArrowRight, BookOpenCheck, Briefcase, CalendarClock, CheckCircle2, ClipboardCheck, FileCheck,
  GraduationCap, Inbox, PiggyBank, RefreshCw, ShieldAlert, ShieldCheck, UsersRound,
} from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/store/authStore";
import { useCollegeInfo } from "@/hooks/useCollegeInfo";
import { useFacultyDisplayNames } from "@/hooks/useFacultyDisplayNames";
import { useNavVisibility } from "@/hooks/useNavVisibility";
import { useIncidentUnread } from "@/hooks/useIncidentUnread";
import { usePrincipalPendingHiring } from "@/hooks/usePrincipalPendingHiring";
import { isPathHidden } from "@/components/layout/navConfig";
import { istDateKey } from "@/lib/attendance/istTime";
import { summarize, totalFor } from "@/lib/students/strength/query";
import { romanYear } from "@/lib/students/strength/config";
import { pctTone, summarizeClassesToday, summarizeFacultyToday, type NotPostedRow, type RosterRow } from "@/lib/dashboard/principalSummary";
import type { StrengthPayload } from "@/lib/students/strength/types";
import { ROLE_LABELS } from "@/types";
import { DashboardDonut, SLICE, YEAR_RAMP } from "./DashboardDonut";
import { cn } from "@/lib/utils";

// Shared home dashboard for /principal and /vice-principal (equal authority, same /principal/* pages).
// One page in bands: key numbers -> what is waiting for you -> today (faculty attendance, classes
// posted). Every card loads on its own (a slow or failed one never holds up the rest) and reads the
// SAME API its full page uses, so a number always matches the page it opens. Cards whose page is
// hidden by Nav Visibility are left out.

const STALE = 2 * 60_000;
const TONE_TEXT = { good: "text-emerald-700 dark:text-emerald-400", watch: "text-amber-700 dark:text-amber-400", bad: "text-red-700 dark:text-red-400", none: "text-muted-foreground" } as const;
// Status steps (the same as the donuts) - always beside a printed percentage, never colour alone.
const TONE_BAR = { good: "bg-[#0ca30c]", watch: "bg-[#fab219]", bad: "bg-[#d03b3b]", none: "bg-muted-foreground/40" } as const;

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(String(res.status));
  return (await res.json()) as T;
}

export function PrincipalDashboardHome({ fallbackName }: { fallbackName: string }) {
  const user = useAuthStore((s) => s.user);
  const { nameFor } = useFacultyDisplayNames();
  const { collegeInfo } = useCollegeInfo();
  const { hiddenModules, hiddenItems } = useNavVisibility();
  const shown = (href: string) => !user?.role || !isPathHidden(href, user.role, hiddenModules, hiddenItems);
  const qc = useQueryClient();
  const today = istDateKey();
  const todayLabel = new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" });

  const strength = useQuery({ queryKey: ["pdash", "strength"], queryFn: () => getJson<StrengthPayload>("/api/college/student-strength"), staleTime: 10 * 60_000, enabled: shown("/principal/students") });
  const roster = useQuery({ queryKey: ["pdash", "roster", today], queryFn: () => getJson<{ roster: RosterRow[] }>(`/api/college/attendance/report?date=${today}`).then((d) => d.roster ?? []), staleTime: STALE, enabled: shown("/principal/attendance-report") });
  const classes = useQuery({ queryKey: ["pdash", "classes", today], queryFn: () => getJson<{ rows: NotPostedRow[] }>(`/api/college/faculty-attendance-completion?all=true&date=${today}`).then((d) => d.rows ?? []), staleTime: 5 * 60_000, enabled: shown("/principal/faculty-not-posted") });

  // Waiting for you - each count from the list its own page shows.
  const leave = useQuery({ queryKey: ["pdash", "leave"], queryFn: () => getJson<{ requests?: unknown[] }>("/api/leave/applications?scope=approvals").then((d) => d.requests?.length ?? 0), staleTime: STALE, enabled: shown("/principal/leave-approvals") });
  const certs = useQuery({ queryKey: ["pdash", "certs"], queryFn: () => getJson<{ requests?: unknown[] }>("/api/college/certificate-requests?view=inbox").then((d) => d.requests?.length ?? 0), staleTime: STALE, enabled: shown("/certificates") });
  const budget = useQuery({ queryKey: ["pdash", "budget"], queryFn: () => getJson<{ requests?: { status?: string }[] }>("/api/college/budget-requests").then((d) => (d.requests ?? []).filter((r) => r.status === "PENDING_PRINCIPAL_VERIFICATION").length), staleTime: STALE, enabled: shown("/principal/budget") });
  const perms = useQuery({ queryKey: ["pdash", "permissions"], queryFn: () => getJson<{ requests?: unknown[] }>("/api/college/student-permissions?view=inbox&limit=100").then((d) => d.requests?.length ?? 0), staleTime: STALE, enabled: shown("/principal/student-permissions") });
  const hiring = usePrincipalPendingHiring();
  const incidents = useIncidentUnread();

  const actions: ActionItem[] = [
    { key: "leave", label: "Leave approvals", icon: CalendarClock, href: "/principal/leave-approvals", count: leave.data, loading: leave.isLoading, error: leave.isError },
    { key: "certs", label: "Certificates", icon: FileCheck, href: "/certificates", count: certs.data, loading: certs.isLoading, error: certs.isError },
    { key: "budget", label: "Budget verification", icon: PiggyBank, href: "/principal/budget", count: budget.data, loading: budget.isLoading, error: budget.isError },
    { key: "hiring", label: "Hiring", icon: Briefcase, href: "/principal/vacancies", count: hiring.pendingCount, loading: hiring.loading, error: false },
    { key: "perms", label: "Student permissions", icon: ShieldCheck, href: "/principal/student-permissions", count: perms.data, loading: perms.isLoading, error: perms.isError },
    { key: "incidents", label: "Incident reports", icon: ShieldAlert, href: "/principal/incident-record", count: incidents, loading: false, error: false, unit: "unread" },
  ].filter((a) => shown(a.href));
  const waiting = actions.reduce((n, a) => n + (a.count ?? 0), 0);
  const actionsLoading = actions.some((a) => a.loading);

  const faculty = useMemo(() => (roster.data ? summarizeFacultyToday(roster.data) : null), [roster.data]);
  const periods = useMemo(() => (classes.data ? summarizeClassesToday(classes.data) : null), [classes.data]);
  const students = useMemo(() => {
    const p = strength.data;
    if (!p?.cells) return null;
    const sum = summarize(p.cells, p.meta, "ENROLLED");
    const years = Array.from({ length: p.meta.maxYear || 0 }, (_, i) => i + 1)
      .map((y) => ({ year: y, count: totalFor(p.cells, { status: "ENROLLED", year: y }) }))
      .filter((y) => y.count > 0);
    return { total: sum.total, years, programs: sum.byProgram };
  }, [strength.data]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Hello, ${user ? nameFor("dashboardName", { uid: user.uid }, user.name?.split(" ")[0] ?? fallbackName) : fallbackName}`}
        description={[user?.role ? ROLE_LABELS[user.role] : fallbackName, collegeInfo?.name, todayLabel].filter(Boolean).join(" · ")}
        actions={<Button variant="outline" size="sm" onClick={() => void qc.invalidateQueries({ queryKey: ["pdash"] })}><RefreshCw className="mr-1.5 h-4 w-4" />Refresh</Button>}
      />

      {/* Key numbers */}
      <section aria-label="Key numbers" className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {shown("/principal/students") && (
          <KpiTile icon={GraduationCap} label="Students" href="/principal/students?tab=strength" loading={strength.isLoading} error={strength.isError}
            value={students ? students.total.toLocaleString("en-IN") : "-"}
            sub={students?.years.length ? students.years.map((y) => `${romanYear(y.year)}: ${y.count.toLocaleString("en-IN")}`).join(" · ") : "Enrolled"} />
        )}
        {shown("/principal/attendance-report") && (
          <KpiTile icon={UsersRound} label="Faculty" href="/principal/faculty" loading={roster.isLoading} error={roster.isError}
            value={faculty ? faculty.total.toLocaleString("en-IN") : "-"} sub={faculty ? `${faculty.departments.length} departments` : ""} />
        )}
        {shown("/principal/attendance-report") && (
          <KpiTile icon={ClipboardCheck} label="Faculty present today" href="/principal/attendance-report" loading={roster.isLoading} error={roster.isError}
            value={faculty?.pct != null ? `${faculty.pct}%` : "-"} tone={pctTone(faculty?.pct ?? null)}
            sub={faculty ? `${faculty.present + faculty.halfDay + faculty.onDuty} in · ${faculty.late} late · ${faculty.notIn} not in yet` : ""} />
        )}
        {shown("/principal/faculty-not-posted") && (
          <KpiTile icon={BookOpenCheck} label="Class attendance posted" href="/principal/faculty-not-posted" loading={classes.isLoading} error={classes.isError}
            value={periods?.pct != null ? `${periods.pct}%` : periods ? "-" : "-"} tone={pctTone(periods?.pct ?? null, 95, 85)}
            sub={periods ? (periods.ended ? `${periods.notPosted} of ${periods.ended} ended periods not posted` : periods.periods ? "No period has ended yet" : "No classes today") : ""} />
        )}
        <KpiTile icon={Inbox} label="Waiting for you" href="#waiting" loading={actionsLoading && waiting === 0} error={false}
          value={String(waiting)} tone={waiting > 0 ? "watch" : "good"} sub={waiting > 0 ? `across ${actions.filter((a) => (a.count ?? 0) > 0).length} areas` : "All caught up"} />
      </section>

      {/* Waiting for you */}
      {actions.length > 0 && (
        <section id="waiting" aria-labelledby="waiting-h" className="space-y-2">
          <SectionTitle id="waiting-h">Waiting for you</SectionTitle>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {actions.map((a) => <ActionCard key={a.key} item={a} />)}
          </div>
        </section>
      )}

      {/* Today */}
      {(shown("/principal/attendance-report") || shown("/principal/faculty-not-posted")) && (
        <section aria-labelledby="today-h" className="space-y-2">
          <SectionTitle id="today-h">Today</SectionTitle>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {shown("/principal/attendance-report") && (
              <Panel title="Faculty attendance" href="/principal/attendance-report" loading={roster.isLoading} error={roster.isError} onRetry={() => void roster.refetch()}>
                {faculty && <FacultyTodayBody f={faculty} />}
              </Panel>
            )}
            {shown("/principal/faculty-not-posted") && (
              <Panel title="Class attendance posted" href="/principal/faculty-not-posted" loading={classes.isLoading} error={classes.isError} onRetry={() => void classes.refetch()}>
                {periods && <ClassesTodayBody c={periods} />}
              </Panel>
            )}
          </div>
        </section>
      )}

      {/* Students */}
      {shown("/principal/students") && (
        <section aria-labelledby="students-h" className="space-y-2">
          <SectionTitle id="students-h">Students</SectionTitle>
          <Panel title="Student strength" href="/principal/students?tab=strength" loading={strength.isLoading} error={strength.isError} onRetry={() => void strength.refetch()}>
            {students && <StudentsBody s={students} />}
          </Panel>
        </section>
      )}
    </div>
  );
}

// ─── pieces ─────────────────────────────────────────────────────────────────

type Tone = "good" | "watch" | "bad" | "none";
interface ActionItem { key: string; label: string; icon: ComponentType<{ className?: string }>; href: string; count: number | undefined; loading: boolean; error: boolean; unit?: string }

function SectionTitle({ id, children }: { id: string; children: ReactNode }) {
  return <h2 id={id} className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{children}</h2>;
}

function KpiTile({ icon: Icon, label, value, sub, href, tone = "none", loading, error }: {
  icon: ComponentType<{ className?: string }>; label: string; value: string; sub?: string; href: string; tone?: Tone; loading: boolean; error: boolean;
}) {
  return (
    <Link href={href} className="group rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <Card className="h-full transition-shadow group-hover:shadow-md">
        <CardContent className="flex h-full flex-col gap-1 p-4">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium">{label}</span>
            <Icon className="h-4 w-4" />
          </div>
          {loading ? <div className="mt-1 h-8 w-20 animate-pulse rounded bg-muted" />
            : error ? <p className="mt-1 text-sm text-muted-foreground">Couldn&apos;t load</p>
            : <p className={cn("text-3xl font-bold tabular-nums tracking-tight", tone !== "none" && TONE_TEXT[tone])}>{value}</p>}
          {!loading && !error && sub && <p className="truncate text-xs text-muted-foreground" title={sub}>{sub}</p>}
        </CardContent>
      </Card>
    </Link>
  );
}

function ActionCard({ item }: { item: ActionItem }) {
  const n = item.count ?? 0;
  const Icon = item.icon;
  return (
    <Link href={item.href} className="group rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <Card className={cn("transition-shadow group-hover:shadow-md", n > 0 && "border-amber-300 dark:border-amber-800")}>
        <CardContent className="flex items-center gap-3 p-3">
          <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", n > 0 ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" : "bg-muted text-muted-foreground")}>
            <Icon className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{item.label}</span>
            <span className="block text-xs text-muted-foreground">
              {item.loading ? "Loading..." : item.error ? "Couldn't load" : n > 0 ? `${n} ${item.unit ?? "waiting"}` : <span className="inline-flex items-center gap-1"><CheckCircle2 className="h-3 w-3 text-emerald-600" />Nothing waiting</span>}
            </span>
          </span>
          {!item.loading && !item.error && n > 0 && <span className="text-xl font-bold tabular-nums">{n}</span>}
          <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
        </CardContent>
      </Card>
    </Link>
  );
}

export function Panel({ title, href, loading, error, onRetry, children }: { title: string; href: string; loading: boolean; error: boolean; onRetry: () => void; children: ReactNode }) {
  return (
    <Card className="h-full">
      <CardContent className="space-y-4 p-5">
        <div className="flex items-center justify-between gap-2">
          <h3 className="font-semibold">{title}</h3>
          <Button asChild variant="ghost" size="sm" className="h-7 text-xs"><Link href={href}>Open<ArrowRight className="ml-1 h-3.5 w-3.5" /></Link></Button>
        </div>
        {loading ? <div className="space-y-2"><div className="h-6 animate-pulse rounded bg-muted" /><div className="h-24 animate-pulse rounded bg-muted" /></div>
          : error ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><AlertTriangle className="h-4 w-4" />Couldn&apos;t load this. <button type="button" onClick={onRetry} className="text-primary underline">Retry</button></p>
          : children}
      </CardContent>
    </Card>
  );
}

export function FacultyTodayBody({ f }: { f: ReturnType<typeof summarizeFacultyToday> }) {
  if (f.total === 0) return <p className="text-sm text-muted-foreground">No faculty on the roster.</p>;
  return (
    <div className="space-y-5">
      <DashboardDonut ariaLabel="Faculty attendance today" centerValue={f.pct == null ? "-" : `${f.pct}%`} centerLabel="present of those expected"
        slices={[
          { label: "On time", value: f.present - f.late, ...SLICE.good },
          { label: "Late", value: f.late, ...SLICE.warning },
          { label: "On leave", value: f.onLeave, ...SLICE.magenta },
          { label: "Half day / On duty", value: f.halfDay + f.onDuty, ...SLICE.blue },
          { label: "Not in yet", value: f.notIn, ...SLICE.neutral },
          { label: "Absent", value: f.absent, ...SLICE.critical },
        ]} />
      {f.departments.length > 1 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">By department (lowest first)</p>
          {f.departments.slice(0, 8).map((d) => {
            const tone = pctTone(d.pct);
            return (
              <div key={d.department} className="grid grid-cols-[minmax(5rem,9rem)_minmax(0,1fr)_4.5rem] items-center gap-2 text-sm" title={`${d.department}: ${d.present} of ${d.total} in`}>
                <span className="truncate">{d.department}</span>
                <span className="h-2 overflow-hidden rounded-full bg-muted"><span className={cn("block h-full rounded-full", TONE_BAR[tone])} style={{ width: `${d.pct ?? 0}%` }} /></span>
                <span className="text-right text-xs tabular-nums"><span className="font-semibold">{d.pct == null ? "-" : `${d.pct}%`}</span><span className="ml-1 text-muted-foreground">{d.present}/{d.total}</span></span>
              </div>
            );
          })}
          {f.departments.length > 8 && <p className="text-xs text-muted-foreground">+{f.departments.length - 8} more departments</p>}
        </div>
      )}
    </div>
  );
}

export function ClassesTodayBody({ c }: { c: ReturnType<typeof summarizeClassesToday> }) {
  if (c.periods === 0) return <p className="text-sm text-muted-foreground">No classes on the timetable today.</p>;
  return (
    <div className="space-y-5">
      <DashboardDonut ariaLabel="Class attendance posted today" centerValue={c.pct == null ? "-" : `${c.pct}%`} centerLabel={c.ended ? "of ended periods posted" : "no period ended yet"}
        slices={[
          { label: "Posted on time", value: c.onTime, ...SLICE.good },
          { label: "Posted late", value: c.late, ...SLICE.warning },
          { label: "Not posted", value: c.notPosted, ...SLICE.critical },
          { label: "Still to come", value: c.upcoming, ...SLICE.neutral },
        ]} />
      {c.notPosted > 0 ? (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">{c.facultyNotPosted} faculty haven&apos;t posted · not posted by department (of ended periods)</p>
          {c.departments.filter((d) => d.notPosted > 0).slice(0, 8).map((d, _i, list) => (
            <div key={d.department} className="grid grid-cols-[minmax(5rem,9rem)_minmax(0,1fr)_4.5rem] items-center gap-2 text-sm" title={`${d.department}: ${d.notPosted} of ${d.ended} ended periods not posted`}>
              <span className="truncate">{d.department}</span>
              <span className="h-2 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-[#d03b3b]" style={{ width: `${(d.notPosted / Math.max(...list.map((x) => x.notPosted), 1)) * 100}%` }} /></span>
              <span className="text-right text-xs tabular-nums"><span className="font-semibold">{d.notPosted}</span><span className="text-muted-foreground"> / {d.ended}</span></span>
            </div>
          ))}
        </div>
      ) : c.ended > 0 ? (
        <p className="flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="h-4 w-4" />Every ended period has its attendance posted.</p>
      ) : null}
    </div>
  );
}

export function StudentsBody({ s }: { s: { total: number; years: { year: number; count: number }[]; programs: { key: string; label: string; count: number }[] } }) {
  if (s.total === 0) return <p className="text-sm text-muted-foreground">No enrolled students yet.</p>;
  const max = Math.max(...s.programs.map((p) => p.count), 1);
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <DashboardDonut ariaLabel="Enrolled students by year" centerValue={s.total.toLocaleString("en-IN")} centerLabel="enrolled"
        slices={s.years.map((y, i) => ({ label: `${romanYear(y.year)} year`, value: y.count, ...YEAR_RAMP[Math.min(i, YEAR_RAMP.length - 1)] }))} />
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground">By course</p>
        {s.programs.slice(0, 8).map((p) => (
          <div key={p.key} className="grid grid-cols-[minmax(5rem,12rem)_minmax(0,1fr)_4rem] items-center gap-2 text-sm" title={`${p.label}: ${p.count}`}>
            <span className="truncate">{p.label}</span>
            <span className="h-2 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-[#2a78d6] dark:bg-[#3987e5]" style={{ width: `${(p.count / max) * 100}%` }} /></span>
            <span className="text-right text-xs font-semibold tabular-nums">{p.count.toLocaleString("en-IN")}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
