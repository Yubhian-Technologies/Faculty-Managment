"use client";

import { useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SegmentedTabs } from "@/components/shared/SegmentedTabs";
import { toast } from "@/hooks/useToast";
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

// Step 2-3: Monthly / Period / Till now, scoped to the one section picked in
// step 1 - mirrors the per-student Attendance History picker. Monthly
// resolves an academic-year + month pair to a plain calendar year/month and
// moves on to the day-wise/weekly report (step 4, its own date selector);
// Period and Till now instead go straight to a range summary (every
// student x every subject's Held/Attend/%, no weekly breakdown - a range
// spanning more than one month has no single calendar grid to align weeks
// against).
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
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  function viewReport() {
    if (mode === "monthly") {
      const year = calendarYearForMonth(academicStartYear, month);
      router.push(`/hod/monthly-records/${sectionId}/${year}/${month}?label=${encodeURIComponent(sectionLabel)}`);
      return;
    }
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
      router.push(`/hod/monthly-records/${sectionId}/range?label=${encodeURIComponent(sectionLabel)}&from=${from}&to=${to}`);
      return;
    }
    router.push(`/hod/monthly-records/${sectionId}/range?label=${encodeURIComponent(sectionLabel)}&allTime=true`);
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

          <Button onClick={viewReport}>View Report</Button>
        </CardContent>
      </Card>
    </div>
  );
}
