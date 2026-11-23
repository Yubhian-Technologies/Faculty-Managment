"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarX2, GraduationCap, LayoutGrid, Tags } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

// HOD Students page overview (GET /api/college/hod/students-overview): number cards, one card per section, quick
// filters and - for a picked filter or section - its own focused list. The per-student figures (today, semester %,
// mentor, mobile) also feed the main table's columns (onData). A row opens StudentQuickPanel.

export interface OverviewStudent { r: string; n: string; s: string; t: "P" | "A" | "OD" | null; p: number | null; m: string | null; mob: string; adm: string; g: string }
interface OverviewSection { key: string; name: string; department: string; year: number; strength: number; mentored: number; todayPct: number | null; semesterPct: number | null; below: number; incharge: string }
interface Overview {
  kpis: { total: number; boys: number; girls: number; admission: Record<string, number>; below75: number; below65: number; absentToday: number; onDutyToday: number; noMobile: number; noMentor: number; noSection: number };
  sections: OverviewSection[];
  students: Record<string, OverviewStudent>;
  order: string[];
}

type Chip = "low" | "absent" | "nomentor" | "nosection" | `adm:${string}`;
const SHORT = 75;
const fmt = (p: number | null) => (p == null ? "-" : `${p.toFixed(1)}%`);

export function TodayMark({ t }: { t: OverviewStudent["t"] | undefined }) {
  if (t === "P") return <span className="inline-grid h-6 w-6 place-items-center rounded-md bg-emerald-50 text-xs font-bold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">P</span>;
  if (t === "A") return <span className="inline-grid h-6 w-6 place-items-center rounded-md bg-red-50 text-xs font-bold text-red-700 dark:bg-red-950/40 dark:text-red-300">A</span>;
  if (t === "OD") return <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">OD</span>;
  return <span className="text-xs text-muted-foreground">Not yet</span>;
}
export const PctCell = ({ p }: { p: number | null | undefined }) =>
  p == null ? <span className="text-muted-foreground/60">-</span> : <span className={cn("font-semibold tabular-nums", p < SHORT && "text-red-600")}>{p.toFixed(1)}%</span>;
export const Missing = ({ children }: { children: React.ReactNode }) =>
  <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">{children}</span>;

