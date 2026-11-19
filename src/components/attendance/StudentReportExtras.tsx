"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Download, FileSpreadsheet, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MAX_REGISTER_DAYS, daysInRange, type PeriodMark } from "@/lib/studentAttendance/dayRegister";
import { classesNeeded, pct2, subjectLabel, type ExportRow, type ExportSubject } from "@/lib/studentAttendance/sectionReportExport";

// Pieces of the staff Student Attendance report (StudentAttendanceReportView): the Export menu, the date-wise
// register dialog and the student detail panel.

export type ExportKind =
  | "detailed-xlsx" | "detailed-print" | "shortage-xlsx" | "shortage-print" | "subjects-xlsx" | "register" | "csv";

export function ExportMenu({ onPick, busy, threshold }: { onPick: (k: ExportKind) => void; busy: boolean; threshold: number }) {
  const item = (k: ExportKind, label: string, icon: "xlsx" | "print" | "csv") => (
    <DropdownMenuItem onSelect={() => onPick(k)}>
      {icon === "print" ? <Printer className="mr-2 h-4 w-4" /> : icon === "xlsx" ? <FileSpreadsheet className="mr-2 h-4 w-4" /> : <Download className="mr-2 h-4 w-4" />}
      {label}
    </DropdownMenuItem>
  );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button disabled={busy}>{busy ? "Preparing…" : "Export"}<ChevronDown className="ml-1.5 h-4 w-4" /></Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>Detailed Report</DropdownMenuLabel>
        {item("detailed-xlsx", "Excel (Subject-wise)", "xlsx")}
        {item("detailed-print", "Print / PDF", "print")}
        <DropdownMenuSeparator />
        <DropdownMenuLabel>Shortage List (Below {threshold}%)</DropdownMenuLabel>
        {item("shortage-xlsx", "Excel", "xlsx")}
        {item("shortage-print", "Print / PDF", "print")}
        <DropdownMenuSeparator />
        {item("subjects-xlsx", "Subject-wise Sheets (Excel)", "xlsx")}
        {item("register", "Date-wise Register…", "xlsx")}
        <DropdownMenuSeparator />
        {item("csv", "CSV (All Columns)", "csv")}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function RegisterDialog({ open, onOpenChange, defaultFrom, defaultTo, busy, onRun }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultFrom: string;
  defaultTo: string;
  busy: boolean;
  onRun: (from: string, to: string, format: "xlsx" | "print") => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Mounted per opening, so each opening starts from the report's own range (or this month). */}
      {open && <RegisterForm defaultFrom={defaultFrom} defaultTo={defaultTo} busy={busy} onRun={onRun} />}
    </Dialog>
  );
}

function RegisterForm({ defaultFrom, defaultTo, busy, onRun }: {
  defaultFrom: string; defaultTo: string; busy: boolean; onRun: (from: string, to: string, format: "xlsx" | "print") => void;
}) {
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const problem = !from || !to ? "Select the From and To dates."
    : from > to ? "The From date must be before the To date."
    : daysInRange(from, to) > MAX_REGISTER_DAYS ? `Select a range of up to ${MAX_REGISTER_DAYS} days.` : "";
  return (
    <>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Date-wise Register</DialogTitle>
          <DialogDescription>
            Students down the side and each date across: periods present out of periods held that day. A = absent all day, OD = on duty. Up to {MAX_REGISTER_DAYS} days.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5"><Label htmlFor="reg-from">From</Label><Input id="reg-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="reg-to">To</Label><Input id="reg-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        </div>
        {problem && <p className="text-sm text-destructive">{problem}</p>}
        <DialogFooter className="gap-2">
          <Button variant="outline" disabled={!!problem || busy} onClick={() => onRun(from, to, "print")}><Printer className="mr-1.5 h-4 w-4" />Print / PDF</Button>
          <Button disabled={!!problem || busy} onClick={() => onRun(from, to, "xlsx")}><FileSpreadsheet className="mr-1.5 h-4 w-4" />{busy ? "Preparing…" : "Excel"}</Button>
        </DialogFooter>
      </DialogContent>
    </>
  );
}

const MARK_LABEL: Record<string, string> = { PRESENT: "Present", ABSENT: "Absent", ON_DUTY: "On Duty" };
const MARK_TONE: Record<string, string> = {
  PRESENT: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300",
  ABSENT: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
  ON_DUTY: "bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300",
};

