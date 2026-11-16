"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle, ArrowRight, BookOpen, CalendarClock, CalendarDays, CheckCircle2, ClipboardCheck, Clock, FileText,
  GraduationCap, LogIn, Receipt, ShieldCheck, Sparkles, UserCheck,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/store/authStore";
import { useNavVisibility } from "@/hooks/useNavVisibility";
import { isPathHidden } from "@/components/layout/navConfig";
import { ROLE_DASHBOARD_PATHS, ROLE_LABELS } from "@/types/core";
import { SEAT_BLURB } from "@/components/dashboard/MyDashboardOverview";
import { deadlineLabel } from "@/lib/midBank/deadline";
import type { MidBankListItem } from "@/lib/midBank/clientTypes";

// The faculty member's home: today first. Who they are and whether they've checked in; today's classes with what is
// still to mark; only the things waiting on them; real numbers (attendance this month, leave, teaching load); what is
// coming up; and one-tap actions. Every part reads data the app already has, hides itself when it has nothing to show
// or when Navigation Visibility hides its page, and never blocks the rest when one source fails.

const getJson = async <T,>(url: string): Promise<T> => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(String(r.status));
  return (await r.json()) as T;
};

const istNow = () => new Date(Date.now() + 330 * 60_000);
const istToday = () => istNow().toISOString().slice(0, 10);
const minutesOf = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
const hhmm12 = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
};
const dayText = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" });

interface Period {
  assignmentId: string; periodNumber: number; startTime: string; endTime: string; subjectName: string; sectionName: string;
  courseName?: string; year?: number; classroom: string | null; sessionStatus: string | null; phase?: "UPCOMING" | "OPEN" | "ENDED"; isOpen: boolean;
  unavailableMessage?: string | null;
}
interface AttendanceRecord { date: unknown; status: string; checkIn?: string | null; checkOut?: string | null; permittedCheckInTime?: string | null; lateAfter?: string | null }
interface AttendanceMonth { summary: { present?: number; absent?: number; halfDay?: number; onLeave?: number; totalWorkingDays?: number } | null; records: AttendanceRecord[] }
interface Balance { code: string; label: string; remaining?: number; unlimited?: boolean }
interface CeaAssignment { subjectName: string; section: string; units: { unit: number; status: string | null }[] }
interface Duty { id: string; date: string; from: string; to: string; room: string; status: string; category: string }
interface MidTimetable { midNumber: number; courseName: string; slots: { date: string; subjectName: string }[] }
interface TeachingAssignment { subjectId: string; hoursPerWeek?: number; isPast?: boolean; accessLevel?: string; sectionName?: string }

function recordDate(d: unknown): string | null {
  if (typeof d === "string") return d.slice(0, 10);
  const o = d as { _seconds?: number; seconds?: number } | null;
  const s = o?._seconds ?? o?.seconds;
  return typeof s === "number" ? new Date(s * 1000 + 330 * 60_000).toISOString().slice(0, 10) : null;
}

/** One section's data, shared across visits (60 s); a failure just hides that section. */
function useHomeQuery<T>(uid: string, key: string, url: string, enabled: boolean) {
  return useQuery({ queryKey: ["faculty-home", key, uid], queryFn: () => getJson<T>(url), enabled: !!uid && enabled, staleTime: 60_000, retry: 0 });
}

