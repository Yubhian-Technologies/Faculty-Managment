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

// Step 7 (final): a collapsible Sun-Sat month calendar picks the date that
// drives the Registration No/Name x Subject report - the exact same
// /api/college/section-attendance-report data the HOD Dashboard's Attendance
// Report uses (unchanged; this route is GET-only and view-only for
// Principal/VP). The API itself still returns every subject assigned to the
// section (its query/logic is untouched, per the HOD flow it's shared with)
// - this page just displays only the ONE subject column the Principal picked
// on the previous "Subject" step, so that selection is what actually
// narrows the report.
export default function PrincipalAttendanceReportPage() {
  const router = useRouter();
  const { departmentId, courseId, sectionId, subjectId, year, month } = useParams<{
    departmentId: string; courseId: string; sectionId: string; subjectId: string; year: string; month: string;
  }>();
  const searchParams = useSearchParams();
  const deptLabel = searchParams.get("deptLabel") || "Department";
  const courseLabel = searchParams.get("courseLabel") || "Course";
  const sectionLabel = searchParams.get("sectionLabel") || "Section";
  const subjectLabel = searchParams.get("subjectLabel") || "Subject";

  const [displayYear, setDisplayYear] = useState(Number(year));
  const [displayMonth, setDisplayMonth] = useState(Number(month)); // 1-12

  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [isCalendarOpen, setIsCalendarOpen] = useState(true);

  const [subjects, setSubjects] = useState<SubjectColumn[]>([]);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [classwork, setClasswork] = useState<ClassworkEntry[]>([]);
  const [isLoadingReport, setIsLoadingReport] = useState(false);

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

  // Only the subject the Principal picked on the previous step - the API's
  // own subject list/query is untouched, this is a display-only filter.
  const subjectColumns = subjects.filter((s) => s.subjectId === subjectId);
  const subjectClasswork = classwork.filter((c) => c.subjectId === subjectId);

  const backHref = `/principal/attendance-reports/${departmentId}/${courseId}/${sectionId}/${subjectId}?deptLabel=${encodeURIComponent(deptLabel)}&courseLabel=${encodeURIComponent(courseLabel)}&sectionLabel=${encodeURIComponent(sectionLabel)}&subjectLabel=${encodeURIComponent(subjectLabel)}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${sectionLabel} · ${subjectLabel} — ${monthLabel} ${displayYear}`}
        description="Attendance and classwork report."
        actions={
          <Button variant="outline" onClick={() => router.push(backHref)}>
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
            <p className="text-sm font-semibold text-primary-foreground">{monthLabel} {displayYear}</p>
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
            <div className="grid grid-cols-7 gap-0.5 text-center text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
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
                        ? "bg-primary font-medium text-primary-foreground"
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
      ) : subjectColumns.length === 0 || students.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No attendance record for {subjectLabel} in {sectionLabel} on {formatDateDDMMYYYY(selectedDate)}.
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
                  {subjectColumns.map((s) => (
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
                    {subjectColumns.map((sub) => (
                      <td key={sub.subjectId} className="px-4 py-2.5 text-center">
                        <AttendanceMark status={s.statusBySubject[sub.subjectId]} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 bg-muted/40">
                  <td colSpan={2} className="px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Classwork
                  </td>
                  {subjectColumns.map((sub) => (
                    <td key={sub.subjectId} className="px-4 py-2.5 text-center text-xs text-foreground">
                      {subjectClasswork.find((c) => c.subjectId === sub.subjectId)?.classNotes || "—"}
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
