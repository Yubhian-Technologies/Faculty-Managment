"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { FacultyProfileHub } from "@/components/faculty/FacultyProfileHub";
import type { Department, FacultyMember } from "@/types";

// Identity card + one tile per module (Personal, Academic Qualification,
// Research, Teaching Load, ...) - same FacultyProfileHub every other role's
// faculty-detail page uses (see hod/faculty/[id]/page.tsx), instead of one
// long scroll of every module at once. Read-only (no editHref) - Management
// never edits a faculty record.
export default function ManagementFacultyDetailPage() {
  const { collegeId, deptId, facultyId } = useParams<{ collegeId: string; deptId: string; facultyId: string }>();

  const { data, isLoading } = useQuery({
    queryKey: ["mgmt-faculty", collegeId, deptId, facultyId],
    queryFn: () =>
      fetch(`/api/management/colleges/${collegeId}/departments/${deptId}/faculty/${facultyId}`)
        .then((r) => r.json() as Promise<{ faculty: FacultyMember }>),
  });
  const faculty = data?.faculty ?? null;

  const { data: departments } = useQuery({
    queryKey: ["mgmt-departments-for-hierarchy", collegeId],
    queryFn: () =>
      fetch(`/api/management/colleges/${collegeId}/departments`)
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
      basePath={`/management/faculty/${collegeId}/departments/${deptId}/faculty/${facultyId}`}
      backHref={`/management/faculty/${collegeId}/departments/${deptId}`}
      parentDeptName={parentDeptName}
    />
  );
}
