"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Pencil } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { FacultyProfileModuleContent } from "@/components/faculty/FacultyProfileModuleContent";
import { PROFILE_MODULES, SELF_EDIT_DISABLED_MODULES, type ProfileModuleKey } from "@/lib/faculty/profileModules";
import { useCollegeType } from "@/hooks/useCollegeType";
import type { FacultyMember, TeachingAssignment } from "@/types";

type MyFaculty = Partial<FacultyMember> & { id: string; isActive?: boolean };

// Shared module-detail page for self-profile routes (/hod/profile/[module],
// /panel/profile/[module]) - both source from /api/college/faculty/me the
// same way MyProfileDetails used to. Principal/VP's own profile sources from
// the authStore user directly instead (no FacultyMember record - see
// principal/profile/page.tsx), so it doesn't use this.
export function MyProfileModulePage({ basePath }: { basePath: string }) {
  const params = useParams<{ module: string }>();
  const moduleKey = params.module as ProfileModuleKey;
  const moduleDef = PROFILE_MODULES[moduleKey];
  const { collegeType } = useCollegeType();

  const [faculty, setFaculty] = useState<MyFaculty | null>(null);
  const [teachingAssignments, setTeachingAssignments] = useState<TeachingAssignment[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch("/api/college/faculty/me")
      .then((r) => r.json() as Promise<{ faculty: MyFaculty | null; teachingAssignments?: TeachingAssignment[] }>)
      .then((d) => {
        setFaculty(d.faculty);
        setTeachingAssignments(d.teachingAssignments ?? []);
      })
      .catch(() => setFaculty(null))
      .finally(() => setIsLoading(false));
  }, []);

  if (!moduleDef) return <p className="text-sm text-muted-foreground">Unknown section.</p>;

  return (
    <div className="space-y-6">
      <PageHeader
        title={moduleDef.label}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link href={basePath}><ArrowLeft className="h-4 w-4 mr-2" />Back</Link>
            </Button>
            {!SELF_EDIT_DISABLED_MODULES.includes(moduleKey) && (
              <Button asChild>
                <Link href={`${basePath}/${moduleKey}/edit`}><Pencil className="h-4 w-4 mr-2" />Edit</Link>
              </Button>
            )}
          </div>
        }
      />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : faculty ? (
        <FacultyProfileModuleContent moduleKey={moduleKey} faculty={faculty} teachingAssignments={teachingAssignments} collegeType={collegeType} />
      ) : (
        <p className="text-sm text-muted-foreground">No profile record found.</p>
      )}
    </div>
  );
}
