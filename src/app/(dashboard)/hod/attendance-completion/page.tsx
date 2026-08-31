"use client";

import { FacultyAttendanceCompletionView } from "@/components/attendance/FacultyAttendanceCompletionView";

export default function HodAttendanceCompletionPage() {
  return (
    <FacultyAttendanceCompletionView
      title="Attendance Completion"
      description="Check whether your department's faculty submitted student attendance for their scheduled periods, and whether it was on time"
      hodScoped
    />
  );
}
