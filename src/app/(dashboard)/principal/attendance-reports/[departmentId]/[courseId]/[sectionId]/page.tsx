"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/PageHeader";
import { toast } from "@/hooks/useToast";
import type { TeachingAssignment } from "@/types";

// Step 4: every subject currently assigned to this exact section (any
// faculty, by the HOD) - reuses the existing
// GET /api/college/teaching-assignments?sectionId= listing, the same
// "section-scoped view" already open to Principal/VP with no restriction
// (see its own comment: "all HOD/Principal/etc. roles above may view any
// section"). No new endpoint.
export default function PrincipalAttendanceReportsSubjectsPage() {
  const router = useRouter();
  const { departmentId, courseId, sectionId } = useParams<{
    departmentId: string; courseId: string; sectionId: string;
  }>();
  const searchParams = useSearchParams();
  const deptLabel = searchParams.get("deptLabel") || "Department";
  const courseLabel = searchParams.get("courseLabel") || "Course";
  const sectionLabel = searchParams.get("sectionLabel") || "Section";

  const [subjects, setSubjects] = useState<TeachingAssignment[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      setIsLoading(true);
      try {
        const res = await fetch(`/api/college/teaching-assignments?sectionId=${encodeURIComponent(sectionId)}`);
        if (!res.ok) throw new Error("Failed to load subjects");
        const json = (await res.json()) as { assignments?: TeachingAssignment[] };
        const current = (json.assignments ?? []).filter((a) => !a.isPast);
        const bySubject = new Map<string, TeachingAssignment>();
        for (const a of current) {
          if (!bySubject.has(a.subjectId)) bySubject.set(a.subjectId, a);
        }
        setSubjects([...bySubject.values()].sort((a, b) => a.subjectName.localeCompare(b.subjectName)));
      } catch {
        toast({ variant: "destructive", title: "Failed to load subjects" });
      } finally {
        setIsLoading(false);
      }
    })();
  }, [sectionId]);

  const backHref = `/principal/attendance-reports/${departmentId}/${courseId}?deptLabel=${encodeURIComponent(deptLabel)}&courseLabel=${encodeURIComponent(courseLabel)}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title={sectionLabel}
        description="Pick a subject to view its attendance and classwork history."
        actions={
          <Button variant="outline" onClick={() => router.push(backHref)}>
            <ArrowLeft className="h-4 w-4 mr-2" />Back
          </Button>
        }
      />

      {isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-20 rounded-lg border bg-muted/30 animate-pulse" />)}
        </div>
      ) : subjects.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No subjects assigned to {sectionLabel} yet.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {subjects.map((s) => (
            <Card
              key={s.subjectId}
              className="cursor-pointer transition-colors hover:border-primary/50"
              onClick={() =>
                router.push(
                  `/principal/attendance-reports/${departmentId}/${courseId}/${sectionId}/${s.subjectId}?deptLabel=${encodeURIComponent(deptLabel)}&courseLabel=${encodeURIComponent(courseLabel)}&sectionLabel=${encodeURIComponent(sectionLabel)}&subjectLabel=${encodeURIComponent(s.subjectName)}`
                )
              }
            >
              <CardContent className="p-4">
                <p className="font-semibold text-sm leading-tight">{s.subjectName}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {s.facultyName ? `Faculty: ${s.facultyName}` : "No faculty assigned"}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
