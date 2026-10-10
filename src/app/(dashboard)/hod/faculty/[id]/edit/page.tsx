"use client";

import { useParams, useSearchParams } from "next/navigation";
import { FacultyIdentityEditPage } from "@/components/faculty/FacultyIdentityEditPage";
import { resolveListBack, withListBack } from "@/lib/listReturn";

export default function EditHodFacultyIdentityPage() {
  const { id } = useParams<{ id: string }>();
  // Save / Cancel / Back return to the profile and register as they were opened from.
  const listHref = resolveListBack(useSearchParams(), "/hod/faculty");
  return <FacultyIdentityEditPage facultyId={id} detailHref={withListBack(`/hod/faculty/${id}`, listHref, "/hod/faculty")} listHref={listHref} />;
}
