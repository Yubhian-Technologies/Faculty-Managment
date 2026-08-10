"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { FacultyProfileHub } from "@/components/faculty/FacultyProfileHub";
import type { Department, FacultyMember } from "@/types";

export default function PrincipalFacultyProfilePage() {
  const { deptId, facultyId } = useParams<{ deptId: string; facultyId: string }>();

  const { data: faculty, isLoading } = useQuery({
    queryKey: ["principal-faculty-profile", facultyId],
    queryFn: () =>
      fetch(`/api/college/faculty/${facultyId}`)
        .then((r) => r.json() as Promise<{ faculty?: FacultyMember }>)
        .then((d) => d.faculty ?? null),
  });

  const { data: departments } = useQuery({
    queryKey: ["departments-for-hierarchy"],
    queryFn: () =>
      fetch("/api/college/departments")
        .then((r) => r.json() as Promise<{ departments: Department[] }>)
        .then((d) => d.departments ?? []),
  });
  const parentDeptName = (() => {
    const dept = departments?.find((d) => d.name === faculty?.department);
    if (!dept?.parentDepartmentId) return null;
    return departments?.find((d) => d.id === dept.parentDepartmentId)?.name ?? null;
  })();

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!faculty) return <p className="text-sm text-muted-foreground">Faculty record not found.</p>;

  return (
    <FacultyProfileHub
      faculty={faculty}
      basePath={`/principal/faculty/${deptId}/${facultyId}`}
      backHref={`/principal/faculty/${deptId}`}
      parentDeptName={parentDeptName}
    />
  );
}
