"use client";

import { AttendanceImportPage } from "@/components/attendance/AttendanceImportPage";

export default function TAndPAttendanceImportPage() {
  return (
    <AttendanceImportPage
      title="Import Attendance History"
      description="Record past attendance in bulk for T&P staff."
      backHref="/t-and-p/staff-attendance"
      backLabel="Back to Staff Attendance"
    />
  );
}
