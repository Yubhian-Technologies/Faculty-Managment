"use client";

import { useState } from "react";
import { SegmentedTabs } from "@/components/shared/SegmentedTabs";
import { SectionReportsView } from "@/components/attendance/SectionReportsView";
import { FacultyAttendanceCompletionView } from "@/components/attendance/FacultyAttendanceCompletionView";
import { FacultyNotPostedView } from "@/components/attendance/FacultyNotPostedView";
import { StudentAttendanceHistoryPicker } from "@/components/attendance/StudentAttendanceHistoryPicker";
import { SectionAttendanceCalendarPicker } from "@/components/attendance/SectionAttendanceCalendarPicker";

type Person = "faculty" | "students";
type FacultySub = "completion" | "notposted";
type StudentSub = "reports" | "byStudent" | "bySection";

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
  const [facultySub, setFacultySub] = useState<FacultySub>("completion");
  const [studentSub, setStudentSub] = useState<StudentSub>("reports");

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
        <>
          <div className="overflow-x-auto pb-1">
            <SegmentedTabs
              value={facultySub}
              onChange={(k) => setFacultySub(k as FacultySub)}
              options={[
                { key: "completion", label: "Completion" },
                { key: "notposted", label: "Not Posted" },
              ]}
            />
          </div>
          {facultySub === "completion" && (
            <FacultyAttendanceCompletionView
              title="Attendance Completion"
              description="Check whether your department's faculty submitted student attendance for their scheduled periods, and whether it was on time"
              hodScoped
            />
          )}
          {facultySub === "notposted" && <FacultyNotPostedView />}
        </>
      ) : (
        <>
          <div className="overflow-x-auto pb-1">
            <SegmentedTabs
              value={studentSub}
              onChange={(k) => setStudentSub(k as StudentSub)}
              options={[
                { key: "reports", label: "Reports" },
                { key: "byStudent", label: "By Student" },
                { key: "bySection", label: "By Section" },
              ]}
            />
          </div>
          {studentSub === "reports" && <SectionReportsView title="Student Attendance" />}
          {studentSub === "byStudent" && <StudentAttendanceHistoryPicker hrefBase="/hod/students" />}
          {studentSub === "bySection" && (
            <SectionAttendanceCalendarPicker
              hrefBase="/hod/monthly-records"
              description="Pick a section to view its day-wise monthly attendance calendar."
            />
          )}
        </>
      )}
    </div>
  );
}
