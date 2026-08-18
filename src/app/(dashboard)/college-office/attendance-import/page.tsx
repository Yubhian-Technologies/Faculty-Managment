"use client";

import { AttendanceImportPage } from "@/components/attendance/AttendanceImportPage";

export default function CollegeOfficeAttendanceImportPage() {
  return (
    <AttendanceImportPage
      title="Import Attendance History"
      description="Bulk-backfill old attendance records for College Office staff"
      backHref="/college-office/staff-attendance"
      backLabel="Back to Staff Attendance"
    />
  );
}
