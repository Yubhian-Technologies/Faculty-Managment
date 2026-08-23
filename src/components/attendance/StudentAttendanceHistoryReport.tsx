"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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

const selectClass =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus:border-primary focus:outline-none";

interface StudentInfo {
  rollNumber: string;
  name: string;
  department: string;
  course: string | null;
  year: number;
  section: string;
  semester: number | null;
}
interface SubjectRow {
  subjectId: string;
  subjectName: string;
  subjectCode: string;
  held: number;
  attend: number;
  percent: number;
}
interface TotalRow {
  held: number;
  attend: number;
  percent: number;
}

function PercentCell({ value }: { value: number }) {
  return <span className={value < 75 ? "font-semibold text-red-600" : "text-foreground"}>{value.toFixed(2)}</span>;
}

/** yyyy-mm-dd -> dd-mm-yyyy */
function ddmmyyyy(dateStr: string) {
  const [y, m, d] = dateStr.split("-");
  return `${d}-${m}-${y}`;
}

// Per-student cumulative attendance history, mirroring the "Held / Attend /
// %" per-subject report an HOD would recognize from the previous system -
// Monthly (one month), Period (a custom date range), or Till now (this
// student's entire history) all share the same table shape, just a
// different range passed to /api/college/student-attendance-history. Shared
// by both hod/students/[studentId]/attendance and the Principal's own
// Department -> Course -> Section -> Student drill-down (see
// principal/attendance-history/...) - the API itself already allows both
// roles (HOD scoped to their own department, Principal/VP unrestricted), so
// this is purely a display-layer reuse: the caller supplies which student
// and where "Back" goes, everything else is identical between the two.
export function StudentAttendanceHistoryReport({
  studentId,
  studentName,
  backHref,
}: {
  studentId: string;
  studentName: string;
  backHref: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Arriving from a section-wide report's Registration No. link (see
  // hod/monthly-records/.../[year]/[month]/page.tsx and .../range/page.tsx)
  // carries the exact range already on screen there, so this page can show
  // the matching breakdown immediately instead of landing on the picker and
  // making the caller re-pick the same month/range and hit Show again.
  // Absent entirely when reached from a plain student list (no range picked
  // yet).
  const modeParam = searchParams.get("mode");
  const yearParam = searchParams.get("year");
  const monthParam = searchParams.get("month");
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");

  const now = new Date();
  const [mode, setMode] = useState<"monthly" | "period" | "tillnow">(
    modeParam === "period" || modeParam === "tillnow" ? modeParam : "monthly"
  );
  const [month, setMonth] = useState(monthParam ? Number(monthParam) : now.getMonth() + 1);
  const [year, setYear] = useState(yearParam ? Number(yearParam) : now.getFullYear());
  const [from, setFrom] = useState(fromParam ?? "");
  const [to, setTo] = useState(toParam ?? "");

  // Arriving with an explicit mode (from a report's Registration No. link)
  // already answers "which range" - showing the Monthly/Period/Till now
  // picker again would just be noise before the sheet actually asked for.
  // Starts collapsed in that case; a "Change range" link brings it back if
  // a different range is wanted without navigating away.
  const [isPickerOpen, setIsPickerOpen] = useState(!modeParam);

  const [hasShown, setHasShown] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [student, setStudent] = useState<StudentInfo | null>(null);
  const [subjects, setSubjects] = useState<SubjectRow[]>([]);
  const [total, setTotal] = useState<TotalRow | null>(null);
  // The exact range actually fetched, captured at Show time - so the report
  // card's title line reflects what's on screen even if the pickers above
  // are changed again before hitting Show a second time.
  const [shownRangeLabel, setShownRangeLabel] = useState("");

  const yearOptions = [now.getFullYear(), now.getFullYear() - 1, now.getFullYear() - 2, now.getFullYear() - 3];

  async function handleShow() {
    if (mode === "period") {
      if (!from || !to) {
        toast({ variant: "destructive", title: "Pick both a From and To date" });
        return;
      }
      // "YYYY-MM-DD" strings sort chronologically, so a plain string
      // comparison is enough - no Date parsing needed.
      if (from > to) {
        toast({ variant: "destructive", title: "From date must be before the To date" });
        return;
      }
    }
    setIsLoading(true);
    setHasShown(true);
    try {
      const params = new URLSearchParams({ studentId });
      if (mode === "monthly") {
        params.set("year", String(year));
        params.set("month", String(month));
        setShownRangeLabel(`${MONTH_LABELS[month - 1]} ${year}`);
      } else if (mode === "period") {
        params.set("from", from);
        params.set("to", to);
        setShownRangeLabel(`${ddmmyyyy(from)} to ${ddmmyyyy(to)}`);
      } else {
        setShownRangeLabel("entire history");
      }
      const res = await fetch(`/api/college/student-attendance-history?${params.toString()}`);
      if (!res.ok) throw new Error("Failed to load attendance history");
      const json = (await res.json()) as { student?: StudentInfo; subjects?: SubjectRow[]; total?: TotalRow };
      setStudent(json.student ?? null);
      setSubjects(json.subjects ?? []);
      setTotal(json.total ?? null);
    } catch {
      toast({ variant: "destructive", title: "Failed to load attendance history" });
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    if (!modeParam) return;
    // Runs once on mount only - modeParam (and the year/month/from/to it
    // came with) already seeded the state above; re-running this on every
    // state change would fight the caller's own later picker edits.
    void (async () => {
      await handleShow();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${studentName} — Attendance History`}
        description="Cumulative subject-wise attendance, by month, a custom date range, or the student's entire history."
        actions={
          <Button variant="outline" onClick={() => router.push(backHref)}>
            <ArrowLeft className="h-4 w-4 mr-2" />Back
          </Button>
        }
      />

      {isPickerOpen ? (
        <Card>
          <CardContent className="p-4 space-y-4">
            <SegmentedTabs
              value={mode}
              onChange={(v) => setMode(v as "monthly" | "period" | "tillnow")}
              options={[
                { key: "monthly", label: "Monthly" },
                { key: "period", label: "Period" },
                { key: "tillnow", label: "Till now" },
              ]}
            />

            {mode === "monthly" && (
              <div className="flex flex-wrap items-end gap-3">
                <div className="w-40 space-y-1.5">
                  <label className="text-sm font-medium">Month</label>
                  <select className={selectClass} value={month} onChange={(e) => setMonth(Number(e.target.value))}>
                    {MONTH_LABELS.map((label, i) => <option key={label} value={i + 1}>{label}</option>)}
                  </select>
                </div>
                <div className="w-32 space-y-1.5">
                  <label className="text-sm font-medium">Year</label>
                  <select className={selectClass} value={year} onChange={(e) => setYear(Number(e.target.value))}>
                    {yearOptions.map((y) => <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>
              </div>
            )}

            {mode === "period" && (
              <div className="flex flex-wrap items-end gap-3">
                <div className="w-44 space-y-1.5">
                  <label className="text-sm font-medium">From</label>
                  <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
                </div>
                <div className="w-44 space-y-1.5">
                  <label className="text-sm font-medium">To</label>
                  <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
                </div>
              </div>
            )}

            <Button onClick={() => void handleShow()} loading={isLoading}>Show</Button>
          </CardContent>
        </Card>
      ) : (
        <button
          type="button"
          onClick={() => setIsPickerOpen(true)}
          className="text-sm font-medium text-primary hover:underline"
        >
          Change range
        </button>
      )}

      {hasShown && !isLoading && (
        subjects.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-sm text-muted-foreground">
              No attendance records for {studentName} in this range.
            </CardContent>
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <p className="border-b bg-muted/50 px-4 py-2.5 text-sm font-semibold uppercase tracking-wide text-foreground">
              Attendance Report for {shownRangeLabel}
            </p>
            {student && (
              <div className="grid grid-cols-2 gap-x-6 gap-y-1 border-b bg-muted/30 p-4 text-sm sm:grid-cols-4">
                <div><span className="text-muted-foreground">Roll No.</span> <span className="font-medium">{student.rollNumber || "—"}</span></div>
                <div><span className="text-muted-foreground">Name</span> <span className="font-medium">{student.name}</span></div>
                <div><span className="text-muted-foreground">Course</span> <span className="font-medium">{student.course || "—"}</span></div>
                <div><span className="text-muted-foreground">Branch</span> <span className="font-medium">{student.department}</span></div>
                <div><span className="text-muted-foreground">Year</span> <span className="font-medium">{student.year}</span></div>
                <div><span className="text-muted-foreground">Section</span> <span className="font-medium">{student.section || "—"}</span></div>
                {student.semester != null && (
                  <div><span className="text-muted-foreground">Semester</span> <span className="font-medium">{student.semester}</span></div>
                )}
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">Sl.No.</th>
                    <th className="px-4 py-3">Subject</th>
                    <th className="px-4 py-3 text-center">Held</th>
                    <th className="px-4 py-3 text-center">Attend</th>
                    <th className="px-4 py-3 text-center">%</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {subjects.map((s, i) => (
                    <tr key={s.subjectId}>
                      <td className="px-4 py-2.5 text-muted-foreground">{i + 1}</td>
                      <td className="px-4 py-2.5 font-medium" title={s.subjectName}>{s.subjectCode || s.subjectName}</td>
                      <td className="px-4 py-2.5 text-center">{s.held}</td>
                      <td className="px-4 py-2.5 text-center">{s.attend}</td>
                      <td className="px-4 py-2.5 text-center"><PercentCell value={s.percent} /></td>
                    </tr>
                  ))}
                </tbody>
                {total && (
                  <tfoot>
                    <tr className="border-t-2 bg-muted/40 font-semibold">
                      <td colSpan={2} className="px-4 py-2.5 text-xs uppercase tracking-wide text-muted-foreground">Total</td>
                      <td className="px-4 py-2.5 text-center">{total.held}</td>
                      <td className="px-4 py-2.5 text-center">{total.attend}</td>
                      <td className="px-4 py-2.5 text-center"><PercentCell value={total.percent} /></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </Card>
        )
      )}
    </div>
  );
}
