"use client";

import { AttendanceReportView } from "@/components/attendance/AttendanceReportView";

// "Attendance" = daily self check-in/out marking only, college-wide.
// Reports/history/completion views live under the separate "Attendance
// Reports" tab (/principal/attendance-reports) - see that page for why
// they're split out. Import is reached via the "Import" link
// AttendanceReportView already renders internally (importHref), not a
// separate tab.
export default function PrincipalAttendanceReportPage() {
  return (
    <AttendanceReportView
      title="Attendance Report"
      description="Daily self-attendance (face + location verified) across the college"
      groupByDepartmentAndCourse
      allowManualMark
      monthlyViewBasePath="/principal/attendance-report"
      importHref="/principal/attendance-import"
    />
  );
}
