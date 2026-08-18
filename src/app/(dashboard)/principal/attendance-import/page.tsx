"use client";

import { AttendanceImportPage } from "@/components/attendance/AttendanceImportPage";

export default function PrincipalAttendanceImportPage() {
  return (
    <AttendanceImportPage
      title="Import Attendance History"
      description="Bulk-backfill old attendance records for anyone in the college"
      backHref="/principal/attendance-report"
      backLabel="Back to Attendance Report"
    />
  );
}
