"use client";

import { useParams } from "next/navigation";
import { FacultyModuleEditPage } from "@/components/faculty/FacultyModuleEditPage";
import type { ProfileModuleKey } from "@/lib/faculty/profileModules";

export default function PrincipalFacultyModuleEditPage() {
  const { deptId, facultyId, module: moduleParam } = useParams<{ deptId: string; facultyId: string; module: string }>();
  return (
    <FacultyModuleEditPage
      facultyId={facultyId}
      moduleKey={moduleParam as ProfileModuleKey}
      moduleHref={`/principal/faculty/${deptId}/${facultyId}/${moduleParam}`}
      listHref={`/principal/faculty/${deptId}`}
    />
  );
}
