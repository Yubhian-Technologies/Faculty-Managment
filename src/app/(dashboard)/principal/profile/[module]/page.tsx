"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Pencil } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { FacultyProfileModuleContent } from "@/components/faculty/FacultyProfileModuleContent";
import { PROFILE_MODULES, SELF_EDIT_DISABLED_MODULES, type ProfileModuleKey } from "@/lib/faculty/profileModules";
import { useAuth } from "@/hooks/useAuth";

// Principal/VP have no FacultyMember record of their own (see AGENTS.md) - their
// academicProfile lives directly on the FMSUser session doc, so this sources
// from useAuth() rather than /api/college/faculty/me (see MyProfileModulePage,
// used by HOD/Panel instead, both of which do have a backing record).
export default function PrincipalProfileModulePage() {
  const { user } = useAuth();
  const params = useParams<{ module: string }>();
  const moduleKey = params.module as ProfileModuleKey;
  const moduleDef = PROFILE_MODULES[moduleKey];

  if (!user) return null;
  if (!moduleDef) return <p className="text-sm text-muted-foreground">Unknown section.</p>;

  return (
    <div className="space-y-6">
      <PageHeader
        title={moduleDef.label}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link href="/principal/profile"><ArrowLeft className="h-4 w-4 mr-2" />Back</Link>
            </Button>
            {!SELF_EDIT_DISABLED_MODULES.includes(moduleKey) && (
              <Button asChild>
                <Link href={`/principal/profile/${moduleKey}/edit`}><Pencil className="h-4 w-4 mr-2" />Edit</Link>
              </Button>
            )}
          </div>
        }
      />

      <FacultyProfileModuleContent moduleKey={moduleKey} faculty={user} includeTeachingAssignment={false} />
    </div>
  );
}
