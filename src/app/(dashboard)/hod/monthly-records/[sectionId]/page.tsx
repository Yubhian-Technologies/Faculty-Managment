"use client";

import { Fragment, useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SegmentedTabs } from "@/components/shared/SegmentedTabs";
import { currentAcademicStartYear, academicSessionLabel } from "@/lib/college/academicSession";

const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const selectClass =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:border-primary focus:outline-none";

// A session (e.g. "2026-27") runs April of its start year through March of
// the next - so "January" picked under "2026-27" actually means January
// 2027, not 2026. This resolves the dropdown pair back to the plain
// calendar year the report route itself works in.
function calendarYearForMonth(academicStartYear: number, month: number): number {
  return month >= 4 ? academicStartYear : academicStartYear + 1;
}

interface SubjectColumn {
  subjectId: string;
  subjectName: string;
  subjectCode: string;
}
interface SubjectStat {
  held: number;
  attended: number;
  percentage: number;
}
interface RangeStudentRow {
  studentId: string;
  rollNumber: string;
  name: string;
  bySubject: Record<string, SubjectStat>;
  overall: SubjectStat;
}
interface RangeSummary {
  totalPeriodsHeld: number;
  totalPeriodsAttended: number;
  overallPercentage: number;
}

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** "2026-08-18" -> "18-08-2026" - display only. */
function formatDateDDMMYYYY(dateStr: string) {
  const [y, m, d] = dateStr.split("-");
  return `${d}-${m}-${y}`;
}

