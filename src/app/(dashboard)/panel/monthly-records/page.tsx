"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { SegmentedTabs } from "@/components/shared/SegmentedTabs";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "@/hooks/useToast";
import { FacultyAttendanceReportView } from "@/components/attendance/FacultyAttendanceReportView";
import { StudentAttendanceReportView } from "@/components/attendance/StudentAttendanceReportView";

interface FacultySection {
  sectionId: string;
  label: string;
  studentCount: number;
}

type Tab = "teaching" | "class";

// Faculty Attendance Report. "My subjects": the sections this faculty member
// teaches (from their own teaching assignments -
// /api/college/class-work-records/sections), then one filter + Load page for
// Day / Month / Period / Semester / Till now. "My class": shown only to a class
// incharge (faculty incharge of at least one section) - the student attendance
// report with its filters, limited to the sections they are in charge of
// (/api/college/sections already returns just those for a faculty login, and the
// report route re-checks it).
export default function FacultyAttendanceReportPage() {
  const [sections, setSections] = useState<FacultySection[] | null>(null);
  const [inchargeCount, setInchargeCount] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>("teaching");

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
    void (async () => {
      try {
        const res = await fetch("/api/college/sections");
        const json = (await res.json()) as { sections?: { id?: string }[] };
        setInchargeCount(res.ok ? (json.sections ?? []).filter((s) => !!s.id).length : 0);
      } catch {
        setInchargeCount(0);
      }
    })();
  }, []);

  if (sections === null || inchargeCount === null) return <div className="h-40 rounded-lg border bg-muted/30 animate-pulse" />;

  const isIncharge = inchargeCount > 0;
  const hasTeaching = sections.length > 0;
  const showClass = isIncharge && (tab === "class" || !hasTeaching);

  if (!hasTeaching && !isIncharge) {
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

  return (
    <div className="space-y-4">
      {isIncharge && hasTeaching && (
        <SegmentedTabs
          value={tab}
          onChange={(k) => setTab(k as Tab)}
          options={[
            { key: "teaching", label: "My subjects" },
            { key: "class", label: "My class (incharge)" },
          ]}
        />
      )}
      {showClass
        ? <StudentAttendanceReportView title="My Class Attendance" scoped onlyOwnYears />
        : <FacultyAttendanceReportView sections={sections} />}
    </div>
  );
}
