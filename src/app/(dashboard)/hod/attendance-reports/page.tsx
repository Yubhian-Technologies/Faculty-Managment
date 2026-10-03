"use client";

import { useState } from "react";
import { SegmentedTabs } from "@/components/shared/SegmentedTabs";
import { StudentAttendanceReportView } from "@/components/attendance/StudentAttendanceReportView";
import { FacultyNotPostedView } from "@/components/attendance/FacultyNotPostedView";

type Person = "faculty" | "students";

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

  return (
    <div className="space-y-4">
      <SegmentedTabs
        value={person}
        onChange={(k) => setPerson(k as Person)}
        options={[
          { key: "students", label: "Students" },
          { key: "faculty", label: "Faculty" },
        ]}
      />

      {person === "faculty" ? (
        <FacultyNotPostedView hodScoped />
      ) : (
        <StudentAttendanceReportView title="Student Attendance" scoped />
      )}
    </div>
  );
}
