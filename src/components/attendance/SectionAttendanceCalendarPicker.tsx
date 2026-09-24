"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/shared/PageHeader";
import { toast } from "@/hooks/useToast";
import type { Section } from "@/types";

function ordinalYear(year: number) {
  const suffix = year === 1 ? "st" : year === 2 ? "nd" : year === 3 ? "rd" : "th";
  return `${year}${suffix} Year`;
}

// Step 1 of the section-scoped attendance report: every section in scope -
// reuses the existing Sections listing (GET /api/college/sections), same
// query the Sections page is built from, rather than a new one. That route
// already recomputes a live, accurate studentCount per section, so the
// tile's count is correct for free. Picking a tile drills into
// `${hrefBase}/${section.id}`, the existing day-wise/weekly month calendar.
export function SectionAttendanceCalendarPicker({
  hrefBase = "/hod/monthly-records",
  title = "Attendance Reports",
  description = "Pick a section to view its attendance and classwork history.",
}: { hrefBase?: string; title?: string; description?: string }) {
  const router = useRouter();
  const [sections, setSections] = useState<(Section & { id: string })[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      setIsLoading(true);
      try {
        const sectionsRes = await fetch("/api/college/sections");
        if (!sectionsRes.ok) throw new Error("Failed to load sections");
        const sectionsJson = (await sectionsRes.json()) as { sections?: (Section & { id: string })[] };
        setSections(sectionsJson.sections ?? []);
      } catch {
        toast({ variant: "destructive", title: "Failed to load sections" });
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader title={title} description={description} />

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-36 rounded-xl border bg-muted/30 animate-pulse" />)}
        </div>
      ) : sections.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No sections found in your department yet.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sections.map((s) => (
            <Card
              key={s.id}
              className="cursor-pointer transition-all hover:border-primary/50 hover:shadow-md"
              onClick={() => router.push(`${hrefBase}/${s.id}?label=${encodeURIComponent(s.name)}`)}
            >
              <CardContent className="flex flex-col items-center justify-center gap-1.5 py-10 text-center">
                <p className="text-2xl font-bold tracking-tight">{s.name}</p>
                <p className="text-xs text-muted-foreground">
                  {s.courseName ? `${s.courseName} • ` : ""}{ordinalYear(s.year)}
                </p>
                <p className="text-sm text-muted-foreground">
                  {s.studentCount} Student{s.studentCount === 1 ? "" : "s"}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
