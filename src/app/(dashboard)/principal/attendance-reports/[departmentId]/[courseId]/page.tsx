"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/PageHeader";
import { toast } from "@/hooks/useToast";
import type { Section } from "@/types";

function ordinalYear(year: number) {
  const suffix = year === 1 ? "st" : year === 2 ? "nd" : year === 3 ? "rd" : "th";
  return `${year}${suffix} Year`;
}

// Step 3: every section under the picked course - reuses the existing
// GET /api/college/sections?courseId= listing (already unrestricted for
// Principal/VP). The tile shows the section's own raw `name`, exactly as it
// reads on the Sections page - no department-code prefix is added.
export default function PrincipalAttendanceReportsSectionsPage() {
  const router = useRouter();
  const { departmentId, courseId } = useParams<{ departmentId: string; courseId: string }>();
  const searchParams = useSearchParams();
  const deptLabel = searchParams.get("deptLabel") || "Department";
  const courseLabel = searchParams.get("courseLabel") || "Course";

  const [sections, setSections] = useState<(Section & { id: string })[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      setIsLoading(true);
      try {
        const sectionsRes = await fetch(`/api/college/sections?courseId=${encodeURIComponent(courseId)}`);
        if (!sectionsRes.ok) throw new Error("Failed to load sections");
        const sectionsJson = (await sectionsRes.json()) as { sections?: (Section & { id: string })[] };
        setSections(sectionsJson.sections ?? []);
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
          {sections.map((s) => (
            <Card
              key={s.id}
              className="cursor-pointer transition-colors hover:border-primary/50"
              onClick={() =>
                router.push(
                  `/principal/attendance-reports/${departmentId}/${courseId}/${s.id}?deptLabel=${encodeURIComponent(deptLabel)}&courseLabel=${encodeURIComponent(courseLabel)}&sectionLabel=${encodeURIComponent(s.name)}`
                )
              }
            >
              <CardContent className="p-4">
                <p className="font-semibold text-sm leading-tight">{s.name}</p>
                <p className="text-xs text-muted-foreground mt-1">{ordinalYear(s.year)}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {s.studentCount} Student{s.studentCount === 1 ? "" : "s"}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {s.facultyInchargeName ? `Faculty In-Charge: ${s.facultyInchargeName}` : "No faculty in-charge assigned"}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
