"use client";

import { FacultyAttendanceCompletionView } from "@/components/attendance/FacultyAttendanceCompletionView";

export default function PrincipalAttendanceCompletionPage() {
  return (
    <FacultyAttendanceCompletionView
      title="Attendance Completion"
      description="Check whether faculty submitted student attendance for their scheduled periods, and whether it was on time"
    />
  );
}
