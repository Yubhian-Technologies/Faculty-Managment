"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { FacultyProfileModuleContent } from "@/components/faculty/FacultyProfileModuleContent";
import { PROFILE_MODULES, type ProfileModuleKey } from "@/lib/faculty/profileModules";
import type { FacultyMember, TeachingAssignment, College, ResearchPublication } from "@/types";

export default function ManagementFacultyModulePage() {
  const params = useParams<{ collegeId: string; deptId: string; facultyId: string; module: string }>();
  const { collegeId, deptId, facultyId } = params;
  const moduleKey = params.module as ProfileModuleKey;
  const moduleDef = PROFILE_MODULES[moduleKey];

  const { data, isLoading } = useQuery({
    queryKey: ["mgmt-faculty", collegeId, deptId, facultyId],
    queryFn: () =>
      fetch(`/api/management/colleges/${collegeId}/departments/${deptId}/faculty/${facultyId}`)
        .then((r) => r.json() as Promise<{ faculty: FacultyMember; teachingAssignments: TeachingAssignment[]; publications?: ResearchPublication[] }>),
    enabled: !!moduleDef,
  });
  const faculty = data?.faculty ?? null;
  const teachingAssignments = data?.teachingAssignments ?? [];
  const publications = data?.publications ?? [];

  const { data: collegeData } = useQuery({
    queryKey: ["mgmt-college-type", collegeId],
    queryFn: () =>
      fetch(`/api/management/colleges/${collegeId}`)
        .then((r) => r.json() as Promise<{ college?: College }>),
  });
  const collegeType = collegeData?.college?.type;

  if (!moduleDef) {
    return <p className="text-sm text-muted-foreground">Unknown section.</p>;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={moduleDef.label}
        description={faculty?.name}
        actions={
          <Button variant="outline" asChild>
            <Link href={`/management/faculty/${collegeId}/departments/${deptId}/faculty/${facultyId}`}>
              <ArrowLeft className="h-4 w-4 mr-2" />Back
            </Link>
          </Button>
        }
      />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : faculty ? (
        <FacultyProfileModuleContent
          moduleKey={moduleKey}
          faculty={faculty}
          teachingAssignments={teachingAssignments}
          collegeType={collegeType}
          publications={publications}
        />
      ) : (
        <p className="text-sm text-muted-foreground">Faculty record not found.</p>
      )}
    </div>
  );
}
