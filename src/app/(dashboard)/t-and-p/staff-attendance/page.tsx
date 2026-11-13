"use client";

import { AttendanceReportView } from "@/components/attendance/AttendanceReportView";

export default function TAndPStaffAttendancePage() {
  return (
    <AttendanceReportView
      title="Staff Attendance"
      description="Daily attendance of T&P staff, verified by face and location."
      allowManualMark
      monthlyViewBasePath="/t-and-p/staff-attendance"
      importHref="/t-and-p/attendance-import"
    />
  );
}
