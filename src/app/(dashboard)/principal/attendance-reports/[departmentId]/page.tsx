"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/PageHeader";
import { toast } from "@/hooks/useToast";
import type { Course } from "@/types";

// Step 2: every course under the picked department - reuses the existing
// GET /api/college/courses?departmentId= listing (already unrestricted for
// Principal/VP - no new endpoint).
export default function PrincipalAttendanceReportsCoursesPage() {
  const router = useRouter();
  const { departmentId } = useParams<{ departmentId: string }>();
  const searchParams = useSearchParams();
  const deptLabel = searchParams.get("deptLabel") || "Department";

  const [courses, setCourses] = useState<Course[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      setIsLoading(true);
      try {
        const res = await fetch(`/api/college/courses?departmentId=${encodeURIComponent(departmentId)}`);
        if (!res.ok) throw new Error("Failed to load courses");
        const json = (await res.json()) as { courses?: Course[] };
        setCourses(json.courses ?? []);
      } catch {
        toast({ variant: "destructive", title: "Failed to load courses" });
      } finally {
        setIsLoading(false);
      }
    })();
  }, [departmentId]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={deptLabel}
        description="Pick a course to view its sections."
        actions={
          <Button variant="outline" onClick={() => router.push("/principal/attendance-reports")}>
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
                  `/principal/attendance-reports/${departmentId}/${c.id}?deptLabel=${encodeURIComponent(deptLabel)}&courseLabel=${encodeURIComponent(c.name)}`
                )
              }
            >
              <CardContent className="p-4">
                <p className="font-semibold text-sm leading-tight">{c.name}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {c.code} • {c.durationYears} year{c.durationYears === 1 ? "" : "s"}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
