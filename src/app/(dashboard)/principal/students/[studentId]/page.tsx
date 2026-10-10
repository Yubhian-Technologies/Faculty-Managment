"use client";

import { useParams, useSearchParams } from "next/navigation";
import { StudentDetailsPage } from "@/components/students/StudentDetailsPage";
import { resolveListBack } from "@/lib/listReturn";

export default function PrincipalStudentDetailsPage() {
  const { studentId } = useParams<{ studentId: string }>();
  // Back returns to the list exactly as it was opened from (tab, filters, search, page).
  const backHref = resolveListBack(useSearchParams(), "/principal/students");
  return <StudentDetailsPage studentId={studentId} backHref={backHref} lifecycle canReinstate />;
}
