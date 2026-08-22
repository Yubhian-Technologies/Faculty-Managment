"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, CalendarDays, ChevronLeft, ChevronRight, CheckCircle2, XCircle } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SegmentedTabs } from "@/components/shared/SegmentedTabs";
import { toast } from "@/hooks/useToast";
import type { StudentAttendanceMark } from "@/types";

const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

interface SubjectColumn {
  subjectId: string;
  subjectName: string;
  subjectCode: string;
}
interface StudentRow {
  id: string;
  rollNumber: string;
  name: string;
  statusBySubject: Record<string, StudentAttendanceMark | null>;
}
interface ClassworkEntry {
  subjectId: string;
  subjectName: string;
  classNotes: string;
}
interface SubjectMonthlyStats {
  weeks: (number | null)[];
  monthPresent: number;
  monthTotal: number;
  monthPercent: number | null;
}
interface StudentMonthlyRow {
  id: string;
  rollNumber: string;
  name: string;
  bySubject: Record<string, SubjectMonthlyStats>;
}

function toDateStr(y: number, m: number, d: number) {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** "2026-08-18" -> "18-08-2026" */
function formatDateDDMMYYYY(dateStr: string) {
  const [y, m, d] = dateStr.split("-");
  return `${d}-${m}-${y}`;
}

function AttendanceMark({ status }: { status: StudentAttendanceMark | null | undefined }) {
  if (status === "PRESENT") {
    return (
      <span className="inline-flex items-center justify-center" title="Present">
        <CheckCircle2 className="h-5 w-5 text-emerald-500" />
      </span>
    );
  }
  if (status === "ABSENT") {
    return (
      <span className="inline-flex items-center justify-center" title="Absent">
        <XCircle className="h-5 w-5 text-red-500" />
      </span>
    );
  }
  return <span className="text-muted-foreground">—</span>;
}

function PercentCell({ value }: { value: number | null }) {
  if (value == null) return <span className="text-muted-foreground">—</span>;
  return <span className={value < 75 ? "font-semibold text-red-600" : "text-foreground"}>{value}%</span>;
}

// Step 4: a Sun-Sat month calendar (browsable with prev/next, independent of
// the report fetch itself) picks the date that drives one Registration
// No/Name x Subject pivot, aggregated across every faculty who teaches this
// section - unlike the Faculty Attendance Report, which is scoped to one
// faculty's own periods. Subject columns come from the section's current
// teaching assignments (never hard-coded), status/classwork from that date's
// submitted sessions - see /api/college/section-attendance-report. Every day
// in the calendar is clickable (not just days with an existing record) -
// picking an empty one just shows the report's own "no record" state.
export default function HodAttendanceReportPage() {
  const router = useRouter();
  const { sectionId, year, month } = useParams<{ sectionId: string; year: string; month: string }>();
  const searchParams = useSearchParams();
  const sectionLabel = searchParams.get("label") || "Section";

  // The calendar can be browsed to adjacent months independently of the
  // year/month chosen on the previous step - that step only seeds where it
  // starts.
  const [displayYear, setDisplayYear] = useState(Number(year));
  const [displayMonth, setDisplayMonth] = useState(Number(month)); // 1-12

  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  // Collapsible date picker: open by default (nothing picked yet); a click
  // on any day collapses it down to just the picked date, and clicking that
  // date chip re-opens the calendar for a new pick.
  const [isCalendarOpen, setIsCalendarOpen] = useState(true);

  const [subjects, setSubjects] = useState<SubjectColumn[]>([]);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [classwork, setClasswork] = useState<ClassworkEntry[]>([]);
  const [isLoadingReport, setIsLoadingReport] = useState(false);

  // "Day-wise" is the original calendar + single-date pivot below; "Month
  // Report" is the new subject-wise weekly/monthly percentage view - fetched
  // lazily (only once this tab is actually opened) and refetched whenever
  // the day-wise calendar navigates to a different month, so both tabs
  // always agree on which month they're showing.
  const [activeView, setActiveView] = useState<"day" | "month">("day");
  const [monthSubjects, setMonthSubjects] = useState<SubjectColumn[]>([]);
  const [monthStudents, setMonthStudents] = useState<StudentMonthlyRow[]>([]);
  const [isLoadingMonthReport, setIsLoadingMonthReport] = useState(false);

  useEffect(() => {
    if (activeView !== "month") return;
    void (async () => {
      setIsLoadingMonthReport(true);
      try {
        const res = await fetch(
          `/api/college/section-attendance-report?sectionId=${encodeURIComponent(sectionId)}&year=${displayYear}&month=${displayMonth}&summary=true`
        );
        if (!res.ok) throw new Error("Failed to load month report");
        const json = (await res.json()) as {
          subjects?: SubjectColumn[];
          students?: StudentMonthlyRow[];
        };
        setMonthSubjects(json.subjects ?? []);
        setMonthStudents(json.students ?? []);
      } catch {
        toast({ variant: "destructive", title: "Failed to load month report" });
      } finally {
        setIsLoadingMonthReport(false);
      }
    })();
  }, [sectionId, displayYear, displayMonth, activeView]);

  useEffect(() => {
    if (!selectedDate) return;
    const [y, m] = selectedDate.split("-");
    void (async () => {
      setIsLoadingReport(true);
      try {
        const res = await fetch(
          `/api/college/section-attendance-report?sectionId=${encodeURIComponent(sectionId)}&year=${y}&month=${Number(m)}&date=${selectedDate}`
        );
        if (!res.ok) throw new Error("Failed to load report");
        const json = (await res.json()) as {
          subjects?: SubjectColumn[];
          students?: StudentRow[];
          classwork?: ClassworkEntry[];
        };
        setSubjects(json.subjects ?? []);
        setStudents(json.students ?? []);
        setClasswork(json.classwork ?? []);
      } catch {
        toast({ variant: "destructive", title: "Failed to load report" });
      } finally {
        setIsLoadingReport(false);
      }
    })();
  }, [sectionId, selectedDate]);

  function handleSelectDate(dateStr: string) {
    setSelectedDate(dateStr);
    setIsCalendarOpen(false);
  }

  function goToMonth(delta: number) {
    let m = displayMonth + delta;
    let y = displayYear;
    if (m < 1) { m = 12; y -= 1; }
    if (m > 12) { m = 1; y += 1; }
    setDisplayMonth(m);
    setDisplayYear(y);
  }

  const monthLabel = MONTH_LABELS[displayMonth - 1];
  const daysInMonth = new Date(displayYear, displayMonth, 0).getDate();
  const firstWeekday = new Date(displayYear, displayMonth - 1, 1).getDay(); // 0 = Sunday

  const cells: (number | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${sectionLabel} — ${monthLabel} ${displayYear}`}
        description="Section-wide attendance and classwork report."
        actions={
          <Button
            variant="outline"
            onClick={() => router.push(`/hod/monthly-records/${sectionId}?label=${encodeURIComponent(sectionLabel)}`)}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />Back
          </Button>
        }
      />

      <SegmentedTabs
        value={activeView}
        onChange={(v) => setActiveView(v as "day" | "month")}
        options={[
          { key: "day", label: "Day-wise" },
          { key: "month", label: "Month Report" },
        ]}
      />

      {activeView === "day" && (
      <>
      {isCalendarOpen ? (
        <Card className="w-full max-w-xs overflow-hidden">
          <div className="flex items-center justify-between bg-primary px-1 py-1.5">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-primary-foreground hover:bg-primary-foreground/20 hover:text-primary-foreground"
              onClick={() => goToMonth(-1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <p className="text-sm font-bold text-primary-foreground">{monthLabel} {displayYear}</p>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-primary-foreground hover:bg-primary-foreground/20 hover:text-primary-foreground"
              onClick={() => goToMonth(1)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <CardContent className="p-3">
            <div className="grid grid-cols-7 gap-0.5 text-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {WEEKDAY_LABELS.map((w) => <div key={w}>{w}</div>)}
            </div>
            <div className="mt-1 grid grid-cols-7 gap-0.5">
              {cells.map((day, i) => {
                if (day == null) return <div key={i} className="aspect-square" />;
                const dateStr = toDateStr(displayYear, displayMonth, day);
                const isSelected = dateStr === selectedDate;
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => handleSelectDate(dateStr)}
                    className={[
                      "aspect-square rounded-md text-xs flex items-center justify-center transition-colors",
                      isSelected
                        ? "bg-primary font-semibold text-primary-foreground"
                        : "text-foreground hover:bg-muted",
                    ].join(" ")}
                  >
                    {day}
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>
      ) : (
        <button
          type="button"
          onClick={() => setIsCalendarOpen(true)}
          className="flex w-full max-w-xs items-center gap-2 rounded-lg border bg-background px-4 py-3 text-sm font-medium transition-colors hover:border-primary/50 hover:bg-muted/40"
        >
          <CalendarDays className="h-4 w-4 text-muted-foreground shrink-0" />
          {selectedDate ? formatDateDDMMYYYY(selectedDate) : "Pick a date"}
        </button>
      )}

      {isLoadingReport ? (
        <div className="h-64 rounded-lg border bg-muted/30 animate-pulse" />
      ) : !selectedDate ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Select a date to view attendance records.
          </CardContent>
        </Card>
      ) : subjects.length === 0 || students.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No attendance record for {sectionLabel} on {formatDateDDMMYYYY(selectedDate)}.
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Registration No.</th>
                  <th className="px-4 py-3">Name</th>
                  {subjects.map((s) => (
                    <th key={s.subjectId} className="px-4 py-3 text-center" title={s.subjectName}>
                      {s.subjectCode || s.subjectName}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {students.map((s, i) => (
                  <tr key={`${s.rollNumber}-${i}`}>
                    <td className="px-4 py-2.5">
                      <Link
                        href={`/hod/students/${s.id}/attendance?name=${encodeURIComponent(s.name)}&mode=monthly&year=${displayYear}&month=${displayMonth}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {s.rollNumber}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 font-medium">{s.name}</td>
                    {subjects.map((sub) => (
                      <td key={sub.subjectId} className="px-4 py-2.5 text-center">
                        <AttendanceMark status={s.statusBySubject[sub.subjectId]} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 bg-muted/40">
                  <td colSpan={2} className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Classwork
                  </td>
                  {subjects.map((sub) => (
                    <td key={sub.subjectId} className="px-4 py-2.5 text-center text-xs text-foreground">
                      {classwork.find((c) => c.subjectId === sub.subjectId)?.classNotes || "—"}
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
      )}
      </>
      )}

      {activeView === "month" && (
        isLoadingMonthReport ? (
          <div className="h-64 rounded-lg border bg-muted/30 animate-pulse" />
        ) : monthSubjects.length === 0 || monthStudents.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-sm text-muted-foreground">
              No attendance records for {sectionLabel} in {monthLabel} {displayYear}.
            </CardContent>
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">Registration No.</th>
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3 text-center">Month %</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {monthStudents.map((s, i) => {
                    // Overall for the month, across every subject combined -
                    // per-subject Held/Attend/% (and the weekly breakdown)
                    // live on the student's own Attendance History page,
                    // reached via the Registration No. link - this table
                    // stays a scannable one-number-per-student overview.
                    const subjectStats = Object.values(s.bySubject);
                    const monthTotal = subjectStats.reduce((a, v) => a + v.monthTotal, 0);
                    const monthPresent = subjectStats.reduce((a, v) => a + v.monthPresent, 0);
                    const overallPercent = monthTotal > 0 ? Math.round((monthPresent / monthTotal) * 10000) / 100 : null;
                    return (
                      <tr key={`${s.rollNumber}-${i}`}>
                        <td className="px-4 py-2.5">
                          <Link
                            href={`/hod/students/${s.id}/attendance?name=${encodeURIComponent(s.name)}&mode=monthly&year=${displayYear}&month=${displayMonth}`}
                            className="font-medium text-primary hover:underline"
                          >
                            {s.rollNumber}
                          </Link>
                        </td>
                        <td className="px-4 py-2.5 font-medium">{s.name}</td>
                        <td className="px-4 py-2.5 text-center font-medium">
                          <PercentCell value={overallPercent} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )
      )}
    </div>
  );
}
