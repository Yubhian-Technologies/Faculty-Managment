"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarDays, ChevronRight, ClipboardList, UserCog } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/EmptyState";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/useToast";
import type { TimetableIncharge } from "@/types";

function ordinalYear(year: number) {
  const suffix = year === 1 ? "st" : year === 2 ? "nd" : year === 3 ? "rd" : "th";
  return `${year}${suffix} Year`;
}

// COLLEGE_STAFF mirror of panel/timetable-incharge/page.tsx - a Technical
// supporting-staff member's own "what am I responsible for" landing (see
// TimetableIncharge in src/types/core.ts). The HOD keeps full access too -
// this is a co-editor grant, not a handoff.
export default function TimetableInchargePage() {
  const [incharges, setIncharges] = useState<TimetableIncharge[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/college/timetable-incharges?mine=true");
        const data = await res.json() as { incharges: TimetableIncharge[] };
        if (!cancelled) setIncharges(data.incharges ?? []);
      } catch {
        if (!cancelled) toast({ variant: "destructive", title: "Failed to load your Timetable responsibilities" });
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Timetable Responsibility"
        description="Course-years your HOD has made you Timetable Incharge for"
      />

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-24 rounded-lg border bg-muted/30 animate-pulse" />)}
        </div>
      ) : incharges.length === 0 ? (
        <EmptyState
          icon={<UserCog className="h-6 w-6" />}
          title="No responsibilities assigned yet"
          description="Once your HOD makes you Timetable Incharge for a course & year, it shows up here."
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {incharges.map((i) => (
            <Card key={i.id}>
              <CardContent className="p-4 space-y-3">
                <div>
                  <p className="font-semibold text-sm">{i.courseName}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{i.departmentName} · {ordinalYear(i.year)}</p>
                </div>
                <div className="flex flex-col gap-2">
                  <Button variant="outline" size="sm" asChild className="justify-between">
                    <Link href={`/college-staff/timetable-incharge/${i.courseId}/${i.year}/teaching-assignments`}>
                      <span className="flex items-center gap-1.5"><ClipboardList className="h-3.5 w-3.5" />Teaching Assignments</span>
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Link>
                  </Button>
                  <Button variant="outline" size="sm" asChild className="justify-between">
                    <Link href={`/college-staff/timetable-incharge/${i.courseId}/${i.year}`}>
                      <span className="flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5" />Timetable</span>
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
