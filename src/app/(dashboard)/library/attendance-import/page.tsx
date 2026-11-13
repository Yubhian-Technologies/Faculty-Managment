"use client";

import { AttendanceImportPage } from "@/components/attendance/AttendanceImportPage";

export default function LibraryAttendanceImportPage() {
  return (
    <AttendanceImportPage
      title="Import Attendance History"
      description="Record past attendance in bulk for library staff."
      backHref="/library/staff-attendance"
      backLabel="Back to Staff Attendance"
    />
  );
}
