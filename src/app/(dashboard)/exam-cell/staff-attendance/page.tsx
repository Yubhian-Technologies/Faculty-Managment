"use client";

import { AttendanceReportView } from "@/components/attendance/AttendanceReportView";

export default function ExamCellStaffAttendancePage() {
  return (
    <AttendanceReportView
      title="Staff Attendance"
      description="Daily self-attendance (face + location verified) for Exam Cell staff"
      allowManualMark
      monthlyViewBasePath="/exam-cell/staff-attendance"
      importHref="/exam-cell/attendance-import"
    />
  );
}
