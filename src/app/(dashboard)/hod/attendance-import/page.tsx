"use client";

import { AttendanceImportPage } from "@/components/attendance/AttendanceImportPage";

export default function HodAttendanceImportPage() {
  return (
    <AttendanceImportPage
      title="Import Attendance History"
      description="Record past attendance in bulk for your department's faculty and yourself."
      backHref="/hod/faculty-attendance"
      backLabel="Back to Faculty Attendance"
    />
  );
}
