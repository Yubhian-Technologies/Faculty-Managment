"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CalendarClock, CalendarX2, Percent, RefreshCw, TrendingDown, UserX } from "lucide-react";
import { Bar, Kpi, Panel, Tag, TrendChart, fmtPct, getJson } from "@/components/dashboard/DashboardParts";
import { StudentQuickPanel } from "@/components/students/hod/StudentsOverview";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/PageHeader";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { downloadTableXlsx } from "@/lib/attendance/tableExport";
import { cn, dmy } from "@/lib/utils";
import { toast } from "@/hooks/useToast";

// Student Attendance > Dashboard (HOD: their department tree; Principal / VP: the college). Figures from
// GET /api/college/student-attendance/dashboard (lib/studentAttendance/dashboardServer.ts); "Today So Far" and
// "Not Posted Today" reuse the HOD / Principal dashboard's today figures (same cache).

type Range = "semester" | "month" | "30d" | "custom";
type WatchKey = "critical" | "streak" | "dropped" | "below";

interface WatchRow { studentId: string; sectionId: string; name: string; rollNumber: string; section: string; department: string; pct: number | null; change: number | null; streak: number; mentor: string | null; mobile: string | null; held: number; attended: number }
interface DashData {
  today: string; from: string | null; to: string;
  options: { id: string; label: string; name: string; department: string; year: number }[];
  kpis: { todayPct: number | null; rangePct: number | null; students: number; below: number; critical: number; absentToday: number; streaks: number; drops: number };
  trend: { date: string; pct: number }[];
  weekdays: { day: number; pct: number | null }[];
  periods: { period: number; pct: number | null; marked: number }[];
  subjects: { id: string; name: string; code: string; faculty: string[]; sections: number; pct: number }[];
  sections: { id: string; label: string; department: string; year: number; strength: number; classes: number; pct: number | null; todayPct: number | null; below: number; change: number | null }[];
  watch: Record<WatchKey, WatchRow[]>;
}
interface TodayData {
  classes: { cells: Record<string, { status: string }>; overdue: { section: string; sectionDepartment?: string; period: number; subject: string; faculty: string; end: string }[] };
}

const RANGES: { key: Range; label: string }[] = [
  { key: "semester", label: "This Semester" }, { key: "month", label: "This Month" }, { key: "30d", label: "Last 30 Days" }, { key: "custom", label: "Pick Dates" },
];
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const ALL = "all";

