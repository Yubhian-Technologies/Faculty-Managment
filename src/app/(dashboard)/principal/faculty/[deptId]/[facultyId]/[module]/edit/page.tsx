"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";
import { FacultyModuleEditPage } from "@/components/faculty/FacultyModuleEditPage";
import { useReturnTo } from "@/hooks/useReturnTo";
import { withReturnTo } from "@/lib/faculty/returnTo";
import type { ProfileModuleKey } from "@/lib/faculty/profileModules";

function Content() {
  const { deptId, facultyId, module: moduleParam } = useParams<{ deptId: string; facultyId: string; module: string }>();
  const returnTo = useReturnTo();
  return (
    <FacultyModuleEditPage
      facultyId={facultyId}
      moduleKey={moduleParam as ProfileModuleKey}
      moduleHref={withReturnTo(`/principal/faculty/${deptId}/${facultyId}/${moduleParam}`, returnTo)}
      listHref={returnTo ?? `/principal/faculty/${deptId}`}
    />
  );
}

export default function PrincipalFacultyModuleEditPage() {
  return <Suspense fallback={null}><Content /></Suspense>;
}
