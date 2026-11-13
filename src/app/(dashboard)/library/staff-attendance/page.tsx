"use client";

import { AttendanceReportView } from "@/components/attendance/AttendanceReportView";

export default function LibraryStaffAttendancePage() {
  return (
    <AttendanceReportView
      title="Staff Attendance"
      description="Daily attendance of library staff, verified by face and location."
      allowManualMark
      monthlyViewBasePath="/library/staff-attendance"
      importHref="/library/attendance-import"
    />
  );
}
