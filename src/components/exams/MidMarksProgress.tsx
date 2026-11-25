"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Download, Snowflake } from "lucide-react";
import { toast } from "@/hooks/useToast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Exam Cell > Mid Marks > Marks Entry Progress, for the Mid picked: every section of every Mid subject - frozen,
// waiting to freeze (submitted by the faculty; Freeze All Submitted), change requested, in progress (n of N students complete), not started, or still closed (the Exam Cell has not opened the subject
// after its exam). Number cards, a row per branch, and the section list with a filter and CSV.

interface Progress { sectionId: string; section: string; facultyName: string; entered: number; total: number; status: "NOT_STARTED" | "DRAFT" | "SUBMITTED" | "FROZEN"; locked: boolean; sheetId?: string; changeRequested?: boolean; coPending?: number }
export interface ProgressRow {
  subjectId: string; subjectName: string; subjectCode: string; branch: string; entryOpen: boolean; examDay: string | null;
  sections: { id: string; name: string; facultyName: string }[];
  progress: Progress[];
}

// FROZEN = final (or locked by the Exam Cell's own upload); SUBMITTED = with the Exam Cell, waiting to be frozen.
type State = "FROZEN" | "SUBMITTED" | "IN_PROGRESS" | "NOT_STARTED" | "CLOSED";
const LABEL: Record<State, string> = { FROZEN: "Frozen", SUBMITTED: "Waiting to Freeze", IN_PROGRESS: "In Progress", NOT_STARTED: "Not Started", CLOSED: "Not Open Yet" };
const TONE: Record<State, string> = {
  FROZEN: "text-emerald-700 dark:text-emerald-400", SUBMITTED: "text-blue-700 dark:text-blue-400", IN_PROGRESS: "text-amber-700 dark:text-amber-400",
  NOT_STARTED: "text-red-700 dark:text-red-400", CLOSED: "text-muted-foreground",
};
const BAR: Record<State, string> = { FROZEN: "bg-emerald-600", SUBMITTED: "bg-blue-500", IN_PROGRESS: "bg-amber-500", NOT_STARTED: "bg-red-500/70", CLOSED: "bg-muted-foreground/30" };

interface Line { subject: string; code: string; branch: string; section: string; faculty: string; state: State; entered: number; total: number; sheetId?: string; changeRequested: boolean; coPending: number }
type FilterKey = State | "PENDING" | "REQUESTS" | "CO_PENDING" | "ALL";

