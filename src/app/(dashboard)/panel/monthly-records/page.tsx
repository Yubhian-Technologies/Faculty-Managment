"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "@/hooks/useToast";
import { FacultyAttendanceReportView } from "@/components/attendance/FacultyAttendanceReportView";

interface FacultySection {
  sectionId: string;
  label: string;
  studentCount: number;
}

// Faculty Attendance Report: the sections this faculty member teaches (from
// their own teaching assignments - /api/college/class-work-records/sections),
// then one filter + Load page for Day / Month / Period / Semester / Till now.
export default function FacultyAttendanceReportPage() {
  const [sections, setSections] = useState<FacultySection[] | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/college/class-work-records/sections");
        if (!res.ok) throw new Error("Failed to load sections");
        const json = (await res.json()) as { sections?: FacultySection[] };
        setSections(json.sections ?? []);
      } catch {
        toast({ variant: "destructive", title: "Failed to load your sections" });
        setSections([]);
      }
    })();
  }, []);

  if (sections === null) return <div className="h-40 rounded-lg border bg-muted/30 animate-pulse" />;
  if (sections.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader title="Attendance Report" description="Attendance and class-work history for your sections." />
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            You have no assigned sections yet. Ask your HOD to assign you to a section and subject first.
          </CardContent>
        </Card>
      </div>
    );
  }
  return <FacultyAttendanceReportView sections={sections} />;
}
