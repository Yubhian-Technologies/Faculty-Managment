"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/shared/PageHeader";
import { toast } from "@/hooks/useToast";
import type { Department, Section } from "@/types";

function ordinalYear(year: number) {
  const suffix = year === 1 ? "st" : year === 2 ? "nd" : year === 3 ? "rd" : "th";
  return `${year}${suffix} Year`;
}

// "Branch-Section" (e.g. "CSE-A") - some colleges already name sections with
// the branch code baked in ("CSE-A"); others just use the bare letter ("A").
// Only prepend the code when it isn't already there, so this never produces
// "CSE-CSE-A". Mirrors lib/attendance/sectionLabel.ts's formatSectionLabel,
// duplicated here since that helper is server-only (takes an admin Firestore
// ref) and this is a client component.
function formatSectionLabel(department: string, sectionName: string, codeByName: Map<string, string>): string {
  const code = codeByName.get(department) ?? department;
  return sectionName.toUpperCase().startsWith(`${code.toUpperCase()}-`) ? sectionName : `${code}-${sectionName}`;
}

// Step 1 of the HOD's Attendance Reports: every section in the HOD's own
// department (and any owned sub-department/managed branch) - reuses the
// existing Sections listing (GET /api/college/sections), the same query the
// HOD's own Sections page is built from, rather than a new one. That route
// already recomputes a live, accurate studentCount per section (see its own
// comment on why the stored field can't be trusted), so the tile's count is
// correct for free. Department codes come from the existing
// GET /api/college/departments listing, purely for the tile's "Branch-Section"
// label - no other data or behavior depends on it.
export default function HodAttendanceReportsSectionsPage() {
  const router = useRouter();
  const [sections, setSections] = useState<(Section & { id: string })[]>([]);
  const [codeByName, setCodeByName] = useState<Map<string, string>>(new Map());
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      setIsLoading(true);
      try {
        const [sectionsRes, deptsRes] = await Promise.all([
          fetch("/api/college/sections"),
          fetch("/api/college/departments"),
        ]);
        if (!sectionsRes.ok) throw new Error("Failed to load sections");
        const sectionsJson = (await sectionsRes.json()) as { sections?: (Section & { id: string })[] };
        setSections(sectionsJson.sections ?? []);

        if (deptsRes.ok) {
          const deptsJson = (await deptsRes.json()) as { departments?: Department[] };
          setCodeByName(new Map((deptsJson.departments ?? []).map((d) => [d.name, d.code])));
        }
      } catch {
        toast({ variant: "destructive", title: "Failed to load sections" });
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Attendance Reports"
        description="Pick a section to view its attendance and classwork history."
      />

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
          {sections.map((s) => {
            const label = formatSectionLabel(s.department, s.name, codeByName);
            return (
              <Card
                key={s.id}
                className="cursor-pointer transition-all hover:border-primary/50 hover:shadow-md"
                onClick={() => router.push(`/hod/monthly-records/${s.id}?label=${encodeURIComponent(label)}`)}
              >
                <CardContent className="flex flex-col items-center justify-center gap-1.5 py-10 text-center">
                  <p className="text-2xl font-bold tracking-tight">{label}</p>
                  <p className="text-xs text-muted-foreground">
                    {s.courseName ? `${s.courseName} • ` : ""}{ordinalYear(s.year)}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {s.studentCount} Student{s.studentCount === 1 ? "" : "s"}
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
