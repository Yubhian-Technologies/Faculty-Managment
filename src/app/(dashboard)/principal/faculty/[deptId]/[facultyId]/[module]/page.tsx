"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Pencil } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { FacultyProfileModuleContent } from "@/components/faculty/FacultyProfileModuleContent";
import { facultyDisplayName } from "@/lib/faculty/facultyDisplayName";
import { PROFILE_MODULES, type ProfileModuleKey } from "@/lib/faculty/profileModules";
import { useCollegeType } from "@/hooks/useCollegeType";
import type { FacultyMember, TeachingAssignment } from "@/types";

export default function PrincipalFacultyModulePage() {
  const { deptId, facultyId, module: moduleParam } = useParams<{ deptId: string; facultyId: string; module: string }>();
  const moduleKey = moduleParam as ProfileModuleKey;
  const moduleDef = PROFILE_MODULES[moduleKey];
  const { collegeType } = useCollegeType();

  const { data: faculty, isLoading } = useQuery({
    queryKey: ["principal-faculty-profile", facultyId],
    queryFn: () =>
      fetch(`/api/college/faculty/${facultyId}`)
        .then((r) => r.json() as Promise<{ faculty?: FacultyMember }>)
        .then((d) => d.faculty ?? null),
    // Edited from this page's own Edit route - see the profile hub page.
    refetchOnMount: "always",
  });

  const { data: teachingAssignments = [] } = useQuery({
    queryKey: ["principal-faculty-teaching-load", facultyId],
    queryFn: () =>
      fetch(`/api/college/teaching-assignments?facultyId=${encodeURIComponent(facultyId)}`)
        .then((r) => r.json() as Promise<{ assignments?: TeachingAssignment[] }>)
        .then((d) => d.assignments ?? []),
    enabled: moduleKey === "teaching-load",
    refetchOnMount: "always",
  });

  if (!moduleDef) return <p className="text-sm text-muted-foreground">Unknown section.</p>;

  return (
    <div className="space-y-6">
      <PageHeader
        title={moduleDef.label}
        description={facultyDisplayName(faculty)}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link href={`/principal/faculty/${deptId}/${facultyId}`}><ArrowLeft className="h-4 w-4 mr-2" />Back</Link>
            </Button>
            {/* Same modules the HOD can edit - Research and Financial stay read-only
                (Research is the faculty's own publications; Financial is College Office's). */}
            {moduleKey !== "research" && moduleKey !== "financial" && (
              <Button asChild>
                <Link href={`/principal/faculty/${deptId}/${facultyId}/${moduleKey}/edit`}><Pencil className="h-4 w-4 mr-2" />Edit</Link>
              </Button>
            )}
          </div>
        }
      />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : faculty ? (
        <FacultyProfileModuleContent moduleKey={moduleKey} faculty={faculty} teachingAssignments={teachingAssignments} collegeType={collegeType} hideLegalName showNameAsPerPan ratificationHistory />
      ) : null}
    </div>
  );
}
