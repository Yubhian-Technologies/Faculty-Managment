"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";
import { FacultyIdentityEditPage } from "@/components/faculty/FacultyIdentityEditPage";
import { useReturnTo } from "@/hooks/useReturnTo";
import { withReturnTo } from "@/lib/faculty/returnTo";

// Same editor the HOD uses - the API (PATCH /api/college/faculty/[id]) already
// accepts Principal/College Admin with no department restriction.
function Content() {
  const { deptId, facultyId } = useParams<{ deptId: string; facultyId: string }>();
  const returnTo = useReturnTo();
  return (
    <FacultyIdentityEditPage
      facultyId={facultyId}
      detailHref={withReturnTo(`/principal/faculty/${deptId}/${facultyId}`, returnTo)}
      listHref={returnTo ?? `/principal/faculty/${deptId}`}
    />
  );
}

export default function PrincipalEditFacultyPage() {
  return <Suspense fallback={null}><Content /></Suspense>;
}
