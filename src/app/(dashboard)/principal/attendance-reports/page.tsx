"use client";

import { useState } from "react";
import { SegmentedTabs } from "@/components/shared/SegmentedTabs";
import { SectionReportsView } from "@/components/attendance/SectionReportsView";
import { FacultyAttendanceCompletionView } from "@/components/attendance/FacultyAttendanceCompletionView";
import { FacultyNotPostedView } from "@/components/attendance/FacultyNotPostedView";
import { StudentAttendanceByStudentView } from "@/components/attendance/StudentAttendanceByStudentView";

type Person = "faculty" | "students";
type FacultySub = "completion" | "notposted";
type StudentSub = "reports" | "byStudent";

// Student and faculty attendance reports. Every student view is one page: filters (Department -> Course -> Year -> Section)
// plus a Load button - no multi-page drill-downs. The old nested /attendance-reports/... and /attendance-history/... routes redirect here.
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
              ]}
            />
          </div>
          {studentSub === "reports" && <SectionReportsView title="Student Attendance" />}
          {studentSub === "byStudent" && <StudentAttendanceByStudentView />}
        </>
      )}
    </div>
  );
}
