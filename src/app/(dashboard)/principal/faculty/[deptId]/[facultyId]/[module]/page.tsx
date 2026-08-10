"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { FacultyProfileModuleContent } from "@/components/faculty/FacultyProfileModuleContent";
import { PROFILE_MODULES, type ProfileModuleKey } from "@/lib/faculty/profileModules";
import type { FacultyMember, TeachingAssignment } from "@/types";

export default function PrincipalFacultyModulePage() {
  const { deptId, facultyId, module: moduleParam } = useParams<{ deptId: string; facultyId: string; module: string }>();
  const moduleKey = moduleParam as ProfileModuleKey;
  const moduleDef = PROFILE_MODULES[moduleKey];

  const { data: faculty, isLoading } = useQuery({
    queryKey: ["principal-faculty-profile", facultyId],
    queryFn: () =>
      fetch(`/api/college/faculty/${facultyId}`)
        .then((r) => r.json() as Promise<{ faculty?: FacultyMember }>)
        .then((d) => d.faculty ?? null),
  });

  const { data: teachingAssignments = [] } = useQuery({
    queryKey: ["principal-faculty-teaching-load", facultyId],
    queryFn: () =>
      fetch(`/api/college/teaching-assignments?facultyId=${encodeURIComponent(facultyId)}`)
        .then((r) => r.json() as Promise<{ assignments?: TeachingAssignment[] }>)
        .then((d) => d.assignments ?? []),
    enabled: moduleKey === "teaching-load",
  });

  if (!moduleDef) return <p className="text-sm text-muted-foreground">Unknown section.</p>;

  return (
    <div className="space-y-6">
      <PageHeader
        title={moduleDef.label}
        description={faculty?.name}
        actions={
          <Button variant="outline" asChild>
            <Link href={`/principal/faculty/${deptId}/${facultyId}`}><ArrowLeft className="h-4 w-4 mr-2" />Back</Link>
          </Button>
        }
      />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : faculty ? (
        <FacultyProfileModuleContent moduleKey={moduleKey} faculty={faculty} teachingAssignments={teachingAssignments} />
      ) : null}
    </div>
  );
}
