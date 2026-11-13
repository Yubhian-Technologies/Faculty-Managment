"use client";

import { AttendanceImportPage } from "@/components/attendance/AttendanceImportPage";

export default function CollegeOfficeAttendanceImportPage() {
  return (
    <AttendanceImportPage
      title="Import Attendance History"
      description="Record past attendance in bulk for College Office staff."
      backHref="/college-office/staff-attendance"
      backLabel="Back to Staff Attendance"
    />
  );
}
