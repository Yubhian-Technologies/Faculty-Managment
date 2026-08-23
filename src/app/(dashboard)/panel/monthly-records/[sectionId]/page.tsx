"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SegmentedTabs } from "@/components/shared/SegmentedTabs";
import { toast } from "@/hooks/useToast";

const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

interface SubjectColumn {
  assignmentId: string;
  subjectId: string;
  subjectName: string;
}
interface SubjectStat {
  held: number;
  attend: number;
  percent: number | null;
}
interface StudentRow {
  id: string;
  rollNumber: string;
  name: string;
  bySubject: Record<string, SubjectStat>;
}

function PercentCell({ value }: { value: number | null }) {
  if (value == null) return <span className="text-muted-foreground">—</span>;
  return <span className={value < 75 ? "font-semibold text-red-600" : "text-foreground"}>{value.toFixed(2)}</span>;
}

/** "2026-08-18" -> "18-08-2026" - display only. */
function formatDateDDMMYYYY(dateStr: string) {
  const [y, m, d] = dateStr.split("-");
  return `${d}-${m}-${y}`;
}

// Step 2-3: Monthly / Period / Till now, scoped to the one section picked in
// step 1.
//   - Monthly keeps the pre-existing Year pills + Month tiles flow exactly
//     as before, unmodified - it leads on to the day-view calendar (step 4),
//     which still shows Class Work notes alongside attendance, something a
//     range summary has no single date to attach to.
//   - Period and Till Now are new: both render inline on this page, no
//     further navigation - Registration No/Name x this faculty's own
//     subject(s) in this section (Held/Attend/%), aggregated across every
//     submitted session in range. Never any OTHER faculty's subjects in the
//     same section (see /api/college/class-work-records's summary mode,
//     already scoped to the caller's own facultyId).
export default function FacultyAttendanceReportYearMonthPage() {
  const router = useRouter();
  const { sectionId } = useParams<{ sectionId: string }>();
  const searchParams = useSearchParams();
  const sectionLabel = searchParams.get("label") || "Section";
  const currentYear = new Date().getFullYear();

  const [mode, setMode] = useState<"monthly" | "period" | "tillnow">("monthly");

  // ── Monthly (unchanged) ───────────────────────────────────────────────────
  const [years, setYears] = useState<number[] | null>(null);
  const [isLoadingYears, setIsLoadingYears] = useState(true);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [months, setMonths] = useState<number[] | null>(null);
  const [isLoadingMonths, setIsLoadingMonths] = useState(false);

  useEffect(() => {
    if (mode !== "monthly") return;
    void (async () => {
      setIsLoadingYears(true);
      try {
        const res = await fetch(`/api/college/class-work-records?sectionId=${encodeURIComponent(sectionId)}`);
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
  }, [mode, sectionId]);

  useEffect(() => {
    if (mode !== "monthly" || selectedYear == null) return;
    void (async () => {
      setIsLoadingMonths(true);
      try {
        const res = await fetch(
          `/api/college/class-work-records?sectionId=${encodeURIComponent(sectionId)}&year=${selectedYear}`
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
  }, [mode, sectionId, selectedYear]);

  const yearOptions = Array.from(new Set([...(years ?? []), currentYear])).sort((a, b) => b - a);

  // ── Period / Till Now ────────────────────────────────────────────────────
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [rangeSubjects, setRangeSubjects] = useState<SubjectColumn[]>([]);
  const [rangeStudents, setRangeStudents] = useState<StudentRow[]>([]);
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
      setIsLoadingRange(true);
      setRangeError(null);
      try {
        const params = new URLSearchParams({ sectionId, summary: "true" });
        if (mode === "tillnow") {
          params.set("allTime", "true");
        } else {
          params.set("from", fromDate);
          params.set("to", toDate);
        }
        const res = await fetch(`/api/college/class-work-records?${params.toString()}`);
        const json = (await res.json()) as { subjects?: SubjectColumn[]; students?: StudentRow[]; error?: string };
        if (!res.ok) {
          setRangeError(json.error ?? "Failed to load report");
          return;
        }
        setRangeSubjects(json.subjects ?? []);
        setRangeStudents(json.students ?? []);
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
        description="Pick a month, a custom date range, or your entire history teaching this section, to view attendance for your own subject."
        actions={
          <Button variant="outline" onClick={() => router.push("/panel/monthly-records")}>
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
                        `/panel/monthly-records/${sectionId}/${selectedYear}/${m}?label=${encodeURIComponent(sectionLabel)}`
                      )
                    }
                  >
                    <CardContent className="p-4 flex items-center justify-between gap-2">
                      <p className="font-semibold text-sm">{MONTH_LABELS[m - 1]}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )
          )}
        </>
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
            <RangeSummaryTables subjects={rangeSubjects} students={rangeStudents} />
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
          <RangeSummaryTables subjects={rangeSubjects} students={rangeStudents} />
        )
      )}
    </div>
  );
}

// One flat Registration No/Name x Held/Attend/% table per subject this
// faculty actually teaches this section (almost always exactly one - a
// second only appears if the same faculty also has a separate assignment
// here, e.g. a lab alongside the lecture).
function RangeSummaryTables({ subjects, students }: { subjects: SubjectColumn[]; students: StudentRow[] }) {
  return (
    <div className="space-y-4">
      {subjects.map((sub) => (
        <Card key={sub.assignmentId} className="overflow-hidden">
          <p className="border-b bg-muted/50 px-4 py-2.5 text-sm font-semibold uppercase tracking-wide text-foreground">
            {sub.subjectName}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Registration No.</th>
                  <th className="px-4 py-3">Name</th>
                  <th className="px-4 py-3 text-center">Held</th>
                  <th className="px-4 py-3 text-center">Attend</th>
                  <th className="px-4 py-3 text-center">%</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {students.map((s) => {
                  const stat = s.bySubject[sub.assignmentId];
                  return (
                    <tr key={s.id}>
                      <td className="px-4 py-2.5">{s.rollNumber}</td>
                      <td className="px-4 py-2.5 font-medium">{s.name}</td>
                      <td className="px-4 py-2.5 text-center">{stat?.held ?? 0}</td>
                      <td className="px-4 py-2.5 text-center">{stat?.attend ?? 0}</td>
                      <td className="px-4 py-2.5 text-center"><PercentCell value={stat?.percent ?? null} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ))}
    </div>
  );
}
