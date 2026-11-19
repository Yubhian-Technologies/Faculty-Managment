"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle, ArrowRight, CalendarCheck2, CalendarDays, ClipboardCheck, FileCheck, GraduationCap, Inbox, RefreshCw,
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
  };
  onLeave: { name: string; leaveType: string; halfDay: string | null; covers: { period: number; section: string; substitute: string }[]; uncovered: number }[];
  departments: string[];
}
interface SemesterData {
  since: string | null;
  trend: { date: string; pct: number }[];
  shortage: {
    students: number; below: number; critical: number;
    criticalList: { name: string; rollNumber: string; section: string; pct: number }[];
    bySubject: { label: string; name: string; below: number }[];
  };
  results: { year: number; label: string; semester: number; examHeld: string; students: number; passed: number; pct: number | null }[];
  computedAt: string;
}
type Roster = (RosterRow & { uid?: string; name?: string; designation?: string })[];
interface MyPeriod { periodNumber: number; startTime: string; endTime: string; sectionName: string; subjectName: string; phase: string; sessionStatus: string | null }

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  const json = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(json.error ?? "Unable to load");
  return json;
}

const SHORT = 75;
const fmtPct = (p: number | null | undefined, digits = 1) => (p == null ? "-" : `${p.toFixed(digits)}%`);
const initials = (name: string) => name.replace(/^(dr|mr|mrs|ms|prof)\.?\s+/i, "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("");
const shortDay = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
const hhmm12 = (t: string) => {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
};

// Status colours (fixed): always beside a label or icon, never colour alone.
const GOOD = "#0ca30c", WARN = "#fab219", CRIT = "#d03b3b";

// ── Small building blocks ───────────────────────────────────────────────────

function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("rounded-2xl border bg-card shadow-sm", className)}>{children}</div>;
}

function Panel({ title, sub, href, linkLabel, loading, error, onRetry, children, className }: {
  title: string; sub?: ReactNode; href?: string; linkLabel?: string; loading?: boolean; error?: boolean; onRetry?: () => void; children: ReactNode; className?: string;
}) {
  return (
    <Card className={cn("p-4 sm:p-5", className)}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[15px] font-semibold leading-tight">{title}</h3>
          {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
        </div>
        {href && <Link href={href} className="shrink-0 text-xs font-medium text-primary hover:underline">{linkLabel ?? "Open"} →</Link>}
      </div>
      {error ? (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
          Unable to load this card.
          {onRetry && <button type="button" onClick={onRetry} className="inline-flex items-center gap-1 text-xs font-medium hover:underline"><RefreshCw className="h-3.5 w-3.5" />Retry</button>}
        </div>
      ) : loading ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-6 animate-pulse rounded-md bg-muted" />)}</div>
      ) : children}
    </Card>
  );
}

function Kpi({ icon: Icon, label, href, value, unit, sub, meter, loading, error, tone }: {
  icon: typeof GraduationCap; label: string; href: string; value: ReactNode; unit?: string; sub?: ReactNode;
  meter?: { value: number; color: string }[]; loading?: boolean; error?: boolean; tone?: "crit";
}) {
  return (
    <Link href={href} className="group block rounded-2xl border bg-card p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
      <div className="flex items-start justify-between gap-2 text-xs font-medium text-muted-foreground">
        <span className="leading-snug">{label}</span>
        <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-lg", tone === "crit" ? "bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400" : "bg-primary/10 text-primary")}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
      {error ? <p className="mt-3 text-sm text-destructive">Unable to load</p> : loading ? (
        <div className="mt-3 space-y-2"><div className="h-7 w-20 animate-pulse rounded bg-muted" /><div className="h-3 w-28 animate-pulse rounded bg-muted" /></div>
      ) : (
        <>
          <p className="mt-1.5 text-[26px] font-bold leading-tight tracking-tight tabular-nums">{value}{unit && <span className="ml-0.5 text-sm font-medium text-muted-foreground">{unit}</span>}</p>
          {meter && (
            <div className="mt-2 flex h-1.5 gap-0.5 overflow-hidden rounded-full bg-muted">
              {meter.filter((m) => m.value > 0).map((m, i) => <i key={i} className="block h-full rounded-full" style={{ width: `${m.value}%`, background: m.color }} />)}
            </div>
          )}
          {sub && <div className="mt-2 text-xs text-muted-foreground">{sub}</div>}
        </>
      )}
    </Link>
  );
}

