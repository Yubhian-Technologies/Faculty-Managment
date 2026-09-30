"use client";

import { useParams } from "next/navigation";
import { FacultyModuleEditPage } from "@/components/faculty/FacultyModuleEditPage";
import type { ProfileModuleKey } from "@/lib/faculty/profileModules";

export default function HodFacultyModuleEditPage() {
  const { id, module: moduleParam } = useParams<{ id: string; module: string }>();
  return (
    <FacultyModuleEditPage
      facultyId={id}
      moduleKey={moduleParam as ProfileModuleKey}
      moduleHref={`/hod/faculty/${id}/${moduleParam}`}
      listHref="/hod/faculty"
    />
  );
}
