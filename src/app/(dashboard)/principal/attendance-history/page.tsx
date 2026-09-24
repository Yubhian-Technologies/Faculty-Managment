"use client";

import { DepartmentAttendancePicker } from "@/components/attendance/DepartmentAttendancePicker";

export default function PrincipalAttendanceHistoryDepartmentsPage() {
  return (
    <DepartmentAttendancePicker
      hrefBase="/principal/attendance-history"
      title="Student Attendance History"
      description="Pick a department, then a course and section, to view a student's cumulative attendance."
    />
  );
}
