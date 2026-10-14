"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SegmentedTabs } from "@/components/shared/SegmentedTabs";
import { TableSkeleton } from "@/components/shared/SkeletonLoader";
import { toast } from "@/hooks/useToast";
import { toRoman } from "@/lib/academic/format";
import { DEFAULT_SHORTAGE_THRESHOLD, isShortageByPercent } from "@/lib/studentAttendance/shortage";
import {
  MONTH_NAMES,
  monthPickerYears,
  resolveReportRange,
  type ReportView,
  type SemesterRange,
} from "@/lib/studentAttendance/studentReportRange";
import {
  downloadStudentReportXlsx,
  printStudentReport,
  studentReportIdentity,
  studentReportLetterhead,
  type StudentReportData,
} from "@/lib/studentAttendance/studentReportExport";

const THRESHOLD = DEFAULT_SHORTAGE_THRESHOLD;

const th = "border border-border px-3 py-1.5 text-left font-semibold";
const td = "border border-border px-3 py-1.5";

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const pct = (p: number | null) => (p == null ? "-" : p.toFixed(2));

export function StudentAttendanceReport() {
  const now = new Date();
  const [view, setView] = useState<ReportView>("tillnow");
  const [month, setMonth] = useState(String(now.getMonth() + 1));
  const [year, setYear] = useState(String(now.getFullYear()));
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [semester, setSemester] = useState("");

  const [semesters, setSemesters] = useState<SemesterRange[]>([]);
  const [batchYear, setBatchYear] = useState<number | null>(null);
  const [optionsReady, setOptionsReady] = useState(false);

  const [report, setReport] = useState<StudentReportData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  // A newer Load (or any input change) invalidates an in-flight response.
  const requestId = useRef(0);

  useEffect(() => {
    fetch("/api/college/student/me/attendance?optionsOnly=true")
      .then((r) => r.json() as Promise<{ semesters?: SemesterRange[]; batchStartYear?: number | null; error?: string }>)
      .then((d) => {
        setSemesters(d.semesters ?? []);
        setBatchYear(d.batchStartYear ?? null);
        if (d.error) toast({ variant: "destructive", title: d.error });
      })
      .catch(() => { /* pickers still work without semester options */ })
      .finally(() => setOptionsReady(true));
  }, []);

  const yearOptions = monthPickerYears(batchYear ? String(batchYear) : null, now.getFullYear());

  // Any change to the selection drops the loaded result, so numbers are never
  // shown under a label they don't belong to.
  const reset = () => {
    requestId.current += 1;
    setReport(null);
    setIsLoading(false);
  };

  const changeView = (v: ReportView) => {
    setView(v);
    reset();
  };

  const views: { key: ReportView; label: string }[] = [
    { key: "month", label: "Month" },
    { key: "period", label: "Period" },
    ...(semesters.length > 0 ? [{ key: "semester" as const, label: "Semester" }] : []),
    { key: "tillnow", label: "Till now" },
  ];

  const load = async () => {
    const check = resolveReportRange(view, { year, month, from, to, semester }, semesters);
    if (!check.ok) {
      toast({ variant: "destructive", title: check.error });
      return;
    }
    const qs = new URLSearchParams({ view });
    if (view === "month") { qs.set("year", year); qs.set("month", month); }
    if (view === "period") { qs.set("from", from); qs.set("to", to); }
    if (view === "semester") qs.set("semester", semester);

    const id = ++requestId.current;
    setReport(null);
    setIsLoading(true);
    try {
      const res = await fetch(`/api/college/student/me/attendance?${qs.toString()}`);
      const data = (await res.json()) as StudentReportData & { error?: string };
      if (id !== requestId.current) return;
      if (!res.ok) {
        toast({ variant: "destructive", title: data.error ?? "Failed to load attendance" });
        return;
      }
      setReport(data);
    } catch {
      if (id === requestId.current) toast({ variant: "destructive", title: "Failed to load attendance" });
    } finally {
      if (id === requestId.current) setIsLoading(false);
    }
  };

  const letterhead = report ? studentReportLetterhead(report) : [];

  return (
    <div className="space-y-5">
      <Card className="rounded-3xl border-border/60 bg-card/90 shadow-xs">
        <CardContent className="space-y-4 p-4 sm:p-5">
          <div className="space-y-1.5">
            <Label>View</Label>
            <div className="overflow-x-auto">
              <SegmentedTabs options={views} value={view} onChange={(k) => changeView(k as ReportView)} />
            </div>
          </div>

          {view !== "tillnow" && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {view === "month" && (
                <>
                  <div className="space-y-1.5">
                    <Label>Month</Label>
                    <Select value={month} onValueChange={(v) => { setMonth(v); reset(); }}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {MONTH_NAMES.map((m, i) => <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Year</Label>
                    <Select value={year} onValueChange={(v) => { setYear(v); reset(); }}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {yearOptions.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </>
              )}
              {view === "period" && (
                <>
                  <div className="space-y-1.5">
                    <Label>From</Label>
                    <Input type="date" value={from} max={to || todayKey()} onChange={(e) => { setFrom(e.target.value); reset(); }} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>To</Label>
                    <Input type="date" value={to} min={from || undefined} max={todayKey()} onChange={(e) => { setTo(e.target.value); reset(); }} />
                  </div>
                </>
              )}
              {view === "semester" && (
                <div className="space-y-1.5">
                  <Label>Semester</Label>
                  <Select value={semester} onValueChange={(v) => { setSemester(v); reset(); }}>
                    <SelectTrigger><SelectValue placeholder="Select semester" /></SelectTrigger>
                    <SelectContent>
                      {semesters.map((s) => (
                        <SelectItem key={s.semester} value={String(s.semester)}>
                          {s.year && s.inYear ? `${toRoman(s.year)} Year - Sem ${toRoman(s.inYear)}` : `Semester ${toRoman(s.semester)}`}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}

          <Button onClick={() => void load()} disabled={isLoading || !optionsReady} className="rounded-full">
            {isLoading ? "Loading…" : "Load Report"}
          </Button>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="rounded-3xl border border-border/60 bg-card/90 p-4 shadow-xs">
          <TableSkeleton rows={5} cols={5} />
        </div>
      ) : !report ? (
        <div className="rounded-3xl border border-dashed bg-muted/10 p-8 text-center text-sm text-muted-foreground">
          Pick a view above, then press <span className="font-semibold text-foreground">Load Report</span> to see your attendance.
        </div>
      ) : (
        <div className="rounded-2xl border border-border/60 bg-card/90 p-4 shadow-xs sm:p-6">
          {/* Letterhead and title, the same as the printed report */}
          <div className="flex items-center justify-center gap-4 text-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={report.college.logoUrl || "/vishnulogo.png"} alt="" className="h-16 w-16 shrink-0 object-contain" />
            <div>
              {letterhead.map((line, i) => (
                <p key={line} className={i === 0 ? "text-base font-bold sm:text-lg" : "text-sm font-semibold"}>{line}</p>
              ))}
            </div>
          </div>
          <h2 className="mt-4 text-center text-sm font-bold sm:text-base">ATTENDANCE REPORT</h2>

          <table className="mx-auto my-3 text-sm">
            <tbody>
              {studentReportIdentity(report).map(([label, value]) => (
                <tr key={label}>
                  <td className="pr-2 text-right font-semibold">{label} :</td>
                  <td className="text-left">{value}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {report.subjects.length === 0 ? (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              No classes were held in {report.scope.label}.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="bg-muted">
                    <th className={th}>Sl.No.</th>
                    <th className={th}>Subject</th>
                    <th className={th}>Held</th>
                    <th className={th}>Attend</th>
                    <th className={th}>%</th>
                  </tr>
                </thead>
                <tbody>
                  {report.subjects.map((s, i) => (
                    <tr key={s.subjectId}>
                      <td className={td}>{i + 1}</td>
                      <td className={td}>{s.code}</td>
                      <td className={`${td} tabular-nums`}>{s.held}</td>
                      <td className={`${td} tabular-nums`}>{s.attended}</td>
                      <td className={`${td} tabular-nums ${isShortageByPercent(s.percent, THRESHOLD) ? "font-semibold text-red-600 dark:text-red-400" : ""}`}>
                        {pct(s.percent)}
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-muted font-bold">
                    <td colSpan={2} className={`${td} text-right`}>TOTAL</td>
                    <td className={`${td} tabular-nums`}>{report.total.held}</td>
                    <td className={`${td} tabular-nums`}>{report.total.attended}</td>
                    <td className={`${td} tabular-nums`}>{pct(report.total.percent)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {report.subjects.length > 0 && (
            <div className="mt-4 flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (!printStudentReport(report, THRESHOLD)) toast({ variant: "destructive", title: "Allow pop-ups to print the report" });
                }}
              >
                Print
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void downloadStudentReportXlsx(report).catch(() => toast({ variant: "destructive", title: "Export failed" }))}
              >
                Export
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
