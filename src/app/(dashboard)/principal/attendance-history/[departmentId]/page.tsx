"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/PageHeader";
import { toast } from "@/hooks/useToast";
import type { Course, Section } from "@/types";

// Step 2: every course under the picked department - reuses the existing
// GET /api/college/courses?departmentId= listing (already unrestricted for
// Principal/VP - no new endpoint). Mirrors attendance-reports/[departmentId]/
// page.tsx's own Course step.
export default function PrincipalAttendanceHistoryCoursesPage() {
  const router = useRouter();
  const { departmentId } = useParams<{ departmentId: string }>();
  const searchParams = useSearchParams();
  const deptLabel = searchParams.get("deptLabel") || "Department";

  const [courses, setCourses] = useState<Course[]>([]);
  // Two courses under the same department can share an identical name/code
  // (e.g. two "Bachelor of Technology" cards) when one is really the shared
  // 1st-year curriculum whose sections are physically owned by a different
  // department (Basic Science) - see the student-list step's own note on
  // the same mismatch. Keyed by course id: the set of OTHER department
  // names found among that course's own sections, so each card can say
  // whose students it actually holds.
  const [otherDeptsByCourse, setOtherDeptsByCourse] = useState<Record<string, string[]>>({});
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      setIsLoading(true);
      try {
        const res = await fetch(`/api/college/courses?departmentId=${encodeURIComponent(departmentId)}`);
        if (!res.ok) throw new Error("Failed to load courses");
        const json = (await res.json()) as { courses?: Course[] };
        const loadedCourses = json.courses ?? [];
        setCourses(loadedCourses);

        const entries = await Promise.all(
          loadedCourses.map(async (c) => {
            try {
              const sRes = await fetch(`/api/college/sections?courseId=${encodeURIComponent(c.id)}`);
              const sJson = (await sRes.json()) as { sections?: Section[] };
              const others = Array.from(
                new Set((sJson.sections ?? []).map((s) => s.department).filter((d) => d && d !== deptLabel))
              );
              return [c.id, others] as const;
            } catch {
              return [c.id, []] as const;
            }
          })
        );
        setOtherDeptsByCourse(Object.fromEntries(entries));
      } catch {
        toast({ variant: "destructive", title: "Failed to load courses" });
      } finally {
        setIsLoading(false);
      }
    })();
  }, [departmentId, deptLabel]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={deptLabel}
        description="Pick a course to view its sections."
        actions={
          <Button variant="outline" onClick={() => router.push("/principal/attendance-history")}>
            <ArrowLeft className="h-4 w-4 mr-2" />Back
          </Button>
        }
      />

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-28 rounded-xl border bg-muted/30 animate-pulse" />)}
        </div>
      ) : courses.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No courses found in {deptLabel} yet.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {courses.map((c) => (
            <Card
              key={c.id}
              className="cursor-pointer transition-colors hover:border-primary/50"
              onClick={() =>
                router.push(
                  `/principal/attendance-history/${departmentId}/${c.id}?deptLabel=${encodeURIComponent(deptLabel)}&courseLabel=${encodeURIComponent(c.name)}`
                )
              }
            >
              <CardContent className="p-4">
                <p className="font-semibold text-sm leading-tight">{c.name}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {c.code} • {c.durationYears} year{c.durationYears === 1 ? "" : "s"}
                </p>
                {!!otherDeptsByCourse[c.id]?.length && (
                  <p className="text-xs text-amber-600 mt-1">
                    {otherDeptsByCourse[c.id].join(", ")} students (freshman year)
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
