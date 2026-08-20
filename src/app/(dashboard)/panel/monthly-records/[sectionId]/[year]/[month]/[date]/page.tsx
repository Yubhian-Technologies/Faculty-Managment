"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, CheckCircle2, XCircle } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/useToast";
import type { StudentAttendanceMark } from "@/types";

interface ClassWorkEntry {
  periodNumber: number;
  subjectName: string;
  classNotes: string;
}
interface StudentRow {
  studentId: string;
  rollNumber: string;
  name: string;
  statusByPeriod: Record<number, StudentAttendanceMark | null>;
}
interface SubjectAttendance {
  subjectId: string;
  subjectName: string;
  periods: number[];
  totalClasses: number;
  overallPercentage: number;
  percentageByStudent: Record<string, number>;
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

// Step 6: Class Work + a Regd No/Name x Period pivot for one exact section +
// date - only the period(s) this faculty actually taught this section that
// day appear as columns (see /api/college/class-work-records's sectionId+date
// mode), never a fixed/hard-coded period list.
export default function FacultyAttendanceReportDayPage() {
  const router = useRouter();
  const { sectionId, year, month, date } = useParams<{
    sectionId: string; year: string; month: string; date: string;
  }>();
  const searchParams = useSearchParams();
  const sectionLabel = searchParams.get("label") || "Section";

  const [classWork, setClassWork] = useState<ClassWorkEntry[]>([]);
  const [periods, setPeriods] = useState<number[]>([]);
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [subjects, setSubjects] = useState<SubjectAttendance[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      setIsLoading(true);
      try {
        const res = await fetch(
          `/api/college/class-work-records?sectionId=${encodeURIComponent(sectionId)}&year=${year}&month=${month}&date=${date}`
        );
        if (!res.ok) throw new Error("Failed to load report");
        const json = (await res.json()) as {
          classWork?: ClassWorkEntry[];
          periods?: number[];
          students?: StudentRow[];
          subjects?: SubjectAttendance[];
        };
        setClassWork(json.classWork ?? []);
        setPeriods(json.periods ?? []);
        setStudents(json.students ?? []);
        setSubjects(json.subjects ?? []);
      } catch {
        toast({ variant: "destructive", title: "Failed to load report" });
      } finally {
        setIsLoading(false);
      }
    })();
  }, [sectionId, year, month, date]);

  // One period column belongs to exactly one subject (see the API's doc-id
  // scheme: `${assignmentId}_${date}_${periodNumber}`), so each subject in
  // `subjects` owns a contiguous slice of `periods` - looked up per period
  // rather than assumed to line up 1:1, since a day can have more than one
  // subject (or the same subject taught in two consecutive periods).
  const subjectByPeriod = useMemo(() => {
    const map = new Map<number, SubjectAttendance>();
    for (const subj of subjects) for (const p of subj.periods) map.set(p, subj);
    return map;
  }, [subjects]);

  // Interleaves one "Attendance %" column right before each subject's first
  // period column that day - so a single-subject day (the common case) gets
  // exactly the Attendance % + Period layout requested, while a day spanning
  // more than one subject still gets each subject's own column rather than
  // one column wrongly averaging across different subjects.
  type ReportColumn = { type: "percent"; subject: SubjectAttendance } | { type: "period"; period: number };
  const columns = useMemo<ReportColumn[]>(() => {
    const cols: ReportColumn[] = [];
    let lastSubjectId: string | null = null;
    for (const p of periods) {
      const subj = subjectByPeriod.get(p);
      if (subj && subj.subjectId !== lastSubjectId) {
        cols.push({ type: "percent", subject: subj });
        lastSubjectId = subj.subjectId;
      }
      cols.push({ type: "period", period: p });
    }
    return cols;
  }, [periods, subjectByPeriod]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={sectionLabel}
        description={`Attendance report for ${formatDateDDMMYYYY(date)}`}
        actions={
          <Button
            variant="outline"
            onClick={() =>
              router.push(`/panel/monthly-records/${sectionId}/${year}/${month}?label=${encodeURIComponent(sectionLabel)}`)
            }
          >
            <ArrowLeft className="h-4 w-4 mr-2" />Back
          </Button>
        }
      />

      {isLoading ? (
        <div className="h-64 rounded-lg border bg-muted/30 animate-pulse" />
      ) : periods.length === 0 || students.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No attendance record for {sectionLabel} on {formatDateDDMMYYYY(date)}.
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardContent className="space-y-3 py-5">
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Date</p>
                <p className="text-sm font-semibold">{formatDateDDMMYYYY(date)}</p>
              </div>
              <div className="space-y-1.5">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Record of the Class Work</p>
                {classWork.map((c) => (
                  <p key={c.periodNumber} className="text-sm">
                    {periods.length > 1 && (
                      <span className="font-semibold">Period {c.periodNumber} ({c.subjectName}): </span>
                    )}
                    {c.classNotes || "—"}
                  </p>
                ))}
              </div>
            </CardContent>
          </Card>

          {subjects.length > 0 && (
            <div className="flex flex-wrap gap-3">
              {subjects.map((subj) => (
                <div
                  key={subj.subjectId}
                  className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5 text-sm text-blue-900"
                >
                  Overall Attendance{subjects.length > 1 ? ` — ${subj.subjectName}` : ""}:{" "}
                  <strong>{subj.overallPercentage}%</strong>
                </div>
              ))}
            </div>
          )}

          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">Registration Number</th>
                    <th className="px-4 py-3">Name</th>
                    {columns.map((col) =>
                      col.type === "percent" ? (
                        <th key={`pct-${col.subject.subjectId}`} className="px-4 py-3 text-center">
                          Attendance %{subjects.length > 1 ? ` (${col.subject.subjectName})` : ""}
                        </th>
                      ) : (
                        <th key={`p-${col.period}`} className="px-4 py-3 text-center">Period {col.period}</th>
                      )
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {students.map((s, i) => (
                    <tr key={`${s.rollNumber}-${i}`}>
                      <td className="px-4 py-2.5">{s.rollNumber}</td>
                      <td className="px-4 py-2.5 font-medium">{s.name}</td>
                      {columns.map((col) =>
                        col.type === "percent" ? (
                          <td key={`pct-${col.subject.subjectId}`} className="px-4 py-2.5 text-center font-semibold text-foreground">
                            {col.subject.percentageByStudent[s.studentId] ?? 0}%
                          </td>
                        ) : (
                          <td key={`p-${col.period}`} className="px-4 py-2.5 text-center">
                            <AttendanceMark status={s.statusByPeriod[col.period]} />
                          </td>
                        )
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
