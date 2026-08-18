"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/shared/PageHeader";
import { toast } from "@/hooks/useToast";

interface FacultySection {
  sectionId: string;
  label: string;
  studentCount: number;
  department: string;
  courseName: string;
  year: number | null;
}

// Step 1 of the Attendance Report: every section the HOD has actually
// assigned this faculty to teach (see
// /api/college/class-work-records/sections, built off their own
// teachingAssignments - no separate assignment list).
export default function FacultyAttendanceReportSectionsPage() {
  const router = useRouter();
  const [sections, setSections] = useState<FacultySection[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      setIsLoading(true);
      try {
        const res = await fetch("/api/college/class-work-records/sections");
        if (!res.ok) throw new Error("Failed to load sections");
        const json = (await res.json()) as { sections?: FacultySection[] };
        setSections(json.sections ?? []);
      } catch {
        toast({ variant: "destructive", title: "Failed to load your sections" });
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Attendance Report"
        description="Pick a section to view its attendance and class-work history."
      />

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-36 rounded-xl border bg-muted/30 animate-pulse" />)}
        </div>
      ) : sections.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            You have no assigned sections yet. Ask your HOD to assign you to a section and subject first.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sections.map((s) => (
            <Card
              key={s.sectionId}
              className="cursor-pointer transition-all hover:border-primary/50 hover:shadow-md"
              onClick={() => router.push(`/panel/monthly-records/${s.sectionId}?label=${encodeURIComponent(s.label)}`)}
            >
              <CardContent className="flex flex-col items-center justify-center gap-2 py-10 text-center">
                <p className="text-2xl font-bold tracking-tight">{s.label}</p>
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
