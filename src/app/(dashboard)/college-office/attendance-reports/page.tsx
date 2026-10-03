"use client";

import { StudentAttendanceReportView } from "@/components/attendance/StudentAttendanceReportView";

// College Office: the same student attendance report (filters, table, export)
// the Principal gets, across the whole college and view-only. Faculty Not Posted
// is deliberately not offered here.
export default function CollegeOfficeAttendanceReportsPage() {
  return <StudentAttendanceReportView title="Student Attendance" />;
}
