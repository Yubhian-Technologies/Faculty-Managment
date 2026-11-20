"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { isLateCheckIn } from "@/lib/attendance/lateStatus";
import type { RosterRow } from "@/lib/dashboard/principalSummary";
import type { ClassCell } from "@/lib/dashboard/hodDashboard";
import { cn } from "@/lib/utils";
import { fmtPct, hhmm12, SHORT, Tag } from "./DashboardParts";

// The full lists behind the HOD / Principal dashboard's number cards. A card click opens one of these with the data
// the dashboard already loaded (nothing extra is fetched), searchable and narrowed by tabs; each has a link to its
// full page for more.

export type KpiDetailKey = "students" | "classes" | "faculty" | "shortage";

export function KpiDetailDialog({ open, onClose, title, sub, pageHref, pageLabel, children }: {
  open: boolean; onClose: () => void; title: string; sub?: string; pageHref?: string; pageLabel?: string; children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="flex max-h-[88vh] w-[calc(100vw-2rem)] flex-col gap-3 sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {sub && <DialogDescription>{sub}</DialogDescription>}
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
        {pageHref && (
          <div className="flex justify-end border-t pt-3">
            <Link href={pageHref} className="text-sm font-medium text-primary hover:underline">{pageLabel ?? "Open the full page"} →</Link>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Shared bits ─────────────────────────────────────────────────────────────

function Tabs<K extends string>({ value, onChange, options }: { value: K; onChange: (k: K) => void; options: { key: K; label: string; count: number }[] }) {
  return (
    <div className="inline-flex flex-wrap gap-0.5 rounded-lg border bg-muted/40 p-0.5 text-xs" role="tablist">
      {options.map((o) => (
        <button key={o.key} type="button" role="tab" aria-selected={value === o.key} onClick={() => onChange(o.key)}
          className={cn("rounded-md px-2.5 py-1 font-medium", value === o.key ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
          {o.label} <span className="tabular-nums opacity-70">{o.count}</span>
        </button>
      ))}
    </div>
  );
}

function Toolbar({ children, search, onSearch, placeholder }: { children?: ReactNode; search: string; onSearch: (v: string) => void; placeholder: string }) {
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
      {children}
      <div className="relative w-full sm:w-64">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={search} onChange={(e) => onSearch(e.target.value)} placeholder={placeholder} className="h-9 pl-8" />
      </div>
    </div>
  );
}

/** A scrolling table with a sticky header. */
function Table({ head, children, empty }: { head: ReactNode; children: ReactNode; empty: boolean }) {
  return (
    <div className="max-h-[58vh] overflow-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-[1] bg-muted text-left text-xs text-muted-foreground">{head}</thead>
        <tbody className="divide-y">{children}</tbody>
      </table>
      {empty && <p className="py-8 text-center text-sm text-muted-foreground">Nothing to show here.</p>}
    </div>
  );
}

const th = "px-3 py-2 font-medium whitespace-nowrap";
const td = "px-3 py-2";
const matches = (q: string, ...parts: (string | number | null | undefined)[]) =>
  !q || parts.some((p) => String(p ?? "").toLowerCase().includes(q));

// ── Student attendance today ────────────────────────────────────────────────

export interface SectionTodayRow { sectionId: string; label: string; department: string; pct: number | null; absentAllDay: number; students: number }
export interface AbsenteeRow { name: string; rollNumber: string; section: string; department: string; periods: number }

export function StudentsTodayDetail({ sections, absentees, showDepartment }: { sections: SectionTodayRow[]; absentees: AbsenteeRow[]; showDepartment?: boolean }) {
  const [tab, setTab] = useState<"sections" | "absent">("sections");
  const [search, setSearch] = useState("");
  const q = search.trim().toLowerCase();
  const secRows = sections.filter((s) => matches(q, s.label, s.department));
  const absRows = absentees.filter((a) => matches(q, a.name, a.rollNumber, a.section, a.department));
  return (
    <>
      <Toolbar search={search} onSearch={setSearch} placeholder={tab === "absent" ? "Search name, Regd. No, section..." : "Search section..."}>
        <Tabs value={tab} onChange={setTab} options={[
          { key: "sections", label: "By Section", count: sections.length },
          { key: "absent", label: "Absent All Day", count: absentees.length },
        ]} />
      </Toolbar>
      {tab === "sections" ? (
        <Table empty={secRows.length === 0} head={<tr><th className={th}>Section</th>{showDepartment && <th className={th}>Department</th>}<th className={cn(th, "text-right")}>Students Marked</th><th className={cn(th, "text-right")}>Attendance</th><th className={cn(th, "text-right")}>Absent All Day</th></tr>}>
          {secRows.map((s) => (
            <tr key={s.sectionId}>
              <td className={cn(td, "font-medium")}>{s.label}</td>
              {showDepartment && <td className={td}>{s.department}</td>}
              <td className={cn(td, "text-right tabular-nums")}>{s.students}</td>
              <td className={cn(td, "text-right tabular-nums", s.pct != null && s.pct < SHORT && "font-semibold text-red-600")}>{fmtPct(s.pct)}</td>
              <td className={cn(td, "text-right tabular-nums")}>{s.absentAllDay}</td>
            </tr>
          ))}
        </Table>
      ) : (
        <Table empty={absRows.length === 0} head={<tr><th className={th}>Regd. No</th><th className={th}>Name</th><th className={th}>Section</th>{showDepartment && <th className={th}>Department</th>}<th className={cn(th, "text-right")}>Periods Absent</th></tr>}>
          {absRows.map((a, i) => (
            <tr key={`${a.section}-${a.rollNumber}-${i}`}>
              <td className={cn(td, "tabular-nums")}>{a.rollNumber || "-"}</td>
              <td className={cn(td, "font-medium")}>{a.name}</td>
              <td className={td}>{a.section}</td>
              {showDepartment && <td className={td}>{a.department}</td>}
              <td className={cn(td, "text-right tabular-nums")}>{a.periods}</td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}

// ── Classes today ───────────────────────────────────────────────────────────

const CLASS_LABEL: Record<ClassCell["status"], ReactNode> = {
  POSTED: <Tag tone="good">Posted</Tag>,
  NOW: <Tag tone="info">Running Now</Tag>,
  OVERDUE: <Tag tone="crit">Not Posted</Tag>,
  UPCOMING: <span className="text-xs text-muted-foreground">Later Today</span>,
};

export function ClassesTodayDetail({ sections, cells, showDepartment }: {
  sections: { id: string; label: string; department: string }[]; cells: Record<string, ClassCell>; showDepartment?: boolean;
}) {
  const rows = useMemo(() => {
    const byId = new Map(sections.map((s, i) => [s.id, { ...s, order: i }]));
    return Object.entries(cells).map(([key, c]) => {
      const [sectionId, p] = key.split("|");
      const s = byId.get(sectionId);
      return { key, period: Number(p), section: s?.label ?? "", department: s?.department ?? "", order: s?.order ?? 9999, ...c };
    }).sort((a, b) => a.period - b.period || a.order - b.order);
  }, [sections, cells]);
  const count = (st: ClassCell["status"]) => rows.filter((r) => r.status === st).length;
  const [tab, setTab] = useState<"OVERDUE" | "NOW" | "POSTED" | "UPCOMING" | "ALL">(count("OVERDUE") > 0 ? "OVERDUE" : "ALL");
  const [search, setSearch] = useState("");
  const q = search.trim().toLowerCase();
  const shown = rows.filter((r) => (tab === "ALL" || r.status === tab) && matches(q, r.section, r.department, r.subject, r.faculty));
  return (
    <>
      <Toolbar search={search} onSearch={setSearch} placeholder="Search section, subject, faculty...">
        <Tabs value={tab} onChange={setTab} options={[
          { key: "OVERDUE", label: "Not Posted", count: count("OVERDUE") },
          { key: "NOW", label: "Running Now", count: count("NOW") },
          { key: "POSTED", label: "Posted", count: count("POSTED") },
          { key: "UPCOMING", label: "Later Today", count: count("UPCOMING") },
          { key: "ALL", label: "All", count: rows.length },
        ]} />
      </Toolbar>
      <Table empty={shown.length === 0} head={<tr><th className={th}>Period</th><th className={th}>Time</th><th className={th}>Section</th>{showDepartment && <th className={th}>Department</th>}<th className={th}>Subject</th><th className={th}>Faculty</th><th className={th}>Status</th></tr>}>
        {shown.map((r) => (
          <tr key={r.key}>
            <td className={cn(td, "font-medium")}>P{r.period}</td>
            <td className={cn(td, "whitespace-nowrap tabular-nums")}>{r.start ? `${hhmm12(r.start)} – ${hhmm12(r.end)}` : "-"}</td>
            <td className={cn(td, "font-medium")}>{r.section}</td>
            {showDepartment && <td className={td}>{r.department}</td>}
            <td className={td}>{r.subject}</td>
            <td className={td}>{r.faculty}{r.covered && <span className="block text-[11px] text-amber-700">Substitute / adjusted</span>}</td>
            <td className={td}>{CLASS_LABEL[r.status]}</td>
          </tr>
        ))}
      </Table>
    </>
  );
}

// ── Faculty today ───────────────────────────────────────────────────────────

type FacultyState = "IN" | "LATE" | "LEAVE" | "NOT_IN" | "OFF";
export type FacultyRosterRow = RosterRow & { uid?: string; name?: string; designation?: string };

function facultyState(r: FacultyRosterRow): FacultyState {
  if (r.status === "PRESENT") return isLateCheckIn(r.checkIn, r.permittedCheckInTime, r.lateAfter) ? "LATE" : "IN";
  if (r.status === "HALF_DAY" || r.status === "ON_DUTY") return "IN";
  if (r.status === "ON_LEAVE") return "LEAVE";
  if (r.status === "HOLIDAY" || r.status === "WEEKEND") return "OFF";
  return "NOT_IN"; // ABSENT or not marked yet
}

const STATE_TAG: Record<FacultyState, (r: FacultyRosterRow) => ReactNode> = {
  IN: (r) => <Tag tone="good">{r.status === "HALF_DAY" ? "Half Day" : r.status === "ON_DUTY" ? "On Duty" : "Present"}</Tag>,
  LATE: () => <Tag tone="warn">Late</Tag>,
  LEAVE: () => <Tag tone="info">On Leave</Tag>,
  NOT_IN: (r) => <Tag tone="crit">{r.status === "ABSENT" ? "Absent" : "Not Checked In"}</Tag>,
  OFF: () => <span className="text-xs text-muted-foreground">Off Today</span>,
};

export function FacultyTodayDetail({ roster, showDepartment }: { roster: FacultyRosterRow[]; showDepartment?: boolean }) {
  const rows = useMemo(() => roster.filter((r) => r.role !== "COLLEGE_STAFF").map((r) => ({ r, state: facultyState(r) }))
    .sort((a, b) => (a.r.name ?? "").localeCompare(b.r.name ?? "")), [roster]);
  const count = (s: FacultyState | "PRESENT") => rows.filter((x) => (s === "PRESENT" ? x.state === "IN" || x.state === "LATE" : x.state === s)).length;
  const [tab, setTab] = useState<"ALL" | "PRESENT" | "LATE" | "LEAVE" | "NOT_IN">(count("NOT_IN") > 0 ? "NOT_IN" : "ALL");
  const [search, setSearch] = useState("");
  const q = search.trim().toLowerCase();
  const shown = rows.filter(({ r, state }) =>
    (tab === "ALL" || (tab === "PRESENT" ? state === "IN" || state === "LATE" : state === tab)) && matches(q, r.name, r.designation, r.department));
  return (
    <>
      <Toolbar search={search} onSearch={setSearch} placeholder="Search name, designation...">
        <Tabs value={tab} onChange={setTab} options={[
          { key: "NOT_IN", label: "Not Checked In", count: count("NOT_IN") },
          { key: "LATE", label: "Late", count: count("LATE") },
          { key: "LEAVE", label: "On Leave", count: count("LEAVE") },
          { key: "PRESENT", label: "Present", count: count("PRESENT") },
          { key: "ALL", label: "All", count: rows.length },
        ]} />
      </Toolbar>
      <Table empty={shown.length === 0} head={<tr><th className={th}>Name</th><th className={th}>Designation</th>{showDepartment && <th className={th}>Department</th>}<th className={th}>Check-In</th><th className={th}>Status</th></tr>}>
        {shown.map(({ r, state }, i) => (
          <tr key={r.uid ?? i}>
            <td className={cn(td, "font-medium")}>{r.name ?? "-"}</td>
            <td className={td}>{r.designation || "-"}</td>
            {showDepartment && <td className={td}>{r.department || "-"}</td>}
            <td className={cn(td, "tabular-nums")}>{r.checkIn ? hhmm12(r.checkIn) : "-"}</td>
            <td className={td}>{STATE_TAG[state](r)}</td>
          </tr>
        ))}
      </Table>
    </>
  );
}

// ── Below 75% this semester ─────────────────────────────────────────────────

export interface BelowRow { name: string; rollNumber: string; section: string; department: string; pct: number; held: number; attended: number; shortIn: string[] }

export function ShortageDetail({ list, critical, showDepartment }: { list: BelowRow[]; critical: number; showDepartment?: boolean }) {
  const [tab, setTab] = useState<"ALL" | "CRIT">("ALL");
  const [search, setSearch] = useState("");
  const q = search.trim().toLowerCase();
  const shown = list.filter((r) => (tab === "ALL" || r.pct < 65) && matches(q, r.name, r.rollNumber, r.section, r.department, r.shortIn.join(" ")));
  return (
    <>
      <Toolbar search={search} onSearch={setSearch} placeholder="Search name, Regd. No, section, subject...">
        <Tabs value={tab} onChange={setTab} options={[
          { key: "ALL", label: `Below ${SHORT}%`, count: list.length },
          { key: "CRIT", label: "Below 65%", count: critical },
        ]} />
      </Toolbar>
      <Table empty={shown.length === 0} head={<tr><th className={th}>Regd. No</th><th className={th}>Name</th><th className={th}>Section</th>{showDepartment && <th className={th}>Department</th>}<th className={cn(th, "text-right")}>Attended</th><th className={cn(th, "text-right")}>Overall</th><th className={th}>Short In</th></tr>}>
        {shown.map((r, i) => (
          <tr key={`${r.section}-${r.rollNumber}-${i}`}>
            <td className={cn(td, "tabular-nums")}>{r.rollNumber || "-"}</td>
            <td className={cn(td, "font-medium")}>{r.name}</td>
            <td className={td}>{r.section}</td>
            {showDepartment && <td className={td}>{r.department}</td>}
            <td className={cn(td, "text-right tabular-nums")}>{r.attended} / {r.held}</td>
            <td className={cn(td, "text-right font-semibold tabular-nums", r.pct < 65 ? "text-red-600" : "text-amber-700")}>{fmtPct(r.pct)}</td>
            <td className={cn(td, "text-xs text-muted-foreground")}>{r.shortIn.join(", ") || "-"}</td>
          </tr>
        ))}
      </Table>
    </>
  );
}
