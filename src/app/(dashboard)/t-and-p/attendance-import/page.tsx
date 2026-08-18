"use client";

import { AttendanceImportPage } from "@/components/attendance/AttendanceImportPage";

export default function TAndPAttendanceImportPage() {
  return (
    <AttendanceImportPage
      title="Import Attendance History"
      description="Bulk-backfill old attendance records for T&P staff"
      backHref="/t-and-p/staff-attendance"
      backLabel="Back to Staff Attendance"
    />
  );
}
