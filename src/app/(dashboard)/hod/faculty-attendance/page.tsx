"use client";

import { AttendanceReportView } from "@/components/attendance/AttendanceReportView";

export default function HodFacultyAttendancePage() {
  return (
    <AttendanceReportView
      title="Faculty Attendance"
      description="Daily self-attendance (face + location verified) for your department"
      allowManualMark
      monthlyViewBasePath="/hod/faculty-attendance"
    />
  );
}
