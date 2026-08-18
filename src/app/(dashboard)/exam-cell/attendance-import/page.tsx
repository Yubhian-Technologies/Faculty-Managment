"use client";

import { AttendanceImportPage } from "@/components/attendance/AttendanceImportPage";

export default function ExamCellAttendanceImportPage() {
  return (
    <AttendanceImportPage
      title="Import Attendance History"
      description="Bulk-backfill old attendance records for Exam Cell staff"
      backHref="/exam-cell/staff-attendance"
      backLabel="Back to Staff Attendance"
    />
  );
}
