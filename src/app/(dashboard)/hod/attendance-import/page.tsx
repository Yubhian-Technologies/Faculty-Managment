"use client";

import { AttendanceImportPage } from "@/components/attendance/AttendanceImportPage";

export default function HodAttendanceImportPage() {
  return (
    <AttendanceImportPage
      title="Import Attendance History"
      description="Bulk-backfill old attendance records for your department's Faculty, and your own"
      backHref="/hod/faculty-attendance"
      backLabel="Back to Faculty Attendance"
    />
  );
}