export function StudentAttendanceDashboard({ scope }: { scope: "hod" | "college" }) {
  const router = useRouter();
  const [range, setRange] = useState<Range>("semester");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [department, setDepartment] = useState(ALL);
  const [year, setYear] = useState(ALL);
  const [sectionId, setSectionId] = useState(ALL);
  const [watchKey, setWatchKey] = useState<WatchKey>("critical");
  const [panel, setPanel] = useState<WatchRow | null>(null);
  const [fresh, setFresh] = useState(0);

  const customReady = range !== "custom" || (!!from && !!to && from <= to);
  const params = new URLSearchParams({ range });
  if (range === "custom") { params.set("from", from); params.set("to", to); }
  if (department !== ALL) params.set("department", department);
  if (year !== ALL) params.set("year", year);
  if (sectionId !== ALL) params.set("sectionId", sectionId);
  const qs = params.toString();

  const dash = useQuery({
    queryKey: ["sadash", scope, qs, fresh],
    queryFn: () => getJson<DashData>(`/api/college/student-attendance/dashboard?${qs}${fresh ? "&fresh=1" : ""}`),
    enabled: customReady,
    staleTime: 5 * 60_000,
    placeholderData: (prev) => prev,
  });
  const todayQ = useQuery({
    queryKey: [scope === "hod" ? "hdash" : "pdash2", "today", dash.data?.today ?? ""],
    queryFn: () => getJson<TodayData>(scope === "hod" ? "/api/college/hod/dashboard?part=today" : "/api/college/principal/dashboard?part=today"),
    enabled: !!dash.data,
    staleTime: 60_000,
  });

  const d = dash.data;
  const options = useMemo(() => d?.options ?? [], [d]);
  const departments = useMemo(() => [...new Set(options.map((o) => o.department))].sort(), [options]);
  const years = useMemo(() => [...new Set(options.filter((o) => department === ALL || o.department === department).map((o) => o.year))].sort((a, b) => a - b), [options, department]);
  const sectionOptions = options.filter((o) => (department === ALL || o.department === department) && (year === ALL || String(o.year) === year));
  const inScope = useMemo(() => new Set(sectionOptions.map((o) => o.id)), [sectionOptions]);
  const labels = useMemo(() => new Set(sectionOptions.map((o) => o.label)), [sectionOptions]);

  // Today's classes for the sections picked: posted / due, and the ones that ended unposted.
  const today = todayQ.data?.classes;
  const cells = today ? Object.entries(today.cells).filter(([k]) => inScope.has(k.split("|")[0]) && (sectionId === ALL || k.startsWith(`${sectionId}|`))) : [];
  const due = cells.filter(([, c]) => c.status !== "UPCOMING").length;
  const posted = cells.filter(([, c]) => c.status === "POSTED").length;
  const pickedLabel = sectionId !== ALL ? options.find((o) => o.id === sectionId)?.label : null;
  const overdue = (today?.overdue ?? []).filter((o) => (pickedLabel ? o.section === pickedLabel : labels.has(o.section)));

  const watch = d?.watch[watchKey] ?? [];
  const showToday = !!d && d.to === d.today;
  const k = d?.kpis;
  const loading = dash.isLoading || !customReady;
  const pickSection = (id: string) => { setSectionId((cur) => (cur === id ? ALL : id)); };

  const exportWatch = async () => {
    if (!d) return;
    const rows = d.watch.below;
    if (!rows.length) { toast({ title: "No students below 75% in this view." }); return; }
    await downloadTableXlsx({
      title: "Attendance Shortage List",
      subtitle: `Below 75% · ${d.from ? dmy(d.from) : ""} to ${dmy(d.to)}`,
      headers: ["Regd. No", "Name", "Section", "Department", "Classes Held", "Attended", "Attendance %", "Mentor", "Mobile"],
      rows: rows.map((r) => [r.rollNumber, r.name, r.section, r.department, r.held, r.attended, r.pct ?? "", r.mentor ?? "", r.mobile ?? ""]),
    }, "attendance-shortage-list.xlsx");
  };

  return (
    <div className="space-y-4">
      <PageHeader title="Student Attendance" description={scope === "hod" ? "How your department's students are attending - by day, section, subject and student." : "How the college's students are attending - by day, department, section, subject and student."} />
      <div className="flex flex-wrap items-end gap-3 rounded-2xl border bg-card p-3 shadow-sm">
        {scope === "college" || departments.length > 1 ? (
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">Department
            <Select value={department} onValueChange={(v) => { setDepartment(v); setYear(ALL); setSectionId(ALL); }}>
              <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All departments</SelectItem>
                {departments.map((x) => <SelectItem key={x} value={x}>{x}</SelectItem>)}
              </SelectContent>
            </Select>
          </label>
        ) : null}
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">Year
          <Select value={year} onValueChange={(v) => { setYear(v); setSectionId(ALL); }}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All years</SelectItem>
              {years.map((y) => <SelectItem key={y} value={String(y)}>Year {y}</SelectItem>)}
            </SelectContent>
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">Section
          <Select value={sectionId} onValueChange={setSectionId}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>All sections</SelectItem>
              {sectionOptions.map((o) => <SelectItem key={o.id} value={o.id}>{o.label}{departments.length > 1 ? ` · ${o.department}` : ""}</SelectItem>)}
            </SelectContent>
          </Select>
        </label>
        <div className="flex flex-col gap-1 text-xs text-muted-foreground">Period
          <div className="flex flex-wrap gap-1">
            {RANGES.map((r) => (
              <Button key={r.key} size="sm" variant={range === r.key ? "default" : "outline"} onClick={() => setRange(r.key)}>{r.label}</Button>
            ))}
          </div>
        </div>
        {range === "custom" && (
          <div className="flex items-end gap-2">
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">From<Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" /></label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">To<Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" /></label>
          </div>
        )}
        <Button size="sm" variant="ghost" className="ml-auto" disabled={dash.isFetching} onClick={() => setFresh((n) => n + 1)}>
          <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", dash.isFetching && "animate-spin")} />Refresh
        </Button>
      </div>
      {d && <p className="px-1 text-xs text-muted-foreground">{d.from ? `${dmy(d.from)} to ${dmy(d.to)}` : `Up to ${dmy(d.to)}`} · counted the same way as the reports (from each student&apos;s Date of Joining, on duty left out)</p>}
      {dash.isError && <p className="text-sm text-destructive">Unable to load the dashboard. Try again; if it continues, contact the administrator.</p>}

      <section aria-label="Key numbers" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {showToday || loading ? (
          <Kpi icon={CalendarClock} label="Today So Far" loading={loading || todayQ.isLoading} value={fmtPct(k?.todayPct)} sub={today ? `${posted} of ${due} classes posted` : undefined} />
        ) : null}
        <Kpi icon={Percent} label={RANGES.find((r) => r.key === range)?.label ?? "Period"} loading={loading} value={fmtPct(k?.rangePct)} sub={k ? `${k.students} students` : undefined} />
        <Kpi icon={AlertTriangle} tone="crit" label="Below 75%" loading={loading} value={k?.below ?? "-"} sub={k ? `${k.critical} below 65%` : undefined} onOpen={() => setWatchKey("below")} />
        {(showToday || loading) && <Kpi icon={CalendarX2} label="Absent All Day" loading={loading} value={k?.absentToday ?? "-"} sub="absent in every period so far" />}
        <Kpi icon={UserX} label="Absent 3+ Days Running" loading={loading} value={k?.streaks ?? "-"} sub={k ? `${k.drops} dropped 10+ points` : undefined} onOpen={() => setWatchKey("streak")} />
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Daily Attendance" sub="each class day · dashed line at 75%" loading={loading}>
          <TrendChart points={d?.trend ?? []} />
          <div className="mt-3 grid grid-cols-6 gap-1.5">
            {(d?.weekdays ?? []).map((w) => {
              const low = d && w.pct != null && d.weekdays.filter((x) => x.pct != null).every((x) => (x.pct ?? 0) >= w.pct!);
              return (
                <div key={w.day} className={cn("rounded-md py-1 text-center text-xs text-muted-foreground", low && "bg-amber-50 dark:bg-amber-950/30")}>
                  {WEEKDAY[w.day]}<b className={cn("block text-sm tabular-nums", low ? "text-amber-800 dark:text-amber-300" : "text-foreground")}>{w.pct == null ? "-" : `${Math.round(w.pct)}%`}</b>
                </div>
              );
            })}
          </div>
        </Panel>

        {showToday ? (
          <Panel title="Today by Period" sub="present out of marked, on duty left out" loading={loading}>
            {d && d.periods.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">No attendance posted yet today.</p> : (
              <div className="space-y-2">
                {(d?.periods ?? []).map((p) => {
                  const lowest = d!.periods.every((x) => (x.pct ?? 101) >= (p.pct ?? 101));
                  return <Bar key={p.period} label={`P${p.period}`} value={p.pct ?? 0} text={fmtPct(p.pct)} sub={`${p.marked} marked`} refLine={75} low={(p.pct ?? 100) < 75} title={lowest ? "Lowest period today" : undefined} />;
                })}
              </div>
            )}
          </Panel>
        ) : (
          <Panel title="Subjects Compared" sub="lowest first" loading={loading}>
            <SubjectList subjects={d?.subjects ?? []} />
          </Panel>
        )}
      </div>

      <Panel title="Sections Compared" sub="lowest first · choose a section to filter the dashboard" loading={loading}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead><tr className="text-left text-xs text-muted-foreground">
              <th className="px-2 py-2 font-medium">Section</th><th className="px-2 py-2 font-medium">Department</th>
              {showToday && <th className="px-2 py-2 font-medium">Today</th>}
              <th className="px-2 py-2 font-medium">Attendance</th><th className="px-2 py-2 font-medium">Classes</th><th className="px-2 py-2 font-medium">Below 75%</th><th className="px-2 py-2 font-medium">Last 7 Days vs Week Before</th>
            </tr></thead>
            <tbody className="divide-y">
              {(d?.sections ?? []).filter((s) => s.classes > 0).map((s) => (
                <tr key={s.id} className={cn("cursor-pointer hover:bg-muted/40", sectionId === s.id && "bg-primary/5")} onClick={() => pickSection(s.id)}>
                  <td className="px-2 py-2.5"><button type="button" className="font-semibold hover:underline">{s.label}</button><span className="ml-1.5 text-xs text-muted-foreground">{s.strength}</span></td>
                  <td className="px-2 py-2.5 text-muted-foreground">{s.department}</td>
                  {showToday && <td className="px-2 py-2.5 tabular-nums">{fmtPct(s.todayPct)}</td>}
                  <td className="px-2 py-2.5"><div className="w-56 max-w-full"><Bar label="" value={s.pct ?? 0} text={fmtPct(s.pct)} refLine={75} low={(s.pct ?? 100) < 75} /></div></td>
                  <td className={cn("px-2 py-2.5 tabular-nums", s.classes < 10 && "text-amber-700 dark:text-amber-400")} title={s.classes < 10 ? "Few classes posted - the % rests on very little" : undefined}>{s.classes}</td>
                  <td className={cn("px-2 py-2.5 font-semibold tabular-nums", s.below > 0 && "text-red-700 dark:text-red-400")}>{s.below}</td>
                  <td className="px-2 py-2.5"><Change value={s.change} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {d && d.sections.every((s) => s.classes === 0) && <p className="py-6 text-center text-sm text-muted-foreground">No attendance posted in this period for these sections.</p>}
          {d && d.sections.some((s) => s.classes === 0) && d.sections.some((s) => s.classes > 0) && (
            <p className="pt-2 text-xs text-muted-foreground" title={d.sections.filter((s) => s.classes === 0).map((s) => s.label).join(", ")}>
              {d.sections.filter((s) => s.classes === 0).length} more section{d.sections.filter((s) => s.classes === 0).length === 1 ? " has" : "s have"} no attendance posted in this period.
            </p>
          )}
        </div>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        {showToday && (
          <Panel title="Subjects Compared" sub="lowest first" loading={loading}>
            <SubjectList subjects={d?.subjects ?? []} />
          </Panel>
        )}
        {showToday && (
          <Panel title="Not Posted Today" sub="classes that ended without attendance" loading={todayQ.isLoading}>
            <p className="text-3xl font-bold tabular-nums text-amber-700 dark:text-amber-400">{overdue.length}</p>
            <ul className="mt-2 max-h-64 space-y-1.5 overflow-y-auto text-sm">
              {overdue.map((o, i) => (
                <li key={i} className="flex justify-between gap-2"><span>{o.section} · P{o.period} · {o.subject}<span className="text-muted-foreground"> · {o.faculty}</span></span><span className="shrink-0 text-xs text-muted-foreground">ended {o.end}</span></li>
              ))}
              {today && overdue.length === 0 && <li className="text-muted-foreground">Every class that has ended is posted.</li>}
            </ul>
          </Panel>
        )}
      </div>

      <Panel title="Watch List" sub="choose a student to see subject-wise attendance" loading={loading}>
        <div className="mb-3 flex flex-wrap items-center gap-1.5">
          {([["critical", "Below 65%", d?.watch.critical.length], ["streak", "Absent 3+ Days", d?.watch.streak.length], ["dropped", "Dropped 10+ Points", d?.watch.dropped.length], ["below", "Below 75%", d?.watch.below.length]] as [WatchKey, string, number | undefined][]).map(([key, label, n]) => (
            <button key={key} type="button" onClick={() => setWatchKey(key)}
              className={cn("rounded-full border px-3 py-1 text-xs font-medium", watchKey === key ? "border-foreground bg-foreground text-background" : "bg-card hover:border-primary")}>
              {label} <span className="opacity-70">{n ?? 0}</span>
            </button>
          ))}
          <Button size="sm" variant="outline" className="ml-auto" onClick={() => void exportWatch()}>Shortage List (Excel)</Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead><tr className="text-left text-xs text-muted-foreground">
              {["Regd. No", "Name", "Section", "Attendance", "Last 2 Weeks", "Absent Days Running", "Mentor", "Mobile"].map((h) => <th key={h} className="px-2 py-2 font-medium">{h}</th>)}
            </tr></thead>
            <tbody className="divide-y">
              {watch.slice(0, 200).map((w) => (
                <tr key={w.studentId} className="cursor-pointer hover:bg-muted/40" onClick={() => setPanel(w)}>
                  <td className="px-2 py-2 tabular-nums">{w.rollNumber || "-"}</td>
                  <td className="px-2 py-2"><button type="button" className="font-medium hover:underline">{w.name}</button></td>
                  <td className="px-2 py-2">{w.section}</td>
                  <td className={cn("px-2 py-2 font-semibold tabular-nums", (w.pct ?? 100) < 75 && "text-red-700 dark:text-red-400")}>{fmtPct(w.pct)}</td>
                  <td className="px-2 py-2"><Change value={w.change} /></td>
                  <td className="px-2 py-2 tabular-nums">{w.streak > 0 ? w.streak : "-"}</td>
                  <td className="px-2 py-2">{w.mentor ?? <span className="text-amber-700 dark:text-amber-400">Not assigned</span>}</td>
                  <td className="px-2 py-2 tabular-nums">{w.mobile ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {d && watch.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No students in this list.</p>}
          {watch.length > 200 && <p className="pt-2 text-xs text-muted-foreground">Showing 200 of {watch.length}. The Excel download has every student below 75%.</p>}
        </div>
      </Panel>

      <StudentQuickPanel
        studentId={panel?.studentId ?? null}
        info={panel ? { r: panel.rollNumber, n: panel.name, s: panel.section, p: null, m: panel.mentor, mob: panel.mobile ?? "", adm: "", g: "" } : null}
        onClose={() => setPanel(null)}
        onOpenProfile={(id) => router.push(scope === "hod" ? `/hod/students/${id}` : `/principal/students/${id}`)}
        onOpenAttendance={(id) => router.push(scope === "hod" ? `/hod/students/${id}/attendance?name=${encodeURIComponent(panel?.name ?? "")}` : `/principal/students/${id}`)}
      />
    </div>
  );
}

function Change({ value }: { value: number | null }) {
  if (value == null) return <span className="text-muted-foreground">-</span>;
  if (value === 0) return <span className="text-muted-foreground">No change</span>;
  return value > 0
    ? <Tag tone="good">Up {value.toFixed(1)}</Tag>
    : <span className="inline-flex items-center gap-1"><TrendingDown className="h-3.5 w-3.5 text-red-600" aria-hidden="true" /><Tag tone="crit">Down {Math.abs(value).toFixed(1)}</Tag></span>;
}

function SubjectList({ subjects }: { subjects: DashData["subjects"] }) {
  if (subjects.length === 0) return <p className="py-8 text-center text-sm text-muted-foreground">No attendance posted in this period.</p>;
  return (
    <div className="max-h-80 space-y-3 overflow-y-auto pr-1">
      {subjects.map((s) => (
        <div key={s.id}>
          <div className="flex justify-between gap-2 text-sm">
            <span className="min-w-0"><b>{s.name || s.code}</b> <span className="text-xs text-muted-foreground">· {s.faculty.slice(0, 2).join(", ")}{s.faculty.length > 2 ? ` +${s.faculty.length - 2}` : ""} · {s.sections} section{s.sections === 1 ? "" : "s"}</span></span>
            <b className={cn("shrink-0 tabular-nums", s.pct < 75 && "text-red-700 dark:text-red-400")}>{fmtPct(s.pct)}</b>
          </div>
          <div className="mt-1 h-2 rounded bg-muted"><div className="h-2 rounded" style={{ width: `${Math.min(100, s.pct)}%`, background: s.pct < 75 ? "#d03b3b" : "var(--primary)" }} /></div>
        </div>
      ))}
    </div>
  );
}
