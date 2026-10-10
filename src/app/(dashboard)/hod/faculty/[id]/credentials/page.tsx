"use client";

import { useParams, useSearchParams } from "next/navigation";
import { FacultyCredentialsPage } from "@/components/faculty/FacultyCredentialsPage";
import { resolveListBack } from "@/lib/listReturn";

export default function HodFacultyCredentialsPage() {
  const { id } = useParams<{ id: string }>();
  // Returns to the register as it was opened from (status tab, department).
  const listHref = resolveListBack(useSearchParams(), "/hod/faculty");
  return <FacultyCredentialsPage facultyId={id} listHref={listHref} />;
}