export function FacultyHome({ extraAttention }: { extraAttention?: ReactNode }) {
  const user = useAuthStore((s) => s.user);
  const { hiddenModules, hiddenItems } = useNavVisibility();
  const hidden = (href: string) => !!user?.role && isPathHidden(href, user.role, hiddenModules, hiddenItems);
  const uid = user?.uid ?? "";
  const today = istToday();
  const now = istNow();
  const [y, m] = [now.getUTCFullYear(), now.getUTCMonth() + 1];
  const monday = (() => { const d = new Date(`${today}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); })();

  const show = {
    classes: !hidden("/panel/mark-attendance"), attendance: !hidden("/panel/attendance"), leave: !hidden("/panel/leave"),
    teaching: !hidden("/panel/teaching"), mid: !hidden("/panel/mid-bank"), cie: !hidden("/panel/cea"), adjustments: !hidden("/leave/adjustments"),
  };

  const periods = useHomeQuery<{ periods?: Period[]; noClassReason?: string }>(uid, "periods", "/api/college/student-attendance/today-periods", show.classes);
  const myAtt = useHomeQuery<AttendanceMonth>(uid, "attendance", `/api/college/attendance?year=${y}&month=${m}`, show.attendance);
  const balances = useHomeQuery<{ leaveTypes?: Balance[] }>(uid, "leave", "/api/leave/balances", show.leave);
  const adjustments = useHomeQuery<{ items?: unknown[] }>(uid, "adjustments", "/api/leave/adjustment-requests", show.adjustments);
  const mid = useHomeQuery<{ items?: MidBankListItem[] }>(uid, "mid", "/api/college/mid-question-banks", show.mid);
  const cie = useHomeQuery<{ assignments?: CeaAssignment[] }>(uid, "cie", "/api/college/cea/marks", show.cie);
  const duties = useHomeQuery<{ duties?: Duty[] }>(uid, "duties", "/api/college/invigilation/my", true);
  const mids = useHomeQuery<{ timetables?: MidTimetable[] }>(uid, "mids", "/api/college/mid-timetables/published", true);
  const teaching = useHomeQuery<{ assignments?: TeachingAssignment[] }>(uid, "teaching", `/api/college/teaching-assignments?week=${monday}`, show.teaching);

  const todays = [...(periods.data?.periods ?? [])].sort((a, b) => a.startTime.localeCompare(b.startTime));
  const nowMin = now.getUTCHours() * 60 + now.getUTCMinutes();
  const todayRec = (myAtt.data?.records ?? []).find((r) => recordDate(r.date) === today);

  // Things waiting on the faculty member - only what is actually pending.
  const attention: { key: string; tone: "red" | "amber" | "blue"; text: ReactNode; href: string; action: string }[] = [];
  const notMarked = todays.filter((p) => p.isOpen && p.sessionStatus !== "SUBMITTED" && !p.unavailableMessage && nowMin >= minutesOf(p.endTime));
  if (notMarked.length) attention.push({ key: "att", tone: "red", href: "/panel/mark-attendance", action: "Mark now",
    text: <>Attendance not marked for {notMarked.map((p) => `P${p.periodNumber} ${p.sectionName}`).join(", ")}</> });
  const midTodo = (mid.data?.items ?? []).filter((i) => !i.deadline.locked && (i.myBank ? i.myBank.status !== "COMPLETE" : i.uncovered.length > 0))
    .sort((a, b) => a.deadline.deadline.localeCompare(b.deadline.deadline));
  for (const i of midTodo.slice(0, 2)) attention.push({ key: `mid-${i.key}`, tone: "amber", href: "/panel/mid-bank", action: i.myBank ? "Continue" : "Start",
    text: <>Mid {i.deadline.midNumber} paper - {i.subject.name} ({i.branch}){i.myBank ? ` · ${i.myBank.completeCount}/${i.myBank.totalCount} done` : ""} · {deadlineLabel(i.deadline.deadline)}</> });
  const cieDraft = (cie.data?.assignments ?? []).flatMap((a) => a.units.filter((u) => u.status === "DRAFT").map((u) => `${a.subjectName} ${a.section} Unit ${u.unit}`));
  if (cieDraft.length) attention.push({ key: "cie", tone: "amber", href: "/panel/cea", action: "Submit",
    text: <>CIE marks not submitted: {cieDraft.slice(0, 3).join(", ")}{cieDraft.length > 3 ? ` +${cieDraft.length - 3} more` : ""}</> });
  const adj = adjustments.data?.items?.length ?? 0;
  if (adj) attention.push({ key: "adj", tone: "blue", href: "/leave/adjustments", action: "Review", text: <>{adj} adjustment request{adj === 1 ? "" : "s"} waiting on you</> });
  const nextDuties = (duties.data?.duties ?? []).filter((d) => d.date >= today && !["CANCELLED", "REASSIGNED"].includes(d.status));
  const unack = nextDuties.filter((d) => d.status === "PUBLISHED");
  if (unack.length) attention.push({ key: "duty", tone: "blue", href: "/panel/invigilation", action: "Acknowledge",
    text: <>Invigilation duty {dayText(unack[0].date)} {unack[0].from}{unack[0].room ? ` · Room ${unack[0].room}` : ""}{unack.length > 1 ? ` (+${unack.length - 1} more)` : ""}</> });

  // Coming up: Mid exams of the subjects they teach, invigilation, holiday tomorrow.
  const upcoming: { key: string; when: string; text: string }[] = [];
  const midDates = (mids.data?.timetables ?? []).flatMap((t) => t.slots.filter((s) => s.date >= today).map((s) => ({ date: s.date, mid: t.midNumber })));
  if (midDates.length) {
    const first = midDates.sort((a, b) => a.date.localeCompare(b.date))[0];
    upcoming.push({ key: "mid", when: first.date, text: `Mid ${first.mid} examinations begin` });
  }
  for (const d of nextDuties.slice(0, 2)) upcoming.push({ key: `d-${d.id}`, when: d.date, text: `Invigilation ${d.from}-${d.to}${d.room ? `, Room ${d.room}` : ""}` });

  const sum = myAtt.data?.summary;
  // Days present this month: the month's summary, else counted from the day records (half days as half).
  const presentDays = sum?.present ?? (myAtt.data?.records ?? []).reduce((n, r) => n + (r.status === "PRESENT" ? 1 : r.status === "HALF_DAY" ? 0.5 : 0), 0);
  const lateCount = (myAtt.data?.records ?? []).filter((r) => r.status === "PRESENT" && r.checkIn && !r.permittedCheckInTime && minutesOf(r.checkIn) > minutesOf(r.lateAfter || "09:05")).length;
  const current = (teaching.data?.assignments ?? []).filter((a) => !a.isPast && a.accessLevel !== "secondary");
  const hours = current.reduce((n, a) => n + (a.hoursPerWeek ?? 0), 0);
  const subjects = new Set(current.map((a) => a.subjectId)).size;
  const seatRoles = user ? (user.roles ?? user.seatRoles ?? []).filter((r) => r !== user.role) : [];
  const hour = now.getUTCHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const done = todays.filter((p) => p.sessionStatus === "SUBMITTED").length;

  const actions = [
    { href: "/panel/mark-attendance", label: "Mark Attendance", icon: ClipboardCheck },
    { href: "/panel/leave", label: "Apply Leave", icon: CalendarDays },
    { href: "/panel/teaching", label: "My Timetable", icon: BookOpen },
    { href: "/panel/mid-bank", label: "Mid Question Papers", icon: FileText },
    { href: "/panel/cea", label: "CIE Marks", icon: GraduationCap },
    { href: "/payslips", label: "My Payslips", icon: Receipt },
  ].filter((a) => !hidden(a.href));

  return (
    <div className="space-y-5">
      {/* Header: greeting, date, check-in */}
      <div className="rounded-2xl bg-gradient-to-br from-primary to-blue-700 p-5 text-primary-foreground shadow-sm sm:p-6">
        <p className="text-sm opacity-80">{now.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })}</p>
        <h1 className="mt-1 text-2xl font-bold sm:text-3xl">{greeting}, {user?.name ?? "Faculty"}</h1>
        <p className="text-sm opacity-80">{user?.department ? `${user.department} Department` : "Faculty"}</p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {show.attendance && (todayRec?.checkIn ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-sm"><CheckCircle2 className="h-4 w-4" />Checked in {hhmm12(todayRec.checkIn)}{todayRec.checkOut ? ` · out ${hhmm12(todayRec.checkOut)}` : ""}</span>
          ) : myAtt.isSuccess ? (
            <Button asChild size="sm" variant="secondary"><Link href="/panel/attendance"><LogIn className="mr-1.5 h-4 w-4" />Check In</Link></Button>
          ) : null)}
          {show.classes && periods.isSuccess && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-sm"><Clock className="h-4 w-4" />
              {todays.length ? `${todays.length} class${todays.length === 1 ? "" : "es"} today · ${done} marked` : periods.data?.noClassReason ? `No classes today - ${periods.data.noClassReason}` : "No classes today"}
            </span>
          )}
        </div>
      </div>

      {extraAttention}

      <div className="grid gap-5 lg:grid-cols-5">
        {/* Today's classes */}
        {show.classes && (
          <Card className="rounded-2xl lg:col-span-3"><CardContent className="p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="flex items-center gap-2 font-semibold"><CalendarClock className="h-4 w-4 text-primary" />Today&apos;s Classes</h2>
              <Link href="/panel/mark-attendance" className="text-xs text-primary hover:underline">Mark Attendance</Link>
            </div>
            {periods.isLoading ? <div className="h-32 animate-pulse rounded-lg bg-muted" /> : todays.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">{periods.data?.noClassReason ? `No classes today - ${periods.data.noClassReason}.` : "No classes on your timetable today."}</p>
            ) : (
              <ol className="relative space-y-2 border-l-2 border-muted pl-4">
                {todays.map((p) => {
                  const live = nowMin >= minutesOf(p.startTime) && nowMin < minutesOf(p.endTime);
                  const marked = p.sessionStatus === "SUBMITTED";
                  const over = nowMin >= minutesOf(p.endTime);
                  const state = marked ? { t: "Marked", c: "bg-emerald-100 text-emerald-800" } : live ? { t: "Now", c: "bg-blue-100 text-blue-800" }
                    : over ? { t: p.isOpen ? "Not marked" : "Closed", c: p.isOpen ? "bg-red-100 text-red-800" : "bg-muted text-muted-foreground" } : { t: "Later", c: "bg-muted text-muted-foreground" };
                  return (
                    <li key={`${p.assignmentId}_${p.periodNumber}`} className={`relative rounded-lg border p-3 ${live ? "border-primary bg-primary/5" : ""}`}>
                      <span className={`absolute -left-[1.4rem] top-4 h-3 w-3 rounded-full border-2 border-background ${marked ? "bg-emerald-500" : live ? "bg-primary" : "bg-muted-foreground/40"}`} />
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-xs text-muted-foreground">{hhmm12(p.startTime)} - {hhmm12(p.endTime)} · P{p.periodNumber}{p.classroom ? ` · ${p.classroom}` : ""}</p>
                          <p className="truncate font-medium">{p.subjectName}</p>
                          <p className="text-xs text-muted-foreground">Section {p.sectionName}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${state.c}`}>{state.t}</span>
                          {!marked && p.isOpen && !p.unavailableMessage && (
                            <Button asChild size="sm" variant={live ? "default" : "outline"}><Link href="/panel/mark-attendance">Mark</Link></Button>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </CardContent></Card>
        )}

        {/* Needs your attention */}
        <Card className={`rounded-2xl ${show.classes ? "lg:col-span-2" : "lg:col-span-5"}`}><CardContent className="p-5">
          <h2 className="mb-3 flex items-center gap-2 font-semibold"><AlertCircle className="h-4 w-4 text-amber-600" />Needs Your Attention</h2>
          {attention.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-6 text-center text-sm text-muted-foreground">
              <Sparkles className="h-6 w-6 text-emerald-500" />You&apos;re all caught up.
            </div>
          ) : (
            <ul className="space-y-2">
              {attention.map((a) => (
                <li key={a.key} className={`flex items-start justify-between gap-3 rounded-lg border-l-4 bg-muted/30 p-3 text-sm ${a.tone === "red" ? "border-l-red-500" : a.tone === "amber" ? "border-l-amber-500" : "border-l-blue-500"}`}>
                  <span>{a.text}</span>
                  <Link href={a.href} className="shrink-0 text-xs font-medium text-primary hover:underline">{a.action}</Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent></Card>
      </div>

      {/* Numbers */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {show.attendance && (
          <Stat href="/panel/attendance" icon={<UserCheck className="h-5 w-5" />} tone="bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" label="My Attendance This Month"
            value={myAtt.data ? `${presentDays}${sum?.totalWorkingDays ? ` / ${sum.totalWorkingDays}` : ""} days present` : myAtt.isLoading ? "..." : "-"}
            sub={myAtt.data ? `${lateCount} late${sum?.onLeave ? ` · ${sum.onLeave} on leave` : ""}` : undefined} />
        )}
        {show.leave && (
          <Stat href="/panel/leave" icon={<CalendarDays className="h-5 w-5" />} tone="bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300" label="Leave Balance"
            value={balances.data?.leaveTypes?.length ? balances.data.leaveTypes.filter((b) => !b.unlimited).map((b) => `${b.code} ${b.remaining ?? 0}`).join(" · ") || "-" : balances.isLoading ? "..." : "Not set"}
            />
        )}
        {show.teaching && (
          <Stat href="/panel/teaching" icon={<BookOpen className="h-5 w-5" />} tone="bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300" label="Teaching Load"
            value={teaching.data ? `${hours} hrs / week` : teaching.isLoading ? "..." : "-"} sub={teaching.data ? `${subjects} subject${subjects === 1 ? "" : "s"} · ${current.length} class${current.length === 1 ? "" : "es"}` : undefined} />
        )}
        {show.classes && (
          <Stat href="/panel/mark-attendance" icon={<ClipboardCheck className="h-5 w-5" />} tone="bg-sky-50 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300" label="Classes Today"
            value={periods.data ? `${done} / ${todays.length} marked` : periods.isLoading ? "..." : "-"} sub={notMarked.length ? `${notMarked.length} not marked` : undefined} />
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Coming up */}
        {upcoming.length > 0 && (
          <Card className="rounded-2xl"><CardContent className="p-5">
            <h2 className="mb-3 flex items-center gap-2 font-semibold"><CalendarDays className="h-4 w-4 text-primary" />Coming Up</h2>
            <ul className="space-y-2">
              {upcoming.sort((a, b) => a.when.localeCompare(b.when)).map((u) => (
                <li key={u.key} className="flex items-center gap-3 text-sm">
                  <span className="w-24 shrink-0 rounded-md bg-muted px-2 py-1 text-center text-xs font-medium">{dayText(u.when)}</span>
                  <span>{u.text}</span>
                </li>
              ))}
            </ul>
          </CardContent></Card>
        )}

        {/* Quick actions */}
        {actions.length > 0 && (
          <Card className={`rounded-2xl ${upcoming.length ? "" : "lg:col-span-2"}`}><CardContent className="p-5">
            <h2 className="mb-3 font-semibold">Quick Actions</h2>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {actions.map((a) => (
                <Link key={a.href} href={a.href} className="flex flex-col items-center gap-1.5 rounded-xl border p-3 text-center text-xs font-medium transition-colors hover:border-primary/50 hover:bg-primary/5">
                  <a.icon className="h-5 w-5 text-primary" />{a.label}
                </Link>
              ))}
            </div>
          </CardContent></Card>
        )}
      </div>

      {/* Roles held (seats) */}
      {seatRoles.length > 0 && (
        <Card className="rounded-2xl"><CardContent className="p-5">
          <h2 className="mb-3 flex items-center gap-2 font-semibold"><ShieldCheck className="h-4 w-4 text-primary" />Your Roles</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {seatRoles.map((role) => (
              <Link key={role} href={ROLE_DASHBOARD_PATHS[role] ?? "/"} className="group rounded-lg border p-3 transition-colors hover:border-primary/50">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold">{ROLE_LABELS[role]}</p>
                  <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary" />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{SEAT_BLURB[role] ?? "Open this role's dashboard"}</p>
              </Link>
            ))}
          </div>
        </CardContent></Card>
      )}
    </div>
  );
}

function Stat({ href, icon, tone, label, value, sub }: { href: string; icon: ReactNode; tone: string; label: string; value: string; sub?: string }) {
  return (
    <Link href={href}>
      <Card className="h-full rounded-2xl transition-colors hover:border-primary/50"><CardContent className="flex items-start gap-3 p-4">
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tone}`}>{icon}</span>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="truncate text-base font-bold">{value}</p>
          {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
        </div>
      </CardContent></Card>
    </Link>
  );
}
