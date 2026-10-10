"use client";

import { useParams, useSearchParams } from "next/navigation";
import { StudentDetailsPage } from "@/components/students/StudentDetailsPage";
import { HOD_STUDENTS_BACK_PARAM, HOD_STUDENTS_LIST_PATH, safeHodStudentsBack } from "@/lib/students/hodListReturn";

export default function HodStudentDetailsPage() {
  const { studentId } = useParams<{ studentId: string }>();
  // Back returns to the list exactly as it was opened from (filters, search, page).
  const backHref = safeHodStudentsBack(useSearchParams().get(HOD_STUDENTS_BACK_PARAM)) ?? HOD_STUDENTS_LIST_PATH;
  return <StudentDetailsPage studentId={studentId} backHref={backHref} lifecycle />;
}
