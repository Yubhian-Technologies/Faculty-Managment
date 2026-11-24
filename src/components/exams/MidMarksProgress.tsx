"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Exam Cell > Mid Marks > Marks Entry Progress, for the Mid picked: every section of every Mid subject - submitted,
// in progress (n of N students complete), not started, or still closed (the Exam Cell has not opened the subject
// after its exam). Number cards, a row per branch, and the section list with a filter and CSV.

interface Progress { sectionId: string; section: string; facultyName: string; entered: number; total: number; status: "NOT_STARTED" | "DRAFT" | "SUBMITTED"; locked: boolean; sheetId?: string }
export interface ProgressRow {
  subjectId: string; subjectName: string; subjectCode: string; branch: string; entryOpen: boolean; examDay: string | null;
  sections: { id: string; name: string; facultyName: string }[];
  progress: Progress[];
}

type State = "SUBMITTED" | "IN_PROGRESS" | "NOT_STARTED" | "CLOSED";
const LABEL: Record<State, string> = { SUBMITTED: "Submitted", IN_PROGRESS: "In Progress", NOT_STARTED: "Not Started", CLOSED: "Not Open Yet" };
const TONE: Record<State, string> = {
  SUBMITTED: "text-emerald-700 dark:text-emerald-400", IN_PROGRESS: "text-amber-700 dark:text-amber-400",
  NOT_STARTED: "text-red-700 dark:text-red-400", CLOSED: "text-muted-foreground",
};

interface Line { subject: string; code: string; branch: string; section: string; faculty: string; state: State; entered: number; total: number; sheetId?: string }

