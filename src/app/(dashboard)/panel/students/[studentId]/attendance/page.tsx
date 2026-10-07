"use client";

import { useParams, useSearchParams } from "next/navigation";
import { StudentAttendanceHistoryReport } from "@/components/attendance/StudentAttendanceHistoryReport";

export default function PanelStudentAttendanceHistoryPage() {
  const { studentId } = useParams<{ studentId: string }>();
  const searchParams = useSearchParams();
  const name = searchParams.get("name") || "Student";

  return <StudentAttendanceHistoryReport studentId={studentId} studentName={name} backHref="/panel/students" />;
}
