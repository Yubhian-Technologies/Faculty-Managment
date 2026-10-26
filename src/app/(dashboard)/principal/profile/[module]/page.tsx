"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Pencil } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { FacultyProfileModuleContent } from "@/components/faculty/FacultyProfileModuleContent";
import { PROFILE_MODULES, SELF_EDIT_DISABLED_MODULES, type ProfileModuleKey } from "@/lib/faculty/profileModules";
import { useAuth } from "@/hooks/useAuth";
import { useCollegeType } from "@/hooks/useCollegeType";
import { FacultyProfileRedirect } from "@/components/faculty/FacultyProfileRedirect";

// Principal/VP have no FacultyMember record of their own (see AGENTS.md) - their
// academicProfile lives directly on the FMSUser session doc, so this sources
// from useAuth() rather than /api/college/faculty/me (see MyProfileModulePage,
// used by HOD/Panel instead, both of which do have a backing record).
function PrincipalProfileModulePageContent() {
  const { user } = useAuth();
  const params = useParams<{ module: string }>();
  const moduleKey = params.module as ProfileModuleKey;
  const moduleDef = PROFILE_MODULES[moduleKey];
  const { collegeType } = useCollegeType();

  if (!user) return null;
  if (!moduleDef) return <p className="text-sm text-muted-foreground">Unknown section.</p>;

  // Same rule as the Edit button in the header: the empty-tab message offers an edit only when the header does.
  const editHref = !SELF_EDIT_DISABLED_MODULES.includes(moduleKey) ? `/principal/profile/${moduleKey}/edit` : undefined;

  return (
    <div className="space-y-6">
      <PageHeader
        title={moduleDef.label}
        note={moduleDef.description}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link href="/principal/profile"><ArrowLeft className="h-4 w-4 mr-2" />Back</Link>
            </Button>
            {editHref && (
              <Button asChild>
                <Link href={editHref}><Pencil className="h-4 w-4 mr-2" />Edit</Link>
              </Button>
            )}
          </div>
        }
      />

      <FacultyProfileModuleContent editHref={editHref} moduleKey={moduleKey} faculty={user} includeTeachingAssignment={false} collegeType={collegeType} isOwnProfile />
    </div>
  );
}

// A login that has a faculty record is taken to the one faculty profile (the avatar's); anyone else keeps this page.
export default function PrincipalProfileModulePage() {
  return <FacultyProfileRedirect><PrincipalProfileModulePageContent /></FacultyProfileRedirect>;
}
