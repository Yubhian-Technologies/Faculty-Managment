"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";
import { FacultyCredentialsPage } from "@/components/faculty/FacultyCredentialsPage";
import { useReturnTo } from "@/hooks/useReturnTo";

function Content() {
  const { deptId, facultyId } = useParams<{ deptId: string; facultyId: string }>();
  const returnTo = useReturnTo();
  return <FacultyCredentialsPage facultyId={facultyId} listHref={returnTo ?? `/principal/faculty/${deptId}`} />;
}

export default function PrincipalFacultyCredentialsPage() {
  return <Suspense fallback={null}><Content /></Suspense>;
}
