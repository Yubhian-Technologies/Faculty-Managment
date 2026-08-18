"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/useToast";

const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAY_LABELS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

interface CalendarCell {
  day: number;
  inMonth: boolean;
  hasRecord: boolean;
  isWeekend: boolean;
}

// Step 4: a real calendar for the chosen month - only days this faculty
// actually has a submitted attendance record for (this section) are
// clickable; everything else (outside the month, or an in-month day with no
// record) is shown but inert, handled gracefully rather than hidden.
export default function FacultyAttendanceReportCalendarPage() {
  const router = useRouter();
  const { sectionId, year, month } = useParams<{ sectionId: string; year: string; month: string }>();
  const searchParams = useSearchParams();
  const sectionLabel = searchParams.get("label") || "Section";

  const [days, setDays] = useState<number[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      setIsLoading(true);
      try {
        const res = await fetch(
          `/api/college/class-work-records?sectionId=${encodeURIComponent(sectionId)}&year=${year}&month=${month}`
        );
        if (!res.ok) throw new Error("Failed to load calendar");
        const json = (await res.json()) as { days?: number[] };
        setDays(json.days ?? []);
      } catch {
        toast({ variant: "destructive", title: "Failed to load calendar" });
        setDays([]);
      } finally {
        setIsLoading(false);
      }
    })();
  }, [sectionId, year, month]);

  const yearNum = Number(year);
  const monthNum = Number(month);
  const monthLabel = MONTH_LABELS[monthNum - 1] ?? month;

  const daysInMonth = new Date(yearNum, monthNum, 0).getDate();
  const daysInPrevMonth = new Date(yearNum, monthNum - 1, 0).getDate();
  const firstWeekday = new Date(yearNum, monthNum - 1, 1).getDay(); // 0 = Sunday
  const leadingCount = (firstWeekday + 6) % 7; // Monday-first offset

  const recordSet = new Set(days);
  const cells: CalendarCell[] = [];
  for (let i = leadingCount; i > 0; i--) {
    cells.push({ day: daysInPrevMonth - i + 1, inMonth: false, hasRecord: false, isWeekend: false });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const weekday = new Date(yearNum, monthNum - 1, d).getDay();
    cells.push({ day: d, inMonth: true, hasRecord: recordSet.has(d), isWeekend: weekday === 0 || weekday === 6 });
  }
  let trailing = 1;
  while (cells.length % 7 !== 0) {
    cells.push({ day: trailing++, inMonth: false, hasRecord: false, isWeekend: false });
  }

  function goToDate(day: number) {
    const dateStr = `${yearNum}-${String(monthNum).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    router.push(
      `/panel/monthly-records/${sectionId}/${year}/${month}/${dateStr}?label=${encodeURIComponent(sectionLabel)}`
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${sectionLabel} — ${monthLabel} ${year}`}
        description="Pick a date to view that day's attendance and class-work record."
        actions={
          <Button
            variant="outline"
            onClick={() => router.push(`/panel/monthly-records/${sectionId}?label=${encodeURIComponent(sectionLabel)}`)}
          >
            <ArrowLeft className="h-4 w-4 mr-2" />Back
          </Button>
        }
      />

      {isLoading ? (
        <div className="h-72 w-full max-w-xs rounded-xl border bg-muted/30 animate-pulse" />
      ) : days.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No attendance records for {monthLabel} {year}.
          </CardContent>
        </Card>
      ) : (
        <Card className="w-full max-w-xs overflow-hidden">
          <div className="bg-primary px-3 py-2 text-center">
            <p className="text-sm font-bold uppercase tracking-widest text-primary-foreground">{monthLabel}</p>
          </div>
          <CardContent className="p-3">
            <div className="grid grid-cols-7 gap-0.5 text-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {WEEKDAY_LABELS.map((w, i) => (
                <div key={w} className={i >= 5 ? "text-destructive" : ""}>{w}</div>
              ))}
            </div>
            <div className="mt-1 grid grid-cols-7 gap-0.5">
              {cells.map((c, i) => (
                <button
                  key={i}
                  type="button"
                  disabled={!c.inMonth || !c.hasRecord}
                  onClick={() => goToDate(c.day)}
                  className={[
                    "aspect-square rounded-md text-xs flex items-center justify-center transition-colors",
                    !c.inMonth
                      ? "text-muted-foreground/30"
                      : c.hasRecord
                        ? "cursor-pointer bg-primary/10 font-semibold text-primary hover:bg-primary/20"
                        : c.isWeekend
                          ? "text-destructive/50"
                          : "text-muted-foreground/60",
                  ].join(" ")}
                >
                  {c.day}
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
