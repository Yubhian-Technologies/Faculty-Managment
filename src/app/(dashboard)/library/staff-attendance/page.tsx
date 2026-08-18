"use client";

import { AttendanceReportView } from "@/components/attendance/AttendanceReportView";

export default function LibraryStaffAttendancePage() {
  return (
    <AttendanceReportView
      title="Staff Attendance"
      description="Daily self-attendance (face + location verified) for Library staff"
      allowManualMark
      monthlyViewBasePath="/library/staff-attendance"
      importHref="/library/attendance-import"
    />
  );
}
