"use client";

import { AttendanceReportView } from "@/components/attendance/AttendanceReportView";

// "Attendance" = daily self check-in/out marking only, for HOD's own
// department. Reports/history/completion views live under the separate
// "Attendance Reports" tab (/hod/attendance-reports) - see that page for
// why they're split out. Import is reached via the "Import" link
// AttendanceReportView already renders internally (importHref), not a
// separate tab.
export default function HodFacultyAttendancePage() {
  return (
    <AttendanceReportView
      title="Faculty Attendance"
      description="Daily self-attendance (face + location verified) for your department"
      allowManualMark
      monthlyViewBasePath="/hod/faculty-attendance"
      importHref="/hod/attendance-import"
    />
  );
}
