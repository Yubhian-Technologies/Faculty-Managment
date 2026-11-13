"use client";

import { AttendanceImportPage } from "@/components/attendance/AttendanceImportPage";

export default function ExamCellAttendanceImportPage() {
  return (
    <AttendanceImportPage
      title="Import Attendance History"
      description="Record past attendance in bulk for Exam Cell staff."
      backHref="/exam-cell/staff-attendance"
      backLabel="Back to Staff Attendance"
    />
  );
}
