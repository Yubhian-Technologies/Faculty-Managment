"use client";

import { AttendanceReportView } from "@/components/attendance/AttendanceReportView";

export default function TAndPStaffAttendancePage() {
  return (
    <AttendanceReportView
      title="Staff Attendance"
      description="Daily self-attendance (face + location verified) for T&P staff"
      allowManualMark
      monthlyViewBasePath="/t-and-p/staff-attendance"
      importHref="/t-and-p/attendance-import"
    />
  );
}
