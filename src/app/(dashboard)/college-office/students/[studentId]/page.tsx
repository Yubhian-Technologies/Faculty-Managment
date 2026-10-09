"use client";

import { useParams, useSearchParams } from "next/navigation";
import { StudentDetailsPage } from "@/components/students/StudentDetailsPage";
import { resolveListBack } from "@/lib/listReturn";

export default function OfficeStudentDetailsPage() {
  const { studentId } = useParams<{ studentId: string }>();
  // Back returns to the list exactly as it was opened from (tab, filters, page).
  const backHref = resolveListBack(useSearchParams(), "/college-office/students");
  return <StudentDetailsPage studentId={studentId} backHref={backHref} editable lifecycle />;
}