// A 3-sub-column (Held / Attended / %) block per subject, plus an Overall
// block - shared by both Period and Till Now, since Till Now is really just
// Period with the date range pre-filled to "everything ever recorded" (see
// /api/college/section-attendance-report's tillNow mode) rather than a
// separately-shaped report.
function RangeReportTable({ subjects, students, summary }: {
  subjects: SubjectColumn[];
  students: RangeStudentRow[];
  summary: RangeSummary;
}) {
  return (
    <>
      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <tr>
                <th rowSpan={2} className="px-4 py-3 text-left align-bottom">Registration No.</th>
                <th rowSpan={2} className="px-4 py-3 text-left align-bottom">Name</th>
                {subjects.map((s) => (
                  <th key={s.subjectId} colSpan={3} className="border-l px-4 py-2 text-center" title={s.subjectName}>
                    {s.subjectCode || s.subjectName}
                  </th>
                ))}
                <th colSpan={3} className="border-l px-4 py-2 text-center">Overall Attendance</th>
              </tr>
              <tr>
                {subjects.map((s) => (
                  <Fragment key={s.subjectId}>
                    <th className="border-l px-3 py-2 text-center font-normal">Held</th>
                    <th className="px-3 py-2 text-center font-normal">Attended</th>
                    <th className="px-3 py-2 text-center font-normal">%</th>
                  </Fragment>
                ))}
                <th className="border-l px-3 py-2 text-center font-normal">Held</th>
                <th className="px-3 py-2 text-center font-normal">Attended</th>
                <th className="px-3 py-2 text-center font-normal">%</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {students.map((s) => (
                <tr key={s.studentId}>
                  <td className="px-4 py-2.5">{s.rollNumber}</td>
                  <td className="px-4 py-2.5 font-medium">{s.name}</td>
                  {subjects.map((sub) => {
                    const stat = s.bySubject[sub.subjectId] ?? { held: 0, attended: 0, percentage: 0 };
                    return (
                      <Fragment key={sub.subjectId}>
                        <td className="border-l px-3 py-2.5 text-center">{stat.held}</td>
                        <td className="px-3 py-2.5 text-center">{stat.attended}</td>
                        <td className="px-3 py-2.5 text-center font-medium">{stat.percentage}%</td>
                      </Fragment>
                    );
                  })}
                  <td className="border-l px-3 py-2.5 text-center font-semibold">{s.overall.held}</td>
                  <td className="px-3 py-2.5 text-center font-semibold">{s.overall.attended}</td>
                  <td className="px-3 py-2.5 text-center font-semibold">{s.overall.percentage}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900">
        <span className="font-semibold uppercase tracking-wide text-xs text-blue-700">Total Attendance</span>
        <span>Total Periods Held: <strong>{summary.totalPeriodsHeld}</strong></span>
        <span>Total Periods Attended: <strong>{summary.totalPeriodsAttended}</strong></span>
        <span>Overall Attendance: <strong>{summary.overallPercentage}%</strong></span>
      </div>
    </>
  );
}

// Step 2-3: Monthly / Period / Till now, scoped to the one section picked in
// step 1.
//   - Monthly resolves an academic-year + month pair (dropdowns, not the
//     original year-pills/month-tiles) to a plain calendar year/month and
//     moves on to the day-wise/weekly report (step 4, its own date
//     selector).
//   - Period and Till Now render inline on this same page (no further
//     navigation): both hit the same /api/college/section-attendance-report
//     range mode (Till Now = every SUBMITTED session ever recorded for the
//     section, no explicit dates) and render the same Subject x
//     (Held/Attended/%) + Overall pivot, aggregated across every
//     faculty/subject assigned to this section - never scoped to one
//     calendar day like Monthly's per-date report.
export default function HodAttendanceReportYearMonthPage() {
  const router = useRouter();
  const { sectionId } = useParams<{ sectionId: string }>();
  const searchParams = useSearchParams();
  const sectionLabel = searchParams.get("label") || "Section";

  const currentStart = currentAcademicStartYear();
  const academicYearOptions = [currentStart + 1, currentStart, currentStart - 1, currentStart - 2];

  const [mode, setMode] = useState<"monthly" | "period" | "tillnow">("monthly");
  const [academicStartYear, setAcademicStartYear] = useState(currentStart);
  const [month, setMonth] = useState(new Date().getMonth() + 1);

  function viewMonthlyReport() {
    const year = calendarYearForMonth(academicStartYear, month);
    router.push(`/hod/monthly-records/${sectionId}/${year}/${month}?label=${encodeURIComponent(sectionLabel)}`);
  }

  // ── Period / Till Now ────────────────────────────────────────────────────
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [rangeSubjects, setRangeSubjects] = useState<SubjectColumn[]>([]);
  const [rangeStudents, setRangeStudents] = useState<RangeStudentRow[]>([]);
  const [rangeSummary, setRangeSummary] = useState<RangeSummary | null>(null);
  const [isLoadingRange, setIsLoadingRange] = useState(false);
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [hasLoadedRange, setHasLoadedRange] = useState(false);

  const periodRangeReady = mode === "period" && !!fromDate && !!toDate && fromDate <= toDate;
  const periodRangeInvalid = mode === "period" && !!fromDate && !!toDate && fromDate > toDate;

  useEffect(() => {
    // Wrapped so setState calls aren't reachable synchronously from the
    // effect body (react-hooks/set-state-in-effect) - including the "not
    // ready yet" reset branch, not just the fetch.
    void (async () => {
      if (mode === "monthly") return;
      if (mode === "period" && !periodRangeReady) {
        setRangeSubjects([]);
        setRangeStudents([]);
        setRangeSummary(null);
        setHasLoadedRange(false);
        return;
      }
      setIsLoadingRange(true);
      setRangeError(null);
      try {
        const params = new URLSearchParams({ sectionId });
        if (mode === "tillnow") {
          params.set("tillNow", "true");
        } else {
          params.set("from", fromDate);
          params.set("to", toDate);
        }
        const res = await fetch(`/api/college/section-attendance-report?${params.toString()}`);
        const json = (await res.json()) as {
          subjects?: SubjectColumn[];
          students?: RangeStudentRow[];
          summary?: RangeSummary;
          error?: string;
        };
        if (!res.ok) {
          setRangeError(json.error ?? "Failed to load report");
          return;
        }
        setRangeSubjects(json.subjects ?? []);
        setRangeStudents(json.students ?? []);
        setRangeSummary(json.summary ?? { totalPeriodsHeld: 0, totalPeriodsAttended: 0, overallPercentage: 0 });
        setHasLoadedRange(true);
      } catch {
        setRangeError("Failed to load report");
      } finally {
        setIsLoadingRange(false);
      }
    })();
  }, [mode, sectionId, fromDate, toDate, periodRangeReady]);

  function handleModeChange(next: "monthly" | "period" | "tillnow") {
    setMode(next);
    setRangeError(null);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={sectionLabel}
        description="Pick a month, a custom date range, or this section's entire history, to view its attendance report."
        actions={
          <Button variant="outline" onClick={() => router.push("/hod/monthly-records")}>
            <ArrowLeft className="h-4 w-4 mr-2" />Back
          </Button>
        }
      />

      <SegmentedTabs
        value={mode}
        onChange={(v) => handleModeChange(v as "monthly" | "period" | "tillnow")}
        options={[
          { key: "monthly", label: "Monthly" },
          { key: "period", label: "Period" },
          { key: "tillnow", label: "Till now" },
        ]}
      />

      {mode === "monthly" && (
        <Card>
          <CardContent className="p-4 flex flex-wrap items-end gap-3">
            <div className="w-40 space-y-1.5">
              <label className="text-sm font-medium">Academic Year</label>
              <select
                className={selectClass}
                value={academicStartYear}
                onChange={(e) => setAcademicStartYear(Number(e.target.value))}
              >
                {academicYearOptions.map((start) => (
                  <option key={start} value={start}>{academicSessionLabel(start)}</option>
                ))}
              </select>
            </div>
            <div className="w-40 space-y-1.5">
              <label className="text-sm font-medium">Month</label>
              <select className={selectClass} value={month} onChange={(e) => setMonth(Number(e.target.value))}>
                {MONTH_LABELS.map((label, i) => (
                  <option key={label} value={i + 1}>{label}</option>
                ))}
              </select>
            </div>
            <Button onClick={viewMonthlyReport}>View Report</Button>
          </CardContent>
        </Card>
      )}

      {mode === "period" && (
        <>
          <Card>
            <CardContent className="flex flex-wrap items-end gap-3 pt-6">
              <div className="space-y-2">
                <label className="text-sm font-medium">From Date</label>
                <Input type="date" value={fromDate} max={toDate || todayStr()} onChange={(e) => setFromDate(e.target.value)} className="w-44" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">To Date</label>
                <Input type="date" value={toDate} min={fromDate || undefined} max={todayStr()} onChange={(e) => setToDate(e.target.value)} className="w-44" />
              </div>
            </CardContent>
          </Card>

          {periodRangeInvalid && (
            <p className="text-sm text-destructive">From Date must be on or before To Date.</p>
          )}

          {!fromDate || !toDate ? (
            <Card>
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                Select both a From Date and a To Date to view attendance for that range.
              </CardContent>
            </Card>
          ) : isLoadingRange ? (
            <div className="h-64 rounded-lg border bg-muted/30 animate-pulse" />
          ) : rangeError ? (
            <Card>
              <CardContent className="py-12 text-center text-sm text-muted-foreground">{rangeError}</CardContent>
            </Card>
          ) : hasLoadedRange && (rangeSubjects.length === 0 || rangeStudents.length === 0) ? (
            <Card>
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                No attendance record for {sectionLabel} between {formatDateDDMMYYYY(fromDate)} and {formatDateDDMMYYYY(toDate)}.
              </CardContent>
            </Card>
          ) : hasLoadedRange && rangeSummary ? (
            <RangeReportTable subjects={rangeSubjects} students={rangeStudents} summary={rangeSummary} />
          ) : null}
        </>
      )}

      {mode === "tillnow" && (
        isLoadingRange ? (
          <div className="h-64 rounded-lg border bg-muted/30 animate-pulse" />
        ) : rangeError ? (
          <Card>
            <CardContent className="py-12 text-center text-sm text-muted-foreground">{rangeError}</CardContent>
          </Card>
        ) : rangeSubjects.length === 0 || rangeStudents.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-sm text-muted-foreground">
              No attendance records for {sectionLabel} yet.
            </CardContent>
          </Card>
        ) : rangeSummary ? (
          <RangeReportTable subjects={rangeSubjects} students={rangeStudents} summary={rangeSummary} />
        ) : null
      )}
    </div>
  );
}
