"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, CalendarDays, ChevronLeft, ChevronRight, CheckCircle2, XCircle } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
  rollNumber: string;
  name: string;
  statusBySubject: Record<string, StudentAttendanceMark | null>;
}
interface ClassworkEntry {
  subjectId: string;
  subjectName: string;
  classNotes: string;
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
  // starts and which date is pre-selected.
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

  // Same "land on the most recent date with a record" default this page
  // always had - just no longer gates whether the calendar itself shows.
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(
          `/api/college/section-attendance-report?sectionId=${encodeURIComponent(sectionId)}&year=${year}&month=${month}`
        );
        if (!res.ok) return;
        const json = (await res.json()) as { dates?: string[] };
        if (json.dates?.[0]) {
          setSelectedDate(json.dates[0]);
          setIsCalendarOpen(false);
        }
      } catch {
        // non-fatal - the calendar still works without a pre-selected date
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionId, year, month]);

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
            Pick a date on the calendar to view its attendance report.
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
                    <td className="px-4 py-2.5">{s.rollNumber}</td>
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
    </div>
  );
}