function Tag({ tone, children }: { tone: "good" | "warn" | "crit" | "info"; children: ReactNode }) {
  const cls = {
    good: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400",
    warn: "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
    crit: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400",
    info: "bg-primary/10 text-primary",
  }[tone];
  return <span className={cn("inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold", cls)}>{children}</span>;
}

function SectionTitle({ title, sub }: { title: string; sub?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 px-0.5 pt-2">
      <h2 className="text-base font-semibold">{title}</h2>
      {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
    </div>
  );
}

/** A labelled horizontal bar; red only for the labelled "below 75%" status. */
function Bar({ label, value, max = 100, text, sub, low, refLine, wide, title }: { label: string; value: number; max?: number; text: string; sub?: string; low?: boolean; refLine?: number; wide?: boolean; title?: string }) {
  return (
    <div className={cn("grid items-center gap-2.5 text-xs", wide ? "grid-cols-[minmax(0,130px)_1fr_64px]" : "grid-cols-[64px_1fr_76px]")} title={title ?? `${label}: ${text}`}>
      <span className="truncate font-medium text-muted-foreground">{label}</span>
      <div className="relative h-3.5 rounded bg-muted/70">
        <div className="h-full rounded-r" style={{ width: `${Math.max(0, Math.min(100, (value / max) * 100))}%`, background: low ? CRIT : "hsl(var(--primary))" }} />
        {refLine != null && <div className="absolute -bottom-1 -top-1 border-l-[1.5px] border-dashed border-muted-foreground/70" style={{ left: `${refLine}%` }} />}
      </div>
      <span className="text-right font-semibold tabular-nums">{text}{sub && <span className="block text-[11px] font-normal text-muted-foreground">{sub}</span>}</span>
    </div>
  );
}

function Legend({ items }: { items: { color: string; label: string; ring?: boolean }[] }) {
  return (
    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          <i className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: i.color, boxShadow: i.ring ? `inset 0 0 0 1.5px ${i.color}` : undefined }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

// ── Class grid ──────────────────────────────────────────────────────────────

const CELL: Record<ClassCell["status"], { cls: string; mark: string; label: string }> = {
  POSTED: { cls: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400", mark: "✓", label: "Posted" },
  NOW: { cls: "bg-primary/10 text-primary ring-2 ring-inset ring-primary", mark: "●", label: "Running now" },
  OVERDUE: { cls: "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400", mark: "!", label: "Not posted" },
  UPCOMING: { cls: "bg-muted/60 text-muted-foreground", mark: "", label: "Later today" },
};

function ClassGrid({ data }: { data: TodayData["classes"] }) {
  const multiDept = new Set(data.sections.map((s) => s.department)).size > 1;
  if (data.total === 0) return <p className="py-6 text-center text-sm text-muted-foreground">No classes on the timetable today.</p>;
  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-1 text-xs">
          <thead>
            <tr>
              <th />
              {data.periods.map((p) => <th key={p} className="font-medium text-muted-foreground">P{p}</th>)}
            </tr>
          </thead>
          <tbody>
            {data.sections.map((s) => (
              <tr key={s.id}>
                <th scope="row" className="whitespace-nowrap pr-2 text-left font-semibold text-foreground/80">
                  {s.label}{multiDept && <span className="ml-1 font-normal text-muted-foreground">{s.department.split(/\s+/).map((w) => w[0]).join("").slice(0, 4)}</span>}
                </th>
                {data.periods.map((p) => {
                  const c = data.cells[`${s.id}|${p}`];
                  if (!c) return <td key={p} className="h-8 min-w-10 text-center text-muted-foreground/60">–</td>;
                  const look = CELL[c.status];
                  const covered = c.covered && c.status !== "OVERDUE";
                  return (
                    <td key={p} title={`${s.label} · P${p}${c.start ? ` (${hhmm12(c.start)})` : ""} · ${c.subject} · ${c.faculty} · ${covered ? "Substitute / adjusted · " : ""}${look.label}`}
                      className={cn("h-8 min-w-10 rounded-md text-center font-semibold", covered ? "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300" : look.cls)}>
                      {covered ? "⇄" : look.mark}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Legend items={[
        { color: GOOD, label: "Posted ✓" }, { color: "hsl(var(--primary))", label: "Running now ●" },
        { color: CRIT, label: "Not posted !" }, { color: WARN, label: "Substitute / adjusted ⇄" }, { color: "hsl(var(--muted-foreground) / 0.3)", label: "Later today" },
      ]} />
      {data.overdue.length > 0 && (
        <div className="mt-3 rounded-lg border border-red-200 bg-red-50/60 p-2.5 dark:border-red-900 dark:bg-red-950/20">
          <p className="mb-1.5 text-xs font-semibold text-red-700 dark:text-red-400">Not posted yet</p>
          <ul className="grid gap-1 text-xs sm:grid-cols-2">
            {data.overdue.slice(0, 8).map((o, i) => (
              <li key={i} className="truncate"><span className="font-medium">P{o.period} · {o.section}</span> <span className="text-muted-foreground">{o.subject} · {o.faculty}</span></li>
            ))}
          </ul>
          {data.overdue.length > 8 && <p className="mt-1 text-xs text-muted-foreground">and {data.overdue.length - 8} more</p>}
        </div>
      )}
    </>
  );
}

// ── Trend chart (one series, 75% line, hover crosshair + tooltip) ───────────

function TrendChart({ points }: { points: { date: string; pct: number }[] }) {
  const box = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  if (points.length < 2) return <p className="py-10 text-center text-sm text-muted-foreground">Not enough days of attendance yet.</p>;
  const W = 640, H = 210, L = 36, R = 12, T = 12, B = 26;
  const lo = Math.max(0, Math.floor(Math.min(SHORT, ...points.map((p) => p.pct)) / 5) * 5 - 5);
  const hi = Math.min(100, Math.ceil(Math.max(...points.map((p) => p.pct)) / 5) * 5 + 5);
  const x = (i: number) => L + ((W - L - R) * i) / (points.length - 1);
  const y = (v: number) => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
  const ticks: number[] = [];
  for (let t = lo; t <= hi; t += hi - lo > 30 ? 10 : 5) ticks.push(t);
  const line = points.map((p, i) => `${x(i)},${y(p.pct)}`).join(" ");
  const last = points[points.length - 1];
  const onMove = (e: React.MouseEvent) => {
    const r = box.current?.getBoundingClientRect();
    if (!r) return;
    const px = ((e.clientX - r.left) / r.width) * W;
    setHover(Math.max(0, Math.min(points.length - 1, Math.round(((px - L) / (W - L - R)) * (points.length - 1)))));
  };
  return (
    <div ref={box} className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full overflow-visible" role="img"
        aria-label={`Department student attendance over the last ${points.length} class days, from ${Math.min(...points.map((p) => p.pct))}% to ${Math.max(...points.map((p) => p.pct))}%`}
        onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke={t === SHORT ? "hsl(var(--muted-foreground))" : "hsl(var(--border))"} strokeDasharray={t === SHORT ? "4 4" : undefined} />
            <text x={L - 6} y={y(t) + 3.5} fontSize="10" textAnchor="end" fill="hsl(var(--muted-foreground))">{t}%</text>
          </g>
        ))}
        {!ticks.includes(SHORT) && SHORT > lo && SHORT < hi && <line x1={L} x2={W - R} y1={y(SHORT)} y2={y(SHORT)} stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" />}
        {SHORT > lo && SHORT < hi && <text x={W - R} y={y(SHORT) - 5} fontSize="10" textAnchor="end" fill="hsl(var(--muted-foreground))">75% line</text>}
        <polygon points={`${L},${y(lo)} ${line} ${x(points.length - 1)},${y(lo)}`} fill="hsl(var(--primary))" opacity="0.08" />
        <polyline points={line} fill="none" stroke="hsl(var(--primary))" strokeWidth="2" strokeLinejoin="round" />
        {points.map((p, i) => (i % 2 === 0 || i === points.length - 1) && (
          <text key={p.date} x={x(i)} y={H - 6} fontSize="10" textAnchor="middle" fill="hsl(var(--muted-foreground))">{shortDay(p.date)}</text>
        ))}
        <circle cx={x(points.length - 1)} cy={y(last.pct)} r="4" fill="hsl(var(--primary))" stroke="hsl(var(--card))" strokeWidth="2" />
        <text x={x(points.length - 1) - 8} y={y(last.pct) - 10} fontSize="11" fontWeight="600" textAnchor="end" fill="hsl(var(--foreground))">{last.pct}%</text>
        {hover != null && (
          <>
            <line x1={x(hover)} x2={x(hover)} y1={T} y2={H - B} stroke="hsl(var(--muted-foreground))" opacity="0.5" />
            <circle cx={x(hover)} cy={y(points[hover].pct)} r="4" fill="hsl(var(--primary))" stroke="hsl(var(--card))" strokeWidth="2" />
          </>
        )}
      </svg>
      {hover != null && (
        <div className="pointer-events-none absolute rounded-lg border bg-popover px-2.5 py-1.5 text-xs shadow-md"
          style={{ left: `${Math.min((x(hover) / W) * 100, 80)}%`, top: `${Math.max(0, (y(points[hover].pct) / H) * 100 - 28)}%` }}>
          <b className="block text-sm">{points[hover].pct}%</b>{shortDay(points[hover].date)}
        </div>
      )}
    </div>
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
  const myDay = useQuery({ queryKey: ["hdash", "mine", today], queryFn: () => getJson<{ periods?: MyPeriod[] }>("/api/college/student-attendance/today-periods").then((d) => d.periods ?? []), staleTime: 2 * 60_000 });

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
    return { total: sum.total, years };
  }, [strength.data]);

  const banksWaiting = (banks.data ?? []).reduce((n, b) => n + b.progress.banksSubmitted, 0);
  const uncovered = (day.data?.onLeave ?? []).reduce((n, l) => n + l.uncovered, 0);
  const waiting = [
    { key: "leave", show: shown("/hod/leave-approvals"), label: "Leave Approvals", sub: "Waiting for your decision", href: "/hod/leave-approvals", count: leaveQ.data, hot: true, icon: CalendarCheck2 },
    { key: "banks", show: shown("/hod/question-banks"), label: "Question Papers to Approve", sub: banks.data?.[0] ? `Mid-${banks.data[0].deadline.midNumber ?? ""} · deadline ${shortDay(banks.data[0].deadline.deadline)}` : "Submitted by your faculty", href: "/hod/question-banks", count: banks.data ? banksWaiting : undefined, hot: true, icon: BookOpenCheck },
    { key: "uncovered", show: true, label: "Periods Without Cover", sub: "Faculty on leave today", href: "/hod/leave-approvals", count: day.data ? uncovered : undefined, hot: true, icon: AlertTriangle },
    { key: "perms", show: shown("/hod/student-permissions"), label: "Student Permissions", sub: "On duty requests", href: "/hod/student-permissions", count: permQ.data, hot: false, icon: ShieldCheck },
    { key: "cover", show: true, label: "Cover Requests for You", sub: "Substitute or handover asked of you", href: "/leave/adjustments", count: coverQ.data, hot: false, icon: Repeat2 },
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
      <section className="relative overflow-hidden rounded-[20px] bg-gradient-to-r from-[#1c5cab] to-[#2a78d6] px-5 pb-10 pt-6 text-white sm:px-7 dark:from-[#13325c] dark:to-[#1c5cab]">
        <div className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-white/[0.07]" />
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{greeting}, {myName}</h1>
            <p className="mt-1 text-sm text-white/85">{todayLabel}{deptLabel ? ` · ${deptLabel}` : ""}</p>
            <div className="mt-3 flex flex-wrap gap-2 text-xs font-medium">
              <span className="rounded-full border border-white/25 bg-white/15 px-2.5 py-1">HOD</span>
              {exams.data?.[0] && <span className="rounded-full border border-white/25 bg-white/15 px-2.5 py-1">Mid-{exams.data[0].mid} from {shortDay(exams.data[0].date)}</span>}
              {sem.data?.since && <span className="rounded-full border border-white/25 bg-white/15 px-2.5 py-1">Semester since {shortDay(sem.data.since)}</span>}
            </div>
          </div>
          <div className="min-w-[230px] rounded-xl border border-white/20 bg-white/10 px-4 py-3">
            <p className="text-[11px] font-medium uppercase tracking-wider text-white/75">{day.data?.current?.next ? "Next class" : "Right now"}</p>
            {day.isLoading ? <div className="mt-1 h-5 w-32 animate-pulse rounded bg-white/20" /> : day.data?.current ? (
              <>
                <p className="mt-0.5 text-[15px] font-semibold">{hhmm12(day.data.current.start)} – {hhmm12(day.data.current.end)}</p>
                <p className="text-xs text-white/85">{cls?.running ?? 0} classes running · {dueOverdue} not posted yet</p>
              </>
            ) : <p className="mt-0.5 text-sm font-medium">No more classes today</p>}
          </div>
        </div>
      </section>

      {/* Key numbers */}
      <section aria-label="Key numbers" className="relative z-10 -mt-12 grid grid-cols-2 gap-3 px-0 sm:px-2 md:grid-cols-3 xl:grid-cols-6">
        <Kpi icon={GraduationCap} label="Students" href="/hod/students" loading={strength.isLoading} error={strength.isError || !shown("/hod/students")}
          value={students ? students.total.toLocaleString("en-IN") : "-"}
          sub={students?.years.map((y) => `${["I", "II", "III", "IV", "V"][y.year - 1] ?? y.year} ${y.count}`).join(" · ")} />
        <Kpi icon={ClipboardCheck} label="Student Attendance Today" href="/hod/attendance-reports" loading={day.isLoading} error={day.isError}
          value={day.data?.students.pct == null ? "-" : day.data.students.pct.toFixed(1)} unit={day.data?.students.pct == null ? undefined : "%"}
          meter={day.data?.students.pct != null ? [{ value: day.data.students.pct, color: day.data.students.pct < SHORT ? CRIT : "hsl(var(--primary))" }] : undefined}
          sub={day.data ? `${day.data.students.absentAllDay} absent all day` : undefined} />
        <Kpi icon={CalendarDays} label="Classes Today" href="/hod/attendance-reports" loading={day.isLoading} error={day.isError}
          value={cls ? cls.posted : "-"} unit={cls ? ` / ${cls.due} posted` : undefined}
          meter={cls && cls.due ? [{ value: (cls.posted / cls.due) * 100, color: GOOD }, { value: (dueOverdue / cls.due) * 100, color: CRIT }] : undefined}
          sub={cls ? (dueOverdue ? <Tag tone="crit">{dueOverdue} overdue</Tag> : <Tag tone="good">All posted</Tag>) : undefined} />
        <Kpi icon={UserCheck} label="Faculty Present" href="/hod/faculty-attendance" loading={roster.isLoading} error={roster.isError}
          value={faculty ? faculty.present + faculty.halfDay + faculty.onDuty : "-"} unit={faculty ? ` / ${faculty.total}` : undefined}
          meter={faculty && faculty.total ? [
            { value: ((faculty.present - faculty.late.length + faculty.halfDay + faculty.onDuty) / faculty.total) * 100, color: GOOD },
            { value: (faculty.late.length / faculty.total) * 100, color: WARN },
            { value: (faculty.onLeave / faculty.total) * 100, color: "hsl(var(--primary))" },
            { value: ((faculty.notIn.length + faculty.absent) / faculty.total) * 100, color: CRIT },
          ] : undefined}
          sub={faculty ? `${faculty.late.length} late · ${faculty.onLeave} on leave · ${faculty.notIn.length} not in` : undefined} />
        <Kpi icon={AlertTriangle} tone="crit" label={`Below ${SHORT}%`} href="/hod/attendance-reports" loading={sem.isLoading} error={sem.isError}
          value={sem.data ? sem.data.shortage.below : "-"}
          sub={sem.data && sem.data.shortage.students ? <>{((sem.data.shortage.below / sem.data.shortage.students) * 100).toFixed(1)}% of students{sem.data.shortage.critical > 0 && <> · <Tag tone="crit">{sem.data.shortage.critical} below 65%</Tag></>}</> : undefined} />
        <Kpi icon={Inbox} label="Waiting for You" href="#waiting" loading={waitingLoading && waitingTotal === 0} error={false}
          value={waitingTotal} sub={waitingHot ? `${waitingHot} need you today` : "Nothing urgent"} />
      </section>

      {/* Waiting */}
      <section id="waiting" className="space-y-2.5">
        <SectionTitle title="Waiting for You" sub="Each opens its own page" />
        {activeWaiting.length === 0 && !waitingLoading ? (
          <Card className="flex items-center gap-3 p-4 text-sm text-muted-foreground"><ShieldCheck className="h-5 w-5 text-emerald-600" />Nothing is waiting for you right now.</Card>
        ) : (
          <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {(activeWaiting.length ? activeWaiting : waiting).map((w) => (
              <Link key={w.key} href={w.href} className="flex items-center gap-3 rounded-2xl border bg-card p-3.5 shadow-sm transition hover:border-primary">
                <span className={cn("grid h-10 min-w-10 place-items-center rounded-xl px-2 text-base font-bold tabular-nums",
                  w.hot && (w.count ?? 0) > 0 ? "bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-400" : "bg-primary/10 text-primary")}>
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
        <div className="grid gap-3.5 lg:grid-cols-[2fr_1fr]">
          <Panel title="Classes" sub="Every section, period by period" href="/hod/attendance-reports" linkLabel="Attendance Reports"
            loading={day.isLoading} error={day.isError} onRetry={() => void day.refetch()}>
            {cls && <ClassGrid data={cls} />}
          </Panel>
          <Panel title="Student Attendance by Section" sub="Today so far · lowest first" loading={day.isLoading} error={day.isError} onRetry={() => void day.refetch()}>
            {day.data && (day.data.students.sections.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No attendance posted yet today.</p>
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
          <Panel title="Faculty Attendance" sub={faculty ? `${faculty.total} faculty${faculty.staff ? ` · ${faculty.staff} supporting staff` : ""}` : undefined}
            href="/hod/faculty-attendance" linkLabel="Faculty Attendance" loading={roster.isLoading} error={roster.isError} onRetry={() => void roster.refetch()}>
            {faculty && (
              <>
                <div className="flex h-3 gap-0.5 overflow-hidden rounded-full bg-muted">
                  {[
                    { n: faculty.present - faculty.late.length + faculty.halfDay + faculty.onDuty, c: GOOD },
                    { n: faculty.late.length, c: WARN }, { n: faculty.onLeave, c: "hsl(var(--primary))" }, { n: faculty.notIn.length + faculty.absent, c: CRIT },
                  ].filter((s) => s.n > 0).map((s, i) => <i key={i} className="block h-full" style={{ flex: s.n, background: s.c }} />)}
                </div>
                <Legend items={[
                  { color: GOOD, label: `Present ${faculty.present - faculty.late.length + faculty.halfDay + faculty.onDuty}` },
                  { color: WARN, label: `Late ${faculty.late.length}` },
                  { color: "hsl(var(--primary))", label: `On leave ${faculty.onLeave}` },
                  { color: CRIT, label: `Not checked in ${faculty.notIn.length + faculty.absent}` },
                ]} />
                <ul className="mt-3 space-y-2">
                  {[...faculty.notIn.map((r) => ({ r, tag: <Tag tone="crit">Not checked in</Tag>, note: r.designation ?? "" })),
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
          <Panel title="On Leave Today" sub="And who is covering their classes" href="/hod/leave-history" linkLabel="Leave Register"
            loading={day.isLoading} error={day.isError} onRetry={() => void day.refetch()}>
            {day.data && (day.data.onLeave.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Nobody in your department is on leave today.</p>
            ) : (
              <ul className="space-y-2.5">
                {day.data.onLeave.map((l, i) => (
                  <li key={i} className="flex items-start gap-2.5 text-sm">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/10 text-[11px] font-bold text-primary">{initials(l.name)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{l.name}</span>
                      <span className="text-muted-foreground"> · {LEAVE_TYPE_LABELS[l.leaveType as keyof typeof LEAVE_TYPE_LABELS] ?? l.leaveType}{l.halfDay ? ` (${l.halfDay === "FN" ? "Forenoon" : "Afternoon"})` : ""}</span>
                      {l.covers.length > 0 && <span className="block truncate text-[11px] text-muted-foreground">{l.covers.map((c) => `P${c.period} ${c.section} → ${c.substitute}`).join(" · ")}</span>}
                    </span>
                    {l.uncovered > 0 ? <Tag tone="crit">{l.uncovered} uncovered</Tag> : <Tag tone="good">Covered</Tag>}
                  </li>
                ))}
              </ul>
            ))}
          </Panel>
        </div>
      </section>

      {/* This semester */}
      <section className="space-y-3">
        <SectionTitle title="This Semester" sub={sem.data?.since ? `Since ${shortDay(sem.data.since)} · counted the same way as the reports` : "Counted the same way as the reports"} />
        <div className="grid gap-3.5 lg:grid-cols-[2fr_1fr]">
          <Panel title="Student Attendance Trend" sub="Department average, last 14 class days" href="/hod/attendance-reports" linkLabel="Reports"
            loading={sem.isLoading} error={sem.isError} onRetry={() => void sem.refetch()}>
            {sem.data && <TrendChart points={sem.data.trend} />}
          </Panel>
          <Panel title="Shortage by Subject" sub={`Students below ${SHORT}% in each subject`} loading={sem.isLoading} error={sem.isError} onRetry={() => void sem.refetch()}>
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
              href="/hod/question-banks" linkLabel="Question Banks" loading={banks.isLoading} error={banks.isError} onRetry={() => void banks.refetch()}>
              {!firstBank ? <p className="py-6 text-center text-sm text-muted-foreground">No open question paper deadline.</p> : (() => {
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
          <Panel title="Coming Up" sub="Published Mid timetable" href="/panel/mid-timetable" linkLabel="Timetable" loading={exams.isLoading} error={exams.isError} onRetry={() => void exams.refetch()}>
            {exams.data && (exams.data.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No upcoming Mid exams.</p> : (
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
            <Panel title="Latest Results" sub="Regular · published · all subjects passed" href="/hod/results-analysis" linkLabel="Results Analysis"
              loading={sem.isLoading} error={sem.isError} onRetry={() => void sem.refetch()}>
              {sem.data && (sem.data.results.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">No published results yet.</p> : (
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
        <SectionTitle title="My Day" sub="Your own classes, attendance and leave" />
        <Card className="grid gap-4 p-4 sm:p-5 lg:grid-cols-[1.2fr_1fr_1fr]">
          <div className="space-y-1.5">
            <p className="text-sm font-semibold">My Classes</p>
            {myDay.isLoading ? <div className="h-8 animate-pulse rounded-lg bg-muted" /> : (myDay.data ?? []).length === 0 ? (
              <p className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground">No classes for you today.</p>
            ) : (() => {
              const list = myDay.data!;
              const next = list.find((p) => p.phase !== "ENDED" && p.sessionStatus !== "SUBMITTED");
              return list.map((p) => (
                <Link key={`${p.periodNumber}-${p.sectionName}`} href="/panel/mark-attendance"
                  className={cn("flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-xs", p === next ? "bg-primary/10 font-semibold text-primary" : "bg-muted/50")}>
                  <span className="truncate">P{p.periodNumber} · {p.sectionName} · {p.subjectName}</span>
                  <span className="shrink-0">{p.sessionStatus === "SUBMITTED" ? "✓ Posted" : p === next ? `Next · ${hhmm12(p.startTime)}` : p.phase === "ENDED" ? "Not posted" : hhmm12(p.startTime)}</span>
                </Link>
              ));
            })()}
          </div>
          <div className="space-y-1.5">
            <p className="text-sm font-semibold">My Attendance</p>
            <Link href="/hod/attendance" className="flex justify-between rounded-lg bg-muted/50 px-3 py-2 text-xs">
              <span>Today</span>
              <span className="font-medium">{faculty?.me?.checkIn ? `Checked in ${hhmm12(faculty.me.checkIn)}` : faculty?.me?.status === "ON_LEAVE" ? "On leave" : "Not checked in"}</span>
            </Link>
            <Link href="/hod/attendance" className="flex justify-between rounded-lg bg-muted/50 px-3 py-2 text-xs"><span>Attendance records</span><span>Open →</span></Link>
          </div>
          <div className="space-y-1.5">
            <p className="text-sm font-semibold">Quick Links</p>
            <Link href="/hod/leave" className="flex justify-between rounded-lg bg-muted/50 px-3 py-2 text-xs"><span>My Leave</span><span>Apply or view balance →</span></Link>
            <Link href="/hod/pipeline" className="flex justify-between rounded-lg bg-muted/50 px-3 py-2 text-xs"><span>Hiring</span><span>Pipeline →</span></Link>
            <Link href="/hod/faculty" className="flex justify-between rounded-lg bg-muted/50 px-3 py-2 text-xs"><span><UsersRound className="mr-1 inline h-3.5 w-3.5" />Faculty</span><span>Open →</span></Link>
          </div>
        </Card>
      </section>
    </div>
  );
}
