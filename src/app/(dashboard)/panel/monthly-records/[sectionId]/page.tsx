"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SegmentedTabs } from "@/components/shared/SegmentedTabs";
import {
  SubjectRangeSummaryTables, type SubjectColumn, type SubjectRangeStudentRow,
} from "@/components/attendance/SubjectRangeSummaryTables";

const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const selectClass =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:border-primary focus:outline-none";

/** "2026-08-18" -> "18-08-2026" - display only. */
function formatDateDDMMYYYY(dateStr: string) {
  const [y, m, d] = dateStr.split("-");
  return `${d}-${m}-${y}`;
}

// Step 2-3: Monthly / Period / Till now, scoped to the one section picked in
// step 1.
//   - Monthly is a Month + Year dropdown pair (every month always offered,
//     not just ones with existing records) - picking "View Report" leads on
//     to the day-view calendar (step 4), which still shows Class Work notes
//     alongside attendance, something a range summary has no single date to
//     attach to.
//   - Period and Till Now render inline on this page, no further
//     navigation - Registration No/Name x this faculty's own subject(s) in
//     this section (Held/Attend/%), aggregated across every submitted
//     session in range. Never any OTHER faculty's subjects in the same
//     section (see /api/college/class-work-records's summary mode, already
//     scoped to the caller's own facultyId).
export default function FacultyAttendanceReportYearMonthPage() {
  const router = useRouter();
  const { sectionId } = useParams<{ sectionId: string }>();
  const searchParams = useSearchParams();
  const sectionLabel = searchParams.get("label") || "Section";
  const now = new Date();

  const [mode, setMode] = useState<"monthly" | "period" | "tillnow" | "semester">("monthly");

  // This section's configured semester numbers (course-year's
  // CourseYearTiming) - empty when none are set up, which keeps the
  // Semester tab hidden below.
  const [availableSemesters, setAvailableSemesters] = useState<number[]>([]);
  const [semester, setSemester] = useState<number | null>(null);
  useEffect(() => {
    fetch(`/api/college/class-work-records?sectionId=${sectionId}&optionsOnly=true`)
      .then((r) => r.json() as Promise<{ availableSemesters?: number[] }>)
      .then((json) => setAvailableSemesters(json.availableSemesters ?? []))
      .catch(() => { /* Semester tab just stays hidden */ });
  }, [sectionId]);

  // ── Monthly ───────────────────────────────────────────────────────────────
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1);
  const yearOptions = [now.getFullYear(), now.getFullYear() - 1, now.getFullYear() - 2, now.getFullYear() - 3];

  function viewMonthlyReport() {
    router.push(`/panel/monthly-records/${sectionId}/${selectedYear}/${selectedMonth}?label=${encodeURIComponent(sectionLabel)}`);
  }

  // ── Period / Till Now ────────────────────────────────────────────────────
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [rangeSubjects, setRangeSubjects] = useState<SubjectColumn[]>([]);
  const [rangeStudents, setRangeStudents] = useState<SubjectRangeStudentRow[]>([]);
  const [isLoadingRange, setIsLoadingRange] = useState(false);
  const [rangeError, setRangeError] = useState<string | null>(null);
  const [hasLoadedRange, setHasLoadedRange] = useState(false);

  const periodRangeReady = mode === "period" && !!fromDate && !!toDate && fromDate <= toDate;
  const periodRangeInvalid = mode === "period" && !!fromDate && !!toDate && fromDate > toDate;

  useEffect(() => {
    void (async () => {
      if (mode === "monthly") return;
      if (mode === "period" && !periodRangeReady) {
        setRangeSubjects([]);
        setRangeStudents([]);
        setHasLoadedRange(false);
        return;
      }
      if (mode === "semester" && semester == null) {
        setRangeSubjects([]);
        setRangeStudents([]);
        setHasLoadedRange(false);
        return;
      }
      setIsLoadingRange(true);
      setRangeError(null);
      try {
        const params = new URLSearchParams({ sectionId, summary: "true" });
        if (mode === "tillnow") {
          params.set("allTime", "true");
        } else if (mode === "semester") {
          params.set("semester", String(semester));
        } else {
          params.set("from", fromDate);
          params.set("to", toDate);
        }
        const res = await fetch(`/api/college/class-work-records?${params.toString()}`);
        const json = (await res.json()) as { subjects?: SubjectColumn[]; students?: SubjectRangeStudentRow[]; availableSemesters?: number[]; error?: string };
        if (!res.ok) {
          setRangeError(json.error ?? "Failed to load report");
          return;
        }
        setRangeSubjects(json.subjects ?? []);
        setRangeStudents(json.students ?? []);
        if (json.availableSemesters) setAvailableSemesters(json.availableSemesters);
        setHasLoadedRange(true);
      } catch {
        setRangeError("Failed to load report");
      } finally {
        setIsLoadingRange(false);
      }
    })();
  }, [mode, sectionId, fromDate, toDate, periodRangeReady, semester]);

  function handleModeChange(next: "monthly" | "period" | "tillnow" | "semester") {
    setMode(next);
    setRangeError(null);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={sectionLabel}
        description="Pick a month, a custom date range, or your entire history teaching this section, to view attendance for your own subject."
        actions={
          <Button variant="outline" onClick={() => router.push("/panel/monthly-records")}>
            <ArrowLeft className="h-4 w-4 mr-2" />Back
          </Button>
        }
      />

      <SegmentedTabs
        value={mode}
        onChange={(v) => handleModeChange(v as "monthly" | "period" | "tillnow" | "semester")}
        options={[
          { key: "monthly", label: "Monthly" },
          { key: "period", label: "Period" },
          ...(availableSemesters.length > 0 ? [{ key: "semester", label: "Semester" }] : []),
          { key: "tillnow", label: "Till now" },
        ]}
      />

      {mode === "monthly" && (
        <Card>
          <CardContent className="p-4 flex flex-wrap items-end gap-3">
            <div className="w-40 space-y-1.5">
              <label className="text-sm font-medium">Month</label>
              <select className={selectClass} value={selectedMonth} onChange={(e) => setSelectedMonth(Number(e.target.value))}>
                {MONTH_LABELS.map((label, i) => (
                  <option key={label} value={i + 1}>{label}</option>
                ))}
              </select>
            </div>
            <div className="w-32 space-y-1.5">
              <label className="text-sm font-medium">Year</label>
              <select className={selectClass} value={selectedYear} onChange={(e) => setSelectedYear(Number(e.target.value))}>
                {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <Button onClick={viewMonthlyReport}>View Report</Button>
          </CardContent>
        </Card>
      )}

      {mode === "period" && (
        <div className="space-y-4">
          <Card>
            <CardContent className="flex flex-wrap items-end gap-3 pt-6">
              <div className="space-y-2">
                <label className="text-sm font-medium">From</label>
                <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="w-44" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">To</label>
                <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="w-44" />
              </div>
            </CardContent>
          </Card>

          {periodRangeInvalid && (
            <p className="text-sm text-destructive">From date must be before the To date.</p>
          )}

          {!fromDate || !toDate ? (
            <Card>
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                Select both a From and To date to view attendance for that range.
              </CardContent>
            </Card>
          ) : isLoadingRange ? (
            <div className="h-64 rounded-lg border bg-muted/30 animate-pulse" />
          ) : rangeError ? (
            <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">{rangeError}</CardContent></Card>
          ) : hasLoadedRange && (rangeSubjects.length === 0 || rangeStudents.length === 0) ? (
            <Card>
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                No attendance record for {sectionLabel} between {formatDateDDMMYYYY(fromDate)} and {formatDateDDMMYYYY(toDate)}.
              </CardContent>
            </Card>
          ) : hasLoadedRange ? (
            <SubjectRangeSummaryTables subjects={rangeSubjects} students={rangeStudents} />
          ) : null}
        </div>
      )}

      {mode === "semester" && (
        <div className="space-y-4">
          <Card>
            <CardContent className="flex flex-wrap items-end gap-3 pt-6">
              <div className="w-40 space-y-1.5">
                <label className="text-sm font-medium">Semester</label>
                <select
                  className={selectClass}
                  value={semester ?? ""}
                  onChange={(e) => setSemester(e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">Select</option>
                  {availableSemesters.map((s) => <option key={s} value={s}>Semester {s}</option>)}
                </select>
              </div>
            </CardContent>
          </Card>

          {semester == null ? (
            <Card>
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                Select a semester to view attendance for that range.
              </CardContent>
            </Card>
          ) : isLoadingRange ? (
            <div className="h-64 rounded-lg border bg-muted/30 animate-pulse" />
          ) : rangeError ? (
            <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">{rangeError}</CardContent></Card>
          ) : hasLoadedRange && (rangeSubjects.length === 0 || rangeStudents.length === 0) ? (
            <Card>
              <CardContent className="py-12 text-center text-sm text-muted-foreground">
                No attendance record for {sectionLabel} in Semester {semester}.
              </CardContent>
            </Card>
          ) : hasLoadedRange ? (
            <SubjectRangeSummaryTables subjects={rangeSubjects} students={rangeStudents} />
          ) : null}
        </div>
      )}

      {mode === "tillnow" && (
        isLoadingRange ? (
          <div className="h-64 rounded-lg border bg-muted/30 animate-pulse" />
        ) : rangeError ? (
          <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">{rangeError}</CardContent></Card>
        ) : rangeSubjects.length === 0 || rangeStudents.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-sm text-muted-foreground">
              No attendance records for {sectionLabel} yet.
            </CardContent>
          </Card>
        ) : (
          <SubjectRangeSummaryTables subjects={rangeSubjects} students={rangeStudents} />
        )
      )}
    </div>
  );
}
