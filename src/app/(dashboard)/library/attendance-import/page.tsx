"use client";

import { AttendanceImportPage } from "@/components/attendance/AttendanceImportPage";

export default function LibraryAttendanceImportPage() {
  return (
    <AttendanceImportPage
      title="Import Attendance History"
      description="Bulk-backfill old attendance records for Library staff"
      backHref="/library/staff-attendance"
      backLabel="Back to Staff Attendance"
    />
  );
}
