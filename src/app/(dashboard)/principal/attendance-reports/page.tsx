"use client";

import { useState } from "react";
import { SegmentedTabs } from "@/components/shared/SegmentedTabs";
import { SectionReportsView } from "@/components/attendance/SectionReportsView";
import { FacultyAttendanceCompletionView } from "@/components/attendance/FacultyAttendanceCompletionView";
import { FacultyNotPostedView } from "@/components/attendance/FacultyNotPostedView";
import { DepartmentAttendancePicker } from "@/components/attendance/DepartmentAttendancePicker";

type Person = "faculty" | "students";
type FacultySub = "completion" | "notposted";
type StudentSub = "reports" | "byStudent" | "bySection";

// Every attendance REPORT module in one place, college-wide - was 6
// separate sidebar items (Student Attendance History, Attendance
// Completion, Absent Report, Shortage Report, Faculty Not Posted, plus this
// route itself, which existed but had no nav link at all). Distinct from
// the "Attendance" tab (/principal/attendance-report), which is daily
// check-in/out marking, not report viewing. "By Section" below reuses this
// same route's own nested [departmentId]/... drill (unchanged) - only the
// index page changed, from "always show the department picker" to "show it
// inside a tab". "By Student" reuses /principal/attendance-history's
// nested drill the same way. Old standalone routes still work (unlinked,
// not deleted) for any existing notification links/bookmarks.
export default function PrincipalAttendanceReportsPage() {
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
              description="Check whether faculty submitted student attendance for their scheduled periods, and whether it was on time"
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
          {studentSub === "byStudent" && (
            <DepartmentAttendancePicker
              hrefBase="/principal/attendance-history"
              title="Student Attendance History"
              description="Pick a department, then a course and section, to view a student's cumulative attendance."
            />
          )}
          {studentSub === "bySection" && (
            <DepartmentAttendancePicker
              hrefBase="/principal/attendance-reports"
              title="Student Attendance Report"
              description="Pick a department to view its courses, sections and attendance history."
            />
          )}
        </>
      )}
    </div>
  );
}