function Kpi({ icon: Icon, label, value, sub, tone, onClick, active, children }: {
  icon: typeof GraduationCap; label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: "crit" | "warn"; onClick?: () => void; active?: boolean; children?: React.ReactNode;
}) {
  return (
    <button type="button" onClick={onClick} disabled={!onClick}
      className={cn("flex flex-col gap-1.5 rounded-2xl border bg-card p-4 text-left shadow-sm transition", onClick && "hover:border-primary", active && "border-primary ring-1 ring-primary")}>
      <span className="flex items-start justify-between gap-2 text-xs font-medium text-muted-foreground">
        <span>{label}</span>
        <span className={cn("grid h-7 w-7 shrink-0 place-items-center rounded-lg", tone === "crit" ? "bg-red-50 text-red-600 dark:bg-red-950/40" : tone === "warn" ? "bg-amber-50 text-amber-700 dark:bg-amber-950/40" : "bg-primary/10 text-primary")}><Icon className="h-3.5 w-3.5" /></span>
      </span>
      <span className={cn("text-2xl font-bold tabular-nums", tone === "crit" && "text-red-600", tone === "warn" && "text-amber-700 dark:text-amber-400")}>{value}</span>
      {children}
      {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
    </button>
  );
}

function Bar({ parts }: { parts: { n: number; className: string }[] }) {
  const total = parts.reduce((a, p) => a + p.n, 0);
  if (!total) return null;
  return <span className="flex h-1.5 gap-0.5 overflow-hidden rounded-full bg-muted">{parts.filter((p) => p.n > 0).map((p, i) => <i key={i} className={cn("block h-full", p.className)} style={{ flex: p.n }} />)}</span>;
}

export function StudentsOverview({ query, reloadKey, onData, onFocusChange, onOpen }: {
  /** The list's filter query (department / coreDepartment / course / year). */
  query: string;
  /** Changes on every Load / Refresh (the list's applied filters). */
  reloadKey: unknown;
  onData: (students: Record<string, OverviewStudent> | null) => void;
  onFocusChange: (active: boolean) => void;
  onOpen: (studentId: string) => void;
}) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [chip, setChip] = useState<Chip | null>(null);
  const [section, setSection] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/college/hod/students-overview?${query}`)
      .then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error ?? "Unable to load the overview."); return j as Overview; })
      .then((j) => { if (live) { setError(""); setData(j); onData(j.students); } })
      .catch((e: Error) => { if (live) { setData(null); onData(null); setError(e.message); } });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, reloadKey]);
  useEffect(() => { onFocusChange(!!chip || !!section); }, [chip, section, onFocusChange]);

  const focused = useMemo(() => {
    if (!data || (!chip && !section)) return [];
    return data.order.filter((id) => {
      const s = data.students[id];
      if (!s) return false;
      if (section && s.s !== section) return false;
      switch (chip) {
        case "low": return s.p != null && s.p < SHORT;
        case "absent": return s.t === "A";
        case "nomentor": return !s.m;
        case "nosection": return !s.s;
        case null: return true;
        default: return chip.startsWith("adm:") ? s.adm === chip.slice(4) : true;
      }
    });
  }, [data, chip, section]);

  if (error) return <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>;
  if (!data) return <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">{Array.from({ length: 5 }, (_, i) => <div key={i} className="h-28 animate-pulse rounded-2xl bg-muted" />)}</div>;

  const k = data.kpis;
  const adm = Object.entries(k.admission).sort((a, b) => b[1] - a[1]);
  const toggle = (c: Chip) => setChip((cur) => (cur === c ? null : c));
  const chips: [Chip, string, number][] = [
    ["low", `Below ${SHORT}%`, k.below75], ["absent", "Absent Today", k.absentToday], ["nomentor", "No Mentor", k.noMentor],
    ...(k.noSection ? [["nosection", "No Section", k.noSection] as [Chip, string, number]] : []),
    ...adm.map(([a, n]) => [`adm:${a}` as Chip, a, n] as [Chip, string, number]),
  ];

  return (
    <div className="space-y-4">
      <section aria-label="Key numbers" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Kpi icon={GraduationCap} label="Total Students" value={k.total} sub={`${k.boys} boys · ${k.girls} girls`}>
          <Bar parts={[{ n: k.boys, className: "bg-primary" }, { n: k.girls, className: "bg-pink-400" }]} />
        </Kpi>
        <Kpi icon={LayoutGrid} label="Sections" value={data.sections.length}
          sub={data.sections.length ? `${data.sections.slice(0, 4).map((s) => `${s.name} ${s.strength}`).join(" · ")}${data.sections.length > 4 ? " ..." : ""}` : "None yet"} />
        <Kpi icon={Tags} label="Admission Type" value={adm.slice(0, 3).map(([, n]) => n).join(" / ") || "-"} sub={adm.slice(0, 3).map(([a]) => a).join(" · ")}>
          <Bar parts={adm.slice(0, 3).map(([, n], i) => ({ n, className: ["bg-primary", "bg-amber-500", "bg-emerald-500"][i] }))} />
        </Kpi>
        <Kpi icon={AlertTriangle} tone="crit" label={`Below ${SHORT}% Attendance`} value={k.below75} active={chip === "low"} onClick={() => toggle("low")}
          sub={k.total ? <>{((k.below75 / k.total) * 100).toFixed(1)}% · {k.below65} below 65%</> : undefined} />
        <Kpi icon={CalendarX2} label="Absent Today" value={k.absentToday} active={chip === "absent"} onClick={() => toggle("absent")}
          sub={`every period so far${k.onDutyToday ? ` · ${k.onDutyToday} on duty` : ""}`} />
      </section>

      {data.sections.length > 0 && (
        <section aria-label="Sections" className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(230px,1fr))]">
          {data.sections.map((s) => (
            <button key={s.key} type="button" onClick={() => setSection((cur) => (cur === s.name ? null : s.name))}
              className={cn("flex flex-col gap-2 rounded-2xl border bg-card p-3.5 text-left shadow-sm transition hover:border-primary", section === s.name && "border-primary ring-1 ring-primary")}>
              <span className="flex items-baseline justify-between gap-2"><span className="font-semibold">{s.name}</span><span className="text-xs text-muted-foreground">{s.strength} students</span></span>
              <span className="grid grid-cols-3 gap-1 text-[11px] text-muted-foreground">
                <span>Today<b className="block text-sm text-foreground tabular-nums">{fmt(s.todayPct)}</b></span>
                <span>Semester<b className={cn("block text-sm tabular-nums", s.semesterPct != null && s.semesterPct < SHORT ? "text-red-600" : "text-foreground")}>{fmt(s.semesterPct)}</b></span>
                <span>Below {SHORT}%<b className={cn("block text-sm tabular-nums", s.below ? "text-red-600" : "text-foreground")}>{s.below}</b></span>
              </span>
              <span className="text-[11px] text-muted-foreground">{s.incharge ? `Class in-charge: ${s.incharge}` : "No class in-charge set"} · Mentors for {s.mentored} of {s.strength}</span>
            </button>
          ))}
        </section>
      )}

      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Quick filters">
        <button type="button" onClick={() => { setChip(null); setSection(null); }}
          className={cn("rounded-full border px-3 py-1 text-xs font-medium", !chip && !section ? "border-foreground bg-foreground text-background" : "bg-card hover:border-primary")}>
          All <span className="opacity-70">{k.total}</span>
        </button>
        {chips.map(([c, label, n]) => (
          <button key={c} type="button" onClick={() => toggle(c)}
            className={cn("rounded-full border px-3 py-1 text-xs font-medium", chip === c ? "border-foreground bg-foreground text-background" : "bg-card hover:border-primary")}>
            {label} <span className="opacity-70">{n}</span>
          </button>
        ))}
        {section && <span className="text-xs text-muted-foreground">Section {section}</span>}
      </div>

      {(chip || section) && (
        <div className="overflow-hidden rounded-lg border">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50"><tr>{["Regd. No", "Name", "Section", "Today", "Attendance", "Mentor", "Mobile"].map((h) => <th key={h} className="whitespace-nowrap px-4 py-3 text-left font-medium text-muted-foreground">{h}</th>)}</tr></thead>
              <tbody className="divide-y">
                {focused.length === 0 ? (
                  <tr><td colSpan={8} className="px-4 py-6 text-center text-muted-foreground">No students match this filter.</td></tr>
                ) : focused.map((id) => {
                  const s = data.students[id];
                  return (
                    <tr key={id} tabIndex={0} role="button" onClick={() => onOpen(id)} onKeyDown={(e) => { if (e.key === "Enter") onOpen(id); }}
                      className="cursor-pointer bg-background hover:bg-muted/30">
                      <td className="whitespace-nowrap px-4 py-2.5 font-medium">{s.r || "-"}</td>
                      <td className="px-4 py-2.5">{s.n}</td>
                      <td className="whitespace-nowrap px-4 py-2.5">{s.s || <Missing>Unassigned</Missing>}</td>
                      <td className="px-4 py-2.5"><TodayMark t={s.t} /></td>
                      <td className="px-4 py-2.5"><PctCell p={s.p} /></td>
                      <td className="whitespace-nowrap px-4 py-2.5">{s.m ?? <Missing>Not assigned</Missing>}</td>
                      <td className="px-4 py-2.5 tabular-nums">{s.mob || <Missing>Missing</Missing>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="border-t px-4 py-2 text-xs text-muted-foreground">{focused.length} student{focused.length === 1 ? "" : "s"} · choose All to go back to the full list</p>
        </div>
      )}
    </div>
  );
}

interface SubjectRow { subjectId: string; subjectName: string; subjectCode: string; held: number; attend: number; percent: number }

/** A student at a glance: the overview's figures plus subject-wise attendance, with links to the full pages. */
export function StudentQuickPanel({ studentId, info, onClose, onOpenProfile, onOpenAttendance, onMove }: {
  studentId: string | null;
  info: OverviewStudent | null;
  onClose: () => void;
  onOpenProfile: (id: string) => void;
  onOpenAttendance: (id: string) => void;
  /** Present when the student's row is on the page (Move Section needs the full row). */
  onMove?: () => void;
}) {
  const [subjects, setSubjects] = useState<SubjectRow[] | null>(null);
  const [total, setTotal] = useState<{ held: number; attend: number; percent: number } | null>(null);
  useEffect(() => {
    if (!studentId) return;
    let live = true;
    fetch(`/api/college/student-attendance-history?studentId=${encodeURIComponent(studentId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { subjects?: SubjectRow[]; total?: { held: number; attend: number; percent: number } } | null) => { if (live) { setSubjects(j?.subjects ?? []); setTotal(j?.total ?? null); } })
      .catch(() => { if (live) setSubjects([]); });
    return () => { live = false; };
  }, [studentId]);

  return (
    <Dialog open={!!studentId} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{info?.n ?? "Student"}</DialogTitle>
          <p className="text-sm text-muted-foreground">{info?.r || "No Regd. No"}{info?.s ? ` · ${info.s}` : ""}</p>
        </DialogHeader>
        {info && (
          <div className="space-y-4 text-sm">
            <div className="flex flex-wrap gap-1.5">
              {info.p != null && <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", info.p < SHORT ? "bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300" : "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300")}>{info.p.toFixed(1)}% this semester</span>}
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">{info.adm}</span>
              {info.g && <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold">{info.g === "F" ? "Female" : "Male"}</span>}
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
              <dt className="text-muted-foreground">Today</dt><dd>{info.t === "P" ? "Present" : info.t === "A" ? "Absent in every period so far" : info.t === "OD" ? "On duty" : "Not marked yet"}</dd>
              <dt className="text-muted-foreground">Mentor</dt><dd>{info.m ?? "Not assigned"}</dd>
              <dt className="text-muted-foreground">Mobile</dt><dd className="tabular-nums">{info.mob || "Missing"}</dd>
            </dl>
            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Subject-wise attendance{total ? ` · ${total.attend}/${total.held} (${total.percent.toFixed(1)}%)` : ""}</p>
              {subjects === null ? <div className="h-16 animate-pulse rounded-lg bg-muted" /> : subjects.length === 0 ? <p className="text-xs text-muted-foreground">No attendance recorded yet.</p> : (
                <ul className="space-y-1.5">
                  {subjects.map((s) => (
                    <li key={s.subjectId} className="grid grid-cols-[minmax(0,1fr)_96px_52px] items-center gap-2 text-xs">
                      <span className="truncate" title={s.subjectName}>{s.subjectName}</span>
                      <span className="h-1.5 overflow-hidden rounded-full bg-muted"><i className={cn("block h-full", s.percent < SHORT ? "bg-red-500" : "bg-emerald-500")} style={{ width: `${Math.min(100, s.percent)}%` }} /></span>
                      <span className={cn("text-right font-semibold tabular-nums", s.percent < SHORT && "text-red-600")}>{s.percent.toFixed(0)}%</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => studentId && onOpenProfile(studentId)}>Open Full Profile</Button>
              <Button size="sm" variant="outline" onClick={() => studentId && onOpenAttendance(studentId)}>Attendance History</Button>
              {onMove && <Button size="sm" variant="outline" onClick={onMove}>Move Section</Button>}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