/** One student: subject-wise figures (already loaded) and every period's mark in the report's range. Mount with `key` = the student. */
export function StudentDetailDialog({ student, subjects, threshold, rangeText, loadPeriods, onClose }: {
  student: (ExportRow & { section: string }) | null;
  subjects: ExportSubject[];
  threshold: number;
  rangeText: string;
  loadPeriods: (studentId: string) => Promise<PeriodMark[]>;
  onClose: () => void;
}) {
  const [periods, setPeriods] = useState<PeriodMark[] | null>(null);
  const [error, setError] = useState("");
  const studentId = student?.studentId ?? "";
  useEffect(() => {
    if (!studentId) return;
    // The parent mounts this panel once per student (key), so state starts empty for each.
    let live = true;
    loadPeriods(studentId)
      .then((p) => { if (live) setPeriods(p); })
      .catch((e: unknown) => { if (live) setError(e instanceof Error ? e.message : "Unable to load the day-by-day attendance."); });
    return () => { live = false; };
  }, [studentId, loadPeriods]);

  const byDate = useMemo(() => {
    const m = new Map<string, PeriodMark[]>();
    for (const p of periods ?? []) m.set(p.date, [...(m.get(p.date) ?? []), p]);
    return Array.from(m.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [periods]);

  if (!student) return null;
  const needed = classesNeeded(student.shown.attended, student.shown.held, threshold);
  const low = (p: number | null | undefined) => p != null && p < threshold;
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{student.name}</DialogTitle>
          <DialogDescription>Regd. No {student.rollNumber || "-"} · Section {student.section}{student.labBatch ? ` · Batch ${student.labBatch}` : ""} · {rangeText}</DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {[
            { label: "Overall", value: `${pct2(student.shown.percentage)}%`, tone: low(student.shown.percentage) ? "text-red-600" : "" },
            { label: "Attended / Held", value: `${student.shown.attended} / ${student.shown.held}` },
            { label: "Days Absent", value: String(student.absentDays ?? 0) },
            { label: `Classes to Reach ${threshold}%`, value: needed == null ? "-" : String(needed), tone: needed ? "text-amber-700" : "" },
          ].map((t) => (
            <div key={t.label} className="rounded-md border px-3 py-2">
              <p className="text-[11px] text-muted-foreground">{t.label}</p>
              <p className={`text-lg font-semibold tabular-nums ${t.tone ?? ""}`}>{t.value}</p>
            </div>
          ))}
        </div>

        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted text-left text-xs text-muted-foreground">
              <tr><th className="px-3 py-2 font-medium">Subject</th><th className="px-3 py-2 text-right font-medium">Held</th><th className="px-3 py-2 text-right font-medium">Attended</th><th className="px-3 py-2 text-right font-medium">%</th></tr>
            </thead>
            <tbody className="divide-y">
              {subjects.map((s) => {
                const v = student.bySubject[s.subjectId];
                return (
                  <tr key={s.subjectId}>
                    <td className="px-3 py-1.5"><span className="font-medium">{subjectLabel(s)}</span> <span className="text-xs text-muted-foreground">{s.subjectName}</span></td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{v?.held ?? "-"}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{v?.attended ?? "-"}</td>
                    <td className={`px-3 py-1.5 text-right tabular-nums ${low(v?.percentage) ? "font-semibold text-red-600" : ""}`}>{pct2(v?.percentage)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">Day by Day</p>
          {error ? <p className="text-sm text-destructive">{error}</p>
            : periods == null ? <div className="h-16 animate-pulse rounded-md border bg-muted/30" />
            : byDate.length === 0 ? <p className="text-sm text-muted-foreground">No classes held for this student in this range.</p>
            : (
              <ul className="divide-y rounded-md border">
                {byDate.map(([date, list]) => (
                  <li key={date} className="flex flex-wrap items-center gap-1.5 px-3 py-2">
                    <span className="w-24 shrink-0 text-xs font-medium tabular-nums">{date.split("-").reverse().join("-")}</span>
                    {list.map((p, i) => (
                      <span key={i} title={`${p.subjectName}${p.periodNumber ? ` · Period ${p.periodNumber}` : ""} · ${MARK_LABEL[p.mark] ?? p.mark}`}
                        className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${MARK_TONE[p.mark] ?? ""}`}>
                        {p.periodNumber ? `P${p.periodNumber} ` : ""}{p.subjectCode || p.subjectName}{p.mark === "PRESENT" ? "" : ` · ${p.mark === "ON_DUTY" ? "OD" : "A"}`}
                      </span>
                    ))}
                  </li>
                ))}
              </ul>
            )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