export function MidMarksProgress({ rows, facultyMode }: { rows: ProgressRow[]; facultyMode: boolean }) {
  const [filter, setFilter] = useState<State | "PENDING" | "ALL">("PENDING");

  const lines = useMemo<Line[]>(() => rows.flatMap((r) => {
    const list: Progress[] = r.progress.length ? r.progress
      : r.sections.map((s) => ({ sectionId: s.id, section: s.name, facultyName: s.facultyName, entered: 0, total: 0, status: "NOT_STARTED" as const, locked: false }));
    return list.map((p) => {
      const state: State = p.locked || p.status === "SUBMITTED" ? "SUBMITTED"
        : facultyMode && !r.entryOpen && p.status === "NOT_STARTED" ? "CLOSED"
        : p.status === "DRAFT" ? "IN_PROGRESS" : "NOT_STARTED";
      return { subject: r.subjectName, code: r.subjectCode, branch: r.branch, section: p.section, faculty: p.facultyName, state, entered: p.entered, total: p.total, sheetId: p.sheetId };
    });
  }), [rows, facultyMode]);

  const count = (s: State) => lines.filter((l) => l.state === s).length;
  const students = lines.reduce((a, l) => ({ entered: a.entered + (l.state === "SUBMITTED" ? l.total : l.entered), total: a.total + l.total }), { entered: 0, total: 0 });
  const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);

  const branches = useMemo(() => {
    const m = new Map<string, Record<State, number>>();
    for (const l of lines) {
      const b = m.get(l.branch) ?? { SUBMITTED: 0, IN_PROGRESS: 0, NOT_STARTED: 0, CLOSED: 0 };
      b[l.state] += 1;
      m.set(l.branch, b);
    }
    return [...m].map(([branch, c]) => ({ branch, ...c, all: c.SUBMITTED + c.IN_PROGRESS + c.NOT_STARTED + c.CLOSED }))
      .sort((a, b) => pct(a.SUBMITTED, a.all) - pct(b.SUBMITTED, b.all) || a.branch.localeCompare(b.branch));
  }, [lines]);

  const shown = lines
    .filter((l) => filter === "ALL" || (filter === "PENDING" ? l.state === "IN_PROGRESS" || l.state === "NOT_STARTED" : l.state === filter))
    .sort((a, b) => a.branch.localeCompare(b.branch) || a.subject.localeCompare(b.subject) || a.section.localeCompare(b.section));

  const exportCsv = () => {
    const head = ["Branch", "Subject Code", "Subject", "Section", "Faculty", "Status", "Students Complete", "Students"];
    const body = lines.map((l) => [l.branch, l.code, l.subject, l.section, l.faculty, LABEL[l.state], l.state === "SUBMITTED" ? l.total : l.entered, l.total]);
    const csv = [head, ...body].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "Mid_Marks_Entry_Progress.csv";
    a.click();
  };

  if (lines.length === 0) return null;
  const filters: [typeof filter, string, number][] = [
    ["PENDING", "Pending", count("IN_PROGRESS") + count("NOT_STARTED")], ["IN_PROGRESS", "In Progress", count("IN_PROGRESS")],
    ["NOT_STARTED", "Not Started", count("NOT_STARTED")], ["SUBMITTED", "Submitted", count("SUBMITTED")],
    ...(facultyMode ? [["CLOSED", "Not Open Yet", count("CLOSED")] as [typeof filter, string, number]] : []), ["ALL", "All", lines.length],
  ];

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">Marks Entry Progress</CardTitle>
        <Button size="sm" variant="outline" onClick={exportCsv}><Download className="mr-1 h-4 w-4" />CSV</Button>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Stat label="Sections" value={lines.length} />
          <Stat label="Submitted" value={count("SUBMITTED")} sub={`${pct(count("SUBMITTED"), lines.length)}% of sections`} tone={TONE.SUBMITTED} />
          <Stat label="In Progress" value={count("IN_PROGRESS")} tone={TONE.IN_PROGRESS} />
          <Stat label="Not Started" value={count("NOT_STARTED")} sub={facultyMode ? "entry open" : undefined} tone={count("NOT_STARTED") ? TONE.NOT_STARTED : undefined} />
          {facultyMode && <Stat label="Not Open Yet" value={count("CLOSED")} sub="exam not opened for entry" />}
          <Stat label="Students Entered" value={`${pct(students.entered, students.total)}%`} sub={`${students.entered} of ${students.total} (sheets opened)`} />
        </div>

        <div>
          <div className="mb-1.5 flex h-3 overflow-hidden rounded-full bg-muted" aria-label="Sections by status">
            {(["SUBMITTED", "IN_PROGRESS", "NOT_STARTED"] as State[]).map((s) => (
              <div key={s} className={cn(s === "SUBMITTED" ? "bg-emerald-600" : s === "IN_PROGRESS" ? "bg-amber-500" : "bg-red-500/70", "border-r-2 border-background last:border-r-0")} style={{ width: `${pct(count(s), lines.length)}%` }} title={`${LABEL[s]}: ${count(s)}`} />
            ))}
          </div>
          <p className="text-xs text-muted-foreground">Green submitted · amber in progress · red not started · grey not open yet</p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead><tr className="text-left text-xs text-muted-foreground">
              {["Branch", "Sections", "Submitted", "In Progress", "Not Started", ...(facultyMode ? ["Not Open Yet"] : []), "Done"].map((h) => <th key={h} className="px-2 py-1.5 font-medium">{h}</th>)}
            </tr></thead>
            <tbody className="divide-y">
              {branches.map((b) => (
                <tr key={b.branch}>
                  <td className="px-2 py-1.5 font-medium">{b.branch}</td>
                  <td className="px-2 py-1.5 tabular-nums">{b.all}</td>
                  <td className="px-2 py-1.5 tabular-nums">{b.SUBMITTED || "-"}</td>
                  <td className="px-2 py-1.5 tabular-nums">{b.IN_PROGRESS || "-"}</td>
                  <td className={cn("px-2 py-1.5 tabular-nums", b.NOT_STARTED && TONE.NOT_STARTED)}>{b.NOT_STARTED || "-"}</td>
                  {facultyMode && <td className="px-2 py-1.5 tabular-nums text-muted-foreground">{b.CLOSED || "-"}</td>}
                  <td className="px-2 py-1.5">
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-24 overflow-hidden rounded-full bg-muted"><div className="h-full bg-emerald-600" style={{ width: `${pct(b.SUBMITTED, b.all)}%` }} /></div>
                      <span className="tabular-nums text-xs">{pct(b.SUBMITTED, b.all)}%</span>
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
                    <td className={cn("px-3 py-1.5 font-medium", TONE[l.state])}>{LABEL[l.state]}</td>
                    <td className="px-3 py-1.5 tabular-nums">{l.state === "SUBMITTED" ? `${l.total} of ${l.total}` : l.total ? `${l.entered} of ${l.total}` : "-"}</td>
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
