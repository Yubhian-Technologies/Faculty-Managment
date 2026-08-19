"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
// "CSE-CSE-A". Mirrors lib/attendance/sectionLabel.ts's formatSectionLabel
// (server-only, so duplicated here) - same formatting the HOD Attendance
// Report's own section tiles use.
function formatSectionLabel(department: string, sectionName: string, codeByName: Map<string, string>): string {
  const code = codeByName.get(department) ?? department;
  return sectionName.toUpperCase().startsWith(`${code.toUpperCase()}-`) ? sectionName : `${code}-${sectionName}`;
}

// Step 3: every section under the picked course - reuses the existing
// GET /api/college/sections?courseId= listing (already unrestricted for
// Principal/VP) plus GET /api/college/departments for the branch-code label.
export default function PrincipalAttendanceReportsSectionsPage() {
  const router = useRouter();
  const { departmentId, courseId } = useParams<{ departmentId: string; courseId: string }>();
  const searchParams = useSearchParams();
  const deptLabel = searchParams.get("deptLabel") || "Department";
  const courseLabel = searchParams.get("courseLabel") || "Course";

  const [sections, setSections] = useState<(Section & { id: string })[]>([]);
  const [codeByName, setCodeByName] = useState<Map<string, string>>(new Map());
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      setIsLoading(true);
      try {
        const [sectionsRes, deptsRes] = await Promise.all([
          fetch(`/api/college/sections?courseId=${encodeURIComponent(courseId)}`),
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
  }, [courseId]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={courseLabel}
        description="Pick a section to view its attendance and classwork history."
        actions={
          <Button
            variant="outline"
            onClick={() =>
              router.push(`/principal/attendance-reports/${departmentId}?deptLabel=${encodeURIComponent(deptLabel)}`)
            }
          >
            <ArrowLeft className="h-4 w-4 mr-2" />Back
          </Button>
        }
      />

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-36 rounded-xl border bg-muted/30 animate-pulse" />)}
        </div>
      ) : sections.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No sections found in {courseLabel} yet.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sections.map((s) => {
            const label = formatSectionLabel(s.department, s.name, codeByName);
            return (
              <Card
                key={s.id}
                className="cursor-pointer transition-colors hover:border-primary/50"
                onClick={() =>
                  router.push(
                    `/principal/attendance-reports/${departmentId}/${courseId}/${s.id}?deptLabel=${encodeURIComponent(deptLabel)}&courseLabel=${encodeURIComponent(courseLabel)}&sectionLabel=${encodeURIComponent(label)}`
                  )
                }
              >
                <CardContent className="p-4">
                  <p className="font-semibold text-sm leading-tight">{label}</p>
                  <p className="text-xs text-muted-foreground mt-1">{ordinalYear(s.year)}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {s.studentCount} Student{s.studentCount === 1 ? "" : "s"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {s.facultyInchargeName ? `Faculty In-Charge: ${s.facultyInchargeName}` : "No faculty in-charge assigned"}
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
