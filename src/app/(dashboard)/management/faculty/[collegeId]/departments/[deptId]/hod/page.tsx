"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { StaffProfileView } from "@/components/management/StaffProfileView";
import type { Department } from "@/types";

export default function ManagementHodPage() {
  const { collegeId, deptId } = useParams<{ collegeId: string; deptId: string }>();
  const [departmentName, setDepartmentName] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/management/colleges/${collegeId}/departments/${deptId}`)
      .then((r) => r.json() as Promise<{ department: Department }>)
      .then((d) => setDepartmentName(d.department?.name ?? ""));
  }, [collegeId, deptId]);

  if (departmentName === null) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <StaffProfileView
      collegeId={collegeId}
      role="HOD"
      title="Head of Department"
      department={departmentName}
      backHref={`/management/faculty/${collegeId}/departments/${deptId}`}
    />
  );
}
