"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, ChevronRight, CalendarRange } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/useToast";

const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// Step 2-3: Year pills + Month tiles, scoped to the one section picked in
// step 1 - aggregated across every faculty/subject assigned to it (see
// /api/college/section-attendance-report). Picking a month moves on to the
// report itself (step 4), which has its own date selector.
export default function HodAttendanceReportYearMonthPage() {
  const router = useRouter();
  const { sectionId } = useParams<{ sectionId: string }>();
  const searchParams = useSearchParams();
  const sectionLabel = searchParams.get("label") || "Section";
  const currentYear = new Date().getFullYear();

  const [years, setYears] = useState<number[] | null>(null);
  const [isLoadingYears, setIsLoadingYears] = useState(true);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);

  const [months, setMonths] = useState<number[] | null>(null);
  const [isLoadingMonths, setIsLoadingMonths] = useState(false);

  useEffect(() => {
    void (async () => {
      setIsLoadingYears(true);
      try {
        const res = await fetch(`/api/college/section-attendance-report?sectionId=${encodeURIComponent(sectionId)}`);
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
  }, [sectionId]);

  useEffect(() => {
    if (selectedYear == null) return;
    void (async () => {
      setIsLoadingMonths(true);
      try {
        const res = await fetch(
          `/api/college/section-attendance-report?sectionId=${encodeURIComponent(sectionId)}&year=${selectedYear}`
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
  }, [sectionId, selectedYear]);

  const yearOptions = Array.from(new Set([...(years ?? []), currentYear])).sort((a, b) => b - a);

  return (
    <div className="space-y-6">
      <PageHeader
        title={sectionLabel}
        description="Pick a year, then a month, to view this section's attendance report."
        actions={
          <Button variant="outline" onClick={() => router.push("/hod/monthly-records")}>
            <ArrowLeft className="h-4 w-4 mr-2" />Back
          </Button>
        }
      />

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
                    `/hod/monthly-records/${sectionId}/${selectedYear}/${m}?label=${encodeURIComponent(sectionLabel)}`
                  )
                }
              >
                <CardContent className="p-4 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <CalendarRange className="h-4 w-4 text-muted-foreground shrink-0" />
                    <p className="font-semibold text-sm">{MONTH_LABELS[m - 1]}</p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                </CardContent>
              </Card>
            ))}
          </div>
        )
      )}
    </div>
  );
}
