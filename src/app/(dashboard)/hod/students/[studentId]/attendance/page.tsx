"use client";

import { useParams, useSearchParams } from "next/navigation";
import { StudentAttendanceHistoryReport } from "@/components/attendance/StudentAttendanceHistoryReport";
import { HOD_STUDENTS_BACK_PARAM, HOD_STUDENTS_LIST_PATH, safeHodStudentsBack } from "@/lib/students/hodListReturn";

export default function HodStudentAttendanceHistoryPage() {
  const { studentId } = useParams<{ studentId: string }>();
  const searchParams = useSearchParams();
  const name = searchParams.get("name") || "Student";
  // Back returns to the list exactly as it was opened from (filters, search, page).
  const backHref = safeHodStudentsBack(searchParams.get(HOD_STUDENTS_BACK_PARAM)) ?? HOD_STUDENTS_LIST_PATH;

  return <StudentAttendanceHistoryReport studentId={studentId} studentName={name} backHref={backHref} />;
}
