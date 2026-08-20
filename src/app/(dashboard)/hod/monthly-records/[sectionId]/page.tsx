"use client";

import { Fragment, useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ChevronRight, CalendarRange } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { toast } from "@/hooks/useToast";

const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

type ReportMode = "MONTHLY" | "PERIOD" | "TILLNOW";

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

// Step 2 of the HOD's Attendance Reports: a Monthly / Period / Till Now
// mode switch, scoped to the one section picked in step 1.
//   - Monthly keeps the pre-existing Year pills + Month tiles flow exactly
//     as before, unmodified - it just leads on to /[year]/[month] same as
//     always.
//   - Period and Till Now are new: both hit the same
//     /api/college/section-attendance-report range mode (Till Now = every
//     SUBMITTED session ever recorded for the section, no explicit dates)
//     and render the same Subject x (Held/Attended/%) pivot, aggregated
//     across every faculty/subject assigned to this section - never scoped
//     to one calendar day like Monthly's per-date report.
export default function HodAttendanceReportYearMonthPage() {
  const router = useRouter();
  const { sectionId } = useParams<{ sectionId: string }>();
  const searchParams = useSearchParams();
  const sectionLabel = searchParams.get("label") || "Section";
  const currentYear = new Date().getFullYear();

  const [mode, setMode] = useState<ReportMode>("MONTHLY");

  // ── Monthly (unchanged) ────────────────────────────────────────────────
  const [years, setYears] = useState<number[] | null>(null);
  const [isLoadingYears, setIsLoadingYears] = useState(true);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);

  const [months, setMonths] = useState<number[] | null>(null);
  const [isLoadingMonths, setIsLoadingMonths] = useState(false);

  useEffect(() => {
    void (async () => {
      setIsLoadingYears(true);
      try {
        const res = await fetch(`/api/college/section-attendance-report?sectionId=${encodeURIComponent(sectionId)}`);
        if (!res.ok) throw new Error("Failed to load years");
        const json = (await res.json()) as { years?: number[] };
        const fetched = json.years ?? [];
        setYears(fetched);
        setSelectedYear(fetched.includes(currentYear) ? currentYear : (fetched[0] ?? currentYear));
      } catch {
        toast({ variant: "destructive", title: "Failed to load years" });
        setYears([]);
        setSelectedYear(currentYear);
      } finally {
        setIsLoadingYears(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionId]);

  useEffect(() => {
    if (selectedYear == null) return;
    void (async () => {
      setIsLoadingMonths(true);
      try {
        const res = await fetch(
          `/api/college/section-attendance-report?sectionId=${encodeURIComponent(sectionId)}&year=${selectedYear}`
        );
        if (!res.ok) throw new Error("Failed to load months");
        const json = (await res.json()) as { months?: number[] };
        setMonths(json.months ?? []);
      } catch {
        toast({ variant: "destructive", title: "Failed to load months" });
        setMonths([]);
      } finally {
        setIsLoadingMonths(false);
      }
    })();
  }, [sectionId, selectedYear]);

  const yearOptions = Array.from(new Set([...(years ?? []), currentYear])).sort((a, b) => b - a);

  // ── Period / Till Now ───────────────────────────────────────────────────
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [rangeSubjects, setRangeSubjects] = useState<SubjectColumn[]>([]);
  const [rangeStudents, setRangeStudents] = useState<RangeStudentRow[]>([]);
  const [rangeSummary, setRangeSummary] = useState<RangeSummary | null>(null);
  const [isLoadingRange, setIsLoadingRange] = useState(false);
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [hasLoadedRange, setHasLoadedRange] = useState(false);

  const periodRangeReady = mode === "PERIOD" && !!fromDate && !!toDate && fromDate <= toDate;
  const periodRangeInvalid = mode === "PERIOD" && !!fromDate && !!toDate && fromDate > toDate;

  useEffect(() => {
    // Wrapped so setState calls aren't reachable synchronously from the
    // effect body (react-hooks/set-state-in-effect) - including the "not
    // ready yet" reset branch, not just the fetch.
    void (async () => {
      if (mode === "MONTHLY") return;
      if (mode === "PERIOD" && !periodRangeReady) {
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
        if (mode === "TILLNOW") {
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

  function handleModeChange(next: ReportMode) {
    setMode(next);
    setRangeError(null);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={sectionLabel}
        description="Pick Monthly, Period, or Till Now to view this section's attendance report."
        actions={
          <Button variant="outline" onClick={() => router.push("/hod/monthly-records")}>
            <ArrowLeft className="h-4 w-4 mr-2" />Back
          </Button>
        }
      />

      <RadioGroup value={mode} onValueChange={(v) => handleModeChange(v as ReportMode)} className="flex flex-row flex-wrap gap-6">
        <label htmlFor="mode-monthly" className="flex items-center gap-2 text-sm font-medium cursor-pointer">
          <RadioGroupItem value="MONTHLY" id="mode-monthly" />
          Monthly
        </label>
        <label htmlFor="mode-period" className="flex items-center gap-2 text-sm font-medium cursor-pointer">
          <RadioGroupItem value="PERIOD" id="mode-period" />
          Period
        </label>
        <label htmlFor="mode-tillnow" className="flex items-center gap-2 text-sm font-medium cursor-pointer">
          <RadioGroupItem value="TILLNOW" id="mode-tillnow" />
          Till Now
        </label>
      </RadioGroup>

      {mode === "MONTHLY" && (
        <>
          {isLoadingYears ? (
            <div className="h-10 w-64 rounded-lg bg-muted/30 animate-pulse" />
          ) : (
            <div className="flex flex-wrap gap-2">
              {yearOptions.map((y) => (
                <Button
                  key={y}
                  size="sm"
                  variant={selectedYear === y ? "default" : "outline"}
                  onClick={() => setSelectedYear(y)}
                >
                  {y}
                </Button>
              ))}
            </div>
          )}

          {!isLoadingYears && (
            isLoadingMonths ? (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {[1, 2, 3].map((i) => <div key={i} className="h-20 rounded-lg border bg-muted/30 animate-pulse" />)}
              </div>
            ) : !months || months.length === 0 ? (
              <Card>
                <CardContent className="py-12 text-center text-sm text-muted-foreground">
                  No attendance records for {selectedYear} yet.
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {months.map((m) => (
                  <Card
                    key={m}
                    className="cursor-pointer transition-colors hover:border-primary/50"
                    onClick={() =>
                      router.push(
                        `/hod/monthly-records/${sectionId}/${selectedYear}/${m}?label=${encodeURIComponent(sectionLabel)}`
                      )
                    }
                  >
                    <CardContent className="p-4 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <CalendarRange className="h-4 w-4 text-muted-foreground shrink-0" />
                        <p className="font-semibold text-sm">{MONTH_LABELS[m - 1]}</p>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                    </CardContent>
                  </Card>
                ))}
              </div>
            )
          )}
        </>
      )}

      {mode === "PERIOD" && (
        <>
          <Card>
            <CardContent className="flex flex-wrap items-end gap-3 pt-6">
              <div className="space-y-2">
                <Label htmlFor="period-from">From Date</Label>
                <Input id="period-from" type="date" value={fromDate} max={toDate || todayStr()} onChange={(e) => setFromDate(e.target.value)} className="w-44" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="period-to">To Date</Label>
                <Input id="period-to" type="date" value={toDate} min={fromDate || undefined} max={todayStr()} onChange={(e) => setToDate(e.target.value)} className="w-44" />
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

      {mode === "TILLNOW" && (
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
