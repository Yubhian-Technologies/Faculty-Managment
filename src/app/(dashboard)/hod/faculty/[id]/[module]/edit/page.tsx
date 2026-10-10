"use client";

import { useParams, useSearchParams } from "next/navigation";
import { FacultyModuleEditPage } from "@/components/faculty/FacultyModuleEditPage";
import type { ProfileModuleKey } from "@/lib/faculty/profileModules";
import { resolveListBack, withListBack } from "@/lib/listReturn";

export default function HodFacultyModuleEditPage() {
  const { id, module: moduleParam } = useParams<{ id: string; module: string }>();
  // Save / Cancel / Back return to the section and register as they were opened from.
  const listHref = resolveListBack(useSearchParams(), "/hod/faculty");
  return (
    <FacultyModuleEditPage
      facultyId={id}
      moduleKey={moduleParam as ProfileModuleKey}
      moduleHref={withListBack(`/hod/faculty/${id}/${moduleParam}`, listHref, "/hod/faculty")}
      listHref={listHref}
    />
  );
}
