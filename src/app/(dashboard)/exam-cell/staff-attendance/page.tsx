"use client";

import { AttendanceReportView } from "@/components/attendance/AttendanceReportView";

export default function ExamCellStaffAttendancePage() {
  return (
    <AttendanceReportView
      title="Staff Attendance"
      description="Daily attendance of Exam Cell staff, verified by face and location."
      allowManualMark
      monthlyViewBasePath="/exam-cell/staff-attendance"
      importHref="/exam-cell/attendance-import"
    />
  );
}
