"use client";

import { useState } from "react";
import { SegmentedTabs } from "@/components/shared/SegmentedTabs";
import { StudentAttendanceReportView } from "@/components/attendance/StudentAttendanceReportView";
import { FacultyNotPostedView } from "@/components/attendance/FacultyNotPostedView";

type Person = "faculty" | "students";

// Student and faculty attendance reports. Every student view is one page: filters (Department -> Course -> Year -> Section)
// plus a Load button - no multi-page drill-downs. The old nested /attendance-reports/... and /attendance-history/... routes redirect here.
export default function PrincipalAttendanceReportsPage() {
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
        <FacultyNotPostedView />
      ) : (
        <StudentAttendanceReportView title="Student Attendance" />
      )}
    </div>
  );
}
