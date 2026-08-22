"use client";

import { Fragment, useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/useToast";

interface SubjectColumn {
  subjectId: string;
  subjectName: string;
  subjectCode: string;
}
interface SubjectStats {
  held: number;
  attend: number;
  percent: number | null;
}
interface StudentRow {
  id: string;
  rollNumber: string;
  name: string;
  bySubject: Record<string, SubjectStats>;
}

function PercentCell({ value }: { value: number | null }) {
  if (value == null) return <span className="text-muted-foreground">—</span>;
  return <span className={value < 75 ? "font-semibold text-red-600" : "text-foreground"}>{value.toFixed(2)}</span>;
}

/** "2026-08-18" -> "18-08-2026" */
function formatDateDDMMYYYY(dateStr: string) {
  const [y, m, d] = dateStr.split("-");
  return `${d}-${m}-${y}`;
}

// "Period" (from/to) or "Till now" (allTime) section-wide summary - every
// student x every subject's Held/Attend/%, no weekly breakdown (unlike the
// Monthly report's Month Report tab - a range spanning more than one month
// has no single calendar grid to align weeks against). See
// /api/college/section-attendance-report's summary+from/to/allTime branch.
export default function HodAttendanceRangeReportPage() {
  const router = useRouter();
  const { sectionId } = useParams<{ sectionId: string }>();
  const searchParams = useSearchParams();
  const sectionLabel = searchParams.get("label") || "Section";
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const allTime = searchParams.get("allTime") === "true";

  const [isLoading, setIsLoading] = useState(true);
  const [subjects, setSubjects] = useState<SubjectColumn[]>([]);
  const [students, setStudents] = useState<StudentRow[]>([]);

  useEffect(() => {
    void (async () => {
      setIsLoading(true);
      try {
        const params = new URLSearchParams({ sectionId, summary: "true" });
        if (allTime) params.set("allTime", "true");
        else {
          if (from) params.set("from", from);
          if (to) params.set("to", to);
        }
        const res = await fetch(`/api/college/section-attendance-report?${params.toString()}`);
        if (!res.ok) throw new Error("Failed to load report");
        const json = (await res.json()) as { subjects?: SubjectColumn[]; students?: StudentRow[] };
        setSubjects(json.subjects ?? []);
        setStudents(json.students ?? []);
      } catch {
        toast({ variant: "destructive", title: "Failed to load report" });
      } finally {
        setIsLoading(false);
      }
    })();
  }, [sectionId, from, to, allTime]);

  const rangeLabel = allTime
    ? "Entire history"
    : from && to
      ? `${formatDateDDMMYYYY(from)} – ${formatDateDDMMYYYY(to)}`
      : "";

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${sectionLabel} — ${rangeLabel}`}
        description="Section-wide attendance report."
        actions={
          <Button
            variant="outline"
            onClick={() => router.push(`/hod/monthly-records/${sectionId}?label=${encodeURIComponent(sectionLabel)}`)}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />Back
          </Button>
        }
      />

      {isLoading ? (
        <div className="h-64 rounded-lg border bg-muted/30 animate-pulse" />
      ) : subjects.length === 0 || students.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No attendance records for {sectionLabel} in this range.
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
                    <th key={s.subjectId} className="px-4 py-3 text-center border-l" colSpan={3} title={s.subjectName}>
                      {s.subjectCode || s.subjectName}
                    </th>
                  ))}
                </tr>
                <tr>
                  <th className="px-4 py-1"></th>
                  <th className="px-4 py-1"></th>
                  {subjects.map((s) => (
                    <Fragment key={s.subjectId}>
                      <th className="px-3 py-1 text-center font-normal border-l">Held</th>
                      <th className="px-3 py-1 text-center font-normal">Attend</th>
                      <th className="px-3 py-1 text-center font-normal">%</th>
                    </Fragment>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {students.map((s, i) => {
                  const historyHref = allTime
                    ? `/hod/students/${s.id}/attendance?name=${encodeURIComponent(s.name)}&mode=tillnow`
                    : `/hod/students/${s.id}/attendance?name=${encodeURIComponent(s.name)}&mode=period&from=${from}&to=${to}`;
                  return (
                  <tr key={`${s.rollNumber}-${i}`}>
                    <td className="px-4 py-2.5">
                      <Link href={historyHref} className="font-medium text-primary hover:underline">
                        {s.rollNumber}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 font-medium">{s.name}</td>
                    {subjects.map((sub) => {
                      const stats = s.bySubject[sub.subjectId];
                      return (
                        <Fragment key={sub.subjectId}>
                          <td className="px-3 py-2.5 text-center border-l">{stats?.held ?? 0}</td>
                          <td className="px-3 py-2.5 text-center">{stats?.attend ?? 0}</td>
                          <td className="px-3 py-2.5 text-center">
                            <PercentCell value={stats?.percent ?? null} />
                          </td>
                        </Fragment>
                      );
                    })}
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
