"use client";

import { AttendanceImportPage } from "@/components/attendance/AttendanceImportPage";

export default function PrincipalAttendanceImportPage() {
  return (
    <AttendanceImportPage
      title="Import Attendance History"
      description="Record past attendance in bulk for anyone in the college."
      backHref="/principal/attendance-report"
      backLabel="Back to Attendance Report"
    />
  );
}
