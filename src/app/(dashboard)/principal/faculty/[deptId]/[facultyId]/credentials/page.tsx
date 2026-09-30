"use client";

import { useParams } from "next/navigation";
import { FacultyCredentialsPage } from "@/components/faculty/FacultyCredentialsPage";

export default function PrincipalFacultyCredentialsPage() {
  const { deptId, facultyId } = useParams<{ deptId: string; facultyId: string }>();
  return <FacultyCredentialsPage facultyId={facultyId} listHref={`/principal/faculty/${deptId}`} />;
}