export function MidMarksProgress({ rows, facultyMode, onChanged }: { rows: ProgressRow[]; facultyMode: boolean; onChanged?: () => void }) {
  const [filter, setFilter] = useState<FilterKey>("PENDING");
  const [freezing, setFreezing] = useState(false);

  const lines = useMemo<Line[]>(() => rows.flatMap((r) => {
    const list: Progress[] = r.progress.length ? r.progress
      : r.sections.map((s) => ({ sectionId: s.id, section: s.name, facultyName: s.facultyName, entered: 0, total: 0, status: "NOT_STARTED" as const, locked: false }));
    return list.map((p) => {
      const state: State = p.locked || p.status === "FROZEN" ? "FROZEN" : p.status === "SUBMITTED" ? "SUBMITTED"
        : facultyMode && !r.entryOpen && p.status === "NOT_STARTED" ? "CLOSED"
        : p.status === "DRAFT" ? "IN_PROGRESS" : "NOT_STARTED";
      return { subject: r.subjectName, code: r.subjectCode, branch: r.branch, section: p.section, faculty: p.facultyName, state, entered: p.entered, total: p.total, sheetId: p.sheetId, changeRequested: !!p.changeRequested, coPending: p.coPending ?? 0 };
    });
  }), [rows, facultyMode]);

  const count = (s: State) => lines.filter((l) => l.state === s).length;
  const handedIn = (s: State) => s === "SUBMITTED" || s === "FROZEN";
  const students = lines.reduce((a, l) => ({ entered: a.entered + (handedIn(l.state) ? l.total : l.entered), total: a.total + l.total }), { entered: 0, total: 0 });
  const requests = lines.filter((l) => l.changeRequested).length;
  // Mid exam format sheets: question boxes still without a CO (never holds up marks).
  const coPending = lines.filter((l) => l.coPending > 0).length;
  const toFreeze = lines.filter((l) => l.state === "SUBMITTED" && l.sheetId && !l.changeRequested);

  const freezeAll = async () => {
    setFreezing(true);
    try {
      const res = await fetch("/api/college/mid-marks-sheets/freeze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sheetIds: toFreeze.map((l) => l.sheetId) }) });
      const d = (await res.json()) as { frozen?: number; skipped?: number; error?: string };
      if (!res.ok) throw new Error(d.error ?? "Unable to freeze the marks.");
      toast({ variant: "success", title: `${d.frozen ?? 0} section${d.frozen === 1 ? "" : "s"} frozen.${d.skipped ? ` ${d.skipped} skipped (changed meanwhile).` : ""}` });
      onChanged?.();
    } catch (e) {
      toast({ variant: "destructive", title: e instanceof Error ? e.message : "Unable to freeze the marks." });
    } finally {
      setFreezing(false);
    }
  };
  const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);

  const branches = useMemo(() => {
    const m = new Map<string, Record<State, number>>();
    for (const l of lines) {
      const b = m.get(l.branch) ?? { FROZEN: 0, SUBMITTED: 0, IN_PROGRESS: 0, NOT_STARTED: 0, CLOSED: 0 };
      b[l.state] += 1;
      m.set(l.branch, b);
    }
    return [...m].map(([branch, c]) => ({ branch, ...c, all: c.FROZEN + c.SUBMITTED + c.IN_PROGRESS + c.NOT_STARTED + c.CLOSED }))
      .sort((a, b) => pct(a.FROZEN + a.SUBMITTED, a.all) - pct(b.FROZEN + b.SUBMITTED, b.all) || a.branch.localeCompare(b.branch));
  }, [lines]);

  const shown = lines
    .filter((l) => filter === "ALL" || (filter === "PENDING" ? l.state === "IN_PROGRESS" || l.state === "NOT_STARTED" : filter === "REQUESTS" ? l.changeRequested : filter === "CO_PENDING" ? l.coPending > 0 : l.state === filter))
    .sort((a, b) => a.branch.localeCompare(b.branch) || a.subject.localeCompare(b.subject) || a.section.localeCompare(b.section));

  const exportCsv = () => {
    const head = ["Branch", "Subject Code", "Subject", "Section", "Faculty", "Status", "Students Complete", "Students", "CO Pending"];
    const body = lines.map((l) => [l.branch, l.code, l.subject, l.section, l.faculty, `${LABEL[l.state]}${l.changeRequested ? " (change requested)" : ""}`, handedIn(l.state) ? l.total : l.entered, l.total, l.coPending || ""]);
    const csv = [head, ...body].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "Mid_Marks_Entry_Progress.csv";
    a.click();
  };

  if (lines.length === 0) return null;
  const filters: [FilterKey, string, number][] = [
    ["PENDING", "Pending", count("IN_PROGRESS") + count("NOT_STARTED")], ["SUBMITTED", "Waiting to Freeze", count("SUBMITTED")],
    ...(requests ? [["REQUESTS", "Change Requests", requests] as [FilterKey, string, number]] : []),
    ...(coPending ? [["CO_PENDING", "CO Pending", coPending] as [FilterKey, string, number]] : []),
    ["FROZEN", "Frozen", count("FROZEN")], ["IN_PROGRESS", "In Progress", count("IN_PROGRESS")], ["NOT_STARTED", "Not Started", count("NOT_STARTED")],
    ...(facultyMode ? [["CLOSED", "Not Open Yet", count("CLOSED")] as [FilterKey, string, number]] : []), ["ALL", "All", lines.length],
  ];

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">Marks Entry Progress</CardTitle>
        <div className="flex flex-wrap gap-2">
          {toFreeze.length > 0 && <Button size="sm" loading={freezing} onClick={() => void freezeAll()}><Snowflake className="mr-1 h-4 w-4" />Freeze All Submitted ({toFreeze.length})</Button>}
          <Button size="sm" variant="outline" onClick={exportCsv}><Download className="mr-1 h-4 w-4" />CSV</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
          <Stat label="Sections" value={lines.length} />
          <Stat label="Frozen" value={count("FROZEN")} sub={`${pct(count("FROZEN"), lines.length)}% of sections`} tone={TONE.FROZEN} />
          <Stat label="Waiting to Freeze" value={count("SUBMITTED")} sub={requests ? `${requests} change request${requests === 1 ? "" : "s"}` : "submitted by faculty"} tone={TONE.SUBMITTED} />
          <Stat label="In Progress" value={count("IN_PROGRESS")} tone={TONE.IN_PROGRESS} />
          <Stat label="Not Started" value={count("NOT_STARTED")} sub={facultyMode ? "entry open" : undefined} tone={count("NOT_STARTED") ? TONE.NOT_STARTED : undefined} />
          {facultyMode && <Stat label="Not Open Yet" value={count("CLOSED")} sub="exam not opened for entry" />}
          <Stat label="Students Entered" value={`${pct(students.entered, students.total)}%`} sub={`${students.entered} of ${students.total} (sheets opened)`} />
        </div>

        <div>
          <div className="mb-1.5 flex h-3 overflow-hidden rounded-full bg-muted" aria-label="Sections by status">
            {(["FROZEN", "SUBMITTED", "IN_PROGRESS", "NOT_STARTED", "CLOSED"] as State[]).map((s) => (
              <div key={s} className={cn(BAR[s], "border-r-2 border-background last:border-r-0")} style={{ width: `${pct(count(s), lines.length)}%` }} title={`${LABEL[s]}: ${count(s)}`} />
            ))}
          </div>
          <p className="text-xs text-muted-foreground">Green frozen · blue waiting to freeze · amber in progress · red not started · grey not open yet</p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead><tr className="text-left text-xs text-muted-foreground">
              {["Branch", "Sections", "Frozen", "Waiting to Freeze", "In Progress", "Not Started", ...(facultyMode ? ["Not Open Yet"] : []), "Handed In"].map((h) => <th key={h} className="px-2 py-1.5 font-medium">{h}</th>)}
            </tr></thead>
            <tbody className="divide-y">
              {branches.map((b) => (
                <tr key={b.branch}>
                  <td className="px-2 py-1.5 font-medium">{b.branch}</td>
                  <td className="px-2 py-1.5 tabular-nums">{b.all}</td>
                  <td className="px-2 py-1.5 tabular-nums">{b.FROZEN || "-"}</td>
                  <td className="px-2 py-1.5 tabular-nums">{b.SUBMITTED || "-"}</td>
                  <td className="px-2 py-1.5 tabular-nums">{b.IN_PROGRESS || "-"}</td>
                  <td className={cn("px-2 py-1.5 tabular-nums", b.NOT_STARTED && TONE.NOT_STARTED)}>{b.NOT_STARTED || "-"}</td>
                  {facultyMode && <td className="px-2 py-1.5 tabular-nums text-muted-foreground">{b.CLOSED || "-"}</td>}
                  <td className="px-2 py-1.5">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-24 overflow-hidden rounded-full bg-muted"><div className="h-full bg-emerald-600" style={{ width: `${pct(b.FROZEN + b.SUBMITTED, b.all)}%` }} /></div>
                      <span className="tabular-nums text-xs">{pct(b.FROZEN + b.SUBMITTED, b.all)}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {filters.map(([k, l, n]) => (
              <button key={k} type="button" onClick={() => setFilter(k)}
                className={cn("rounded-full border px-3 py-1 text-xs font-medium", filter === k ? "border-foreground bg-foreground text-background" : "bg-card hover:border-primary")}>
                {l} ({n})
              </button>
            ))}
          </div>
          <div className="max-h-96 overflow-auto rounded-md border">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="sticky top-0 bg-muted/60"><tr className="text-left text-xs text-muted-foreground">
                {["Branch", "Subject", "Section", "Faculty", "Status", "Students", ""].map((h) => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}
              </tr></thead>
              <tbody className="divide-y">
                {shown.map((l, i) => (
                  <tr key={`${l.branch}|${l.code}|${l.section}|${i}`}>
                    <td className="px-3 py-1.5">{l.branch}</td>
                    <td className="px-3 py-1.5"><span className="font-medium">{l.code}</span> <span className="text-muted-foreground">{l.subject}</span></td>
                    <td className="px-3 py-1.5">{l.section}</td>
                    <td className="px-3 py-1.5">{l.faculty || "-"}</td>
                    <td className={cn("px-3 py-1.5 font-medium", TONE[l.state])}>{LABEL[l.state]}{l.changeRequested && <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-900 dark:bg-amber-950 dark:text-amber-200">Change requested</span>}{l.coPending > 0 && <span className="ml-1.5 rounded-full border border-amber-400 px-1.5 py-0.5 text-[10px] text-amber-800 dark:text-amber-300">CO pending ({l.coPending})</span>}</td>
                    <td className="px-3 py-1.5 tabular-nums">{handedIn(l.state) ? `${l.total} of ${l.total}` : l.total ? `${l.entered} of ${l.total}` : "-"}</td>
                    <td className="px-3 py-1.5 text-right">{l.sheetId && <Link href={`/exam-cell/mid-marks/sheets/${l.sheetId}`} className="text-xs font-medium text-primary hover:underline">View</Link>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {shown.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">{filter === "PENDING" ? "Nothing pending." : "None."}</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string | number; sub?: string; tone?: string }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("text-2xl font-semibold tabular-nums", tone)}>{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}
