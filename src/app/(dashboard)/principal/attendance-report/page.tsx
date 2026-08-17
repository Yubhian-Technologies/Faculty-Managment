"use client";

import { AttendanceReportView } from "@/components/attendance/AttendanceReportView";

export default function PrincipalAttendanceReportPage() {
  return (
    <AttendanceReportView
      title="Attendance Report"
      description="Daily self-attendance (face + location verified) across the college"
      groupByDepartmentAndCourse
      allowManualMark
      monthlyViewBasePath="/principal/attendance-report"
    />
  );
}
