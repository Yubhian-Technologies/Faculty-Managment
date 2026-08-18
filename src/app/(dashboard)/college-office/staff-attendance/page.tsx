"use client";

import { AttendanceReportView } from "@/components/attendance/AttendanceReportView";

export default function CollegeOfficeStaffAttendancePage() {
  return (
    <AttendanceReportView
      title="Staff Attendance"
      description="Daily self-attendance (face + location verified) for College Office staff"
      allowManualMark
      monthlyViewBasePath="/college-office/staff-attendance"
      importHref="/college-office/attendance-import"
    />
  );
}
