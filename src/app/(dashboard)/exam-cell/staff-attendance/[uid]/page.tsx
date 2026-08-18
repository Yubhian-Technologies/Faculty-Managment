"use client";

import { useParams } from "next/navigation";
import { PersonMonthlyAttendanceView } from "@/components/attendance/PersonMonthlyAttendanceView";

export default function ExamCellStaffMonthlyAttendancePage() {
  const { uid } = useParams<{ uid: string }>();
  return <PersonMonthlyAttendanceView facultyId={uid} backHref="/exam-cell/staff-attendance" />;
}
