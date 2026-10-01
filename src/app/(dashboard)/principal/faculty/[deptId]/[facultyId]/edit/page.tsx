"use client";

import { useParams } from "next/navigation";
import { FacultyIdentityEditPage } from "@/components/faculty/FacultyIdentityEditPage";

// Same editor the HOD uses - the API (PATCH /api/college/faculty/[id]) already
// accepts Principal/College Admin with no department restriction.
export default function PrincipalEditFacultyPage() {
  const { deptId, facultyId } = useParams<{ deptId: string; facultyId: string }>();
  return (
    <FacultyIdentityEditPage
      facultyId={facultyId}
      detailHref={`/principal/faculty/${deptId}/${facultyId}`}
      listHref={`/principal/faculty/${deptId}`}
    />
  );
}
