"use client";

import { AttendanceReportView } from "@/components/attendance/AttendanceReportView";

export default function CollegeOfficeStaffAttendancePage() {
  return (
    <AttendanceReportView
      title="Staff Attendance"
      description="Daily attendance of College Office staff, verified by face and location."
      allowManualMark
      monthlyViewBasePath="/college-office/staff-attendance"
      importHref="/college-office/attendance-import"
    />
  );
}
