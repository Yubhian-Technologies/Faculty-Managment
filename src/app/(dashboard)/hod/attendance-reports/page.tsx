"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { SegmentedTabs } from "@/components/shared/SegmentedTabs";
import { StudentAttendanceReportView } from "@/components/attendance/StudentAttendanceReportView";
import { FacultyNotPostedView } from "@/components/attendance/FacultyNotPostedView";
import { FacultyAttendanceCompletionView } from "@/components/attendance/FacultyAttendanceCompletionView";

type Person = "faculty" | "students" | "edit";

// Every attendance REPORT module in one place - was 6 separate sidebar
// items (Attendance Reports, Attendance History, Attendance Completion,
// Absent Report, Shortage Report, Faculty Not Posted), all ungrouped.
// Distinct from the "Attendance" tab (/hod/faculty-attendance), which is
// daily check-in/out marking, not report viewing. Every branch below
// renders the exact same component the old standalone page did - this only
// changes how it's reached. Old routes still work standalone (unlinked,
// not deleted) for any existing notification links/bookmarks.
export default function HodAttendanceReportsPage() {
  const [person, setPerson] = useState<Person>("students");

  // The HOD can always correct their department's student attendance; the Department
  // Office head only if their HOD switched it on (the server enforces this too).
  const { data: access, isLoading } = useQuery({
    queryKey: ["hod-department-office-access"],
    queryFn: async () => {
      const res = await fetch("/api/college/department-office/access", { cache: "no-store" });
      const json = (await res.json()) as { canEditAttendance?: boolean; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to load");
      return json;
    },
    staleTime: 60_000,
  });
  const canEdit = isLoading ? false : access ? access.canEditAttendance !== false : true;
  const active: Person = person === "edit" && !canEdit ? "students" : person;

  return (
    <div className="space-y-4">
      <SegmentedTabs
        value={active}
        onChange={(k) => setPerson(k as Person)}
        options={[
          { key: "students", label: "Students" },
          { key: "faculty", label: "Faculty" },
          ...(canEdit ? [{ key: "edit", label: "Edit Attendance" }] : []),
        ]}
      />

      {active === "faculty" ? (
        <FacultyNotPostedView hodScoped />
      ) : active === "edit" ? (
        <FacultyAttendanceCompletionView
          title="Edit Attendance"
          description="Pick a past day and a faculty member to post or correct your department's student attendance. Every change is recorded with the reason you give."
          hodScoped
        />
      ) : (
        <StudentAttendanceReportView title="Student Attendance" scoped />
      )}
    </div>
  );
}
