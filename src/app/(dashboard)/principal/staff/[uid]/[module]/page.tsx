"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Pencil } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { FacultyProfileModuleContent } from "@/components/faculty/FacultyProfileModuleContent";
import { PROFILE_MODULES, type ProfileModuleKey } from "@/lib/faculty/profileModules";
import { useCollegeType } from "@/hooks/useCollegeType";
import { toast } from "@/hooks/useToast";
import type { FacultyMember } from "@/types";

export default function PrincipalStaffModulePage() {
  const router = useRouter();
  const params = useParams<{ uid: string; module: string }>();
  const uid = params.uid;
  const moduleKey = params.module as ProfileModuleKey;
  const moduleDef = PROFILE_MODULES[moduleKey];
  const { collegeType } = useCollegeType();

  const [staff, setStaff] = useState<Partial<FacultyMember> | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!moduleDef) return;
    fetch(`/api/college/users/${uid}`)
      .then((r) => r.json() as Promise<{ user?: Partial<FacultyMember> }>)
      .then((d) => {
        if (!d.user) {
          toast({ variant: "destructive", title: "Staff account not found" });
          router.push("/principal/staff");
          return;
        }
        setStaff(d.user);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load staff account" }))
      .finally(() => setIsLoading(false));
  }, [uid, moduleDef, router]);

  if (!moduleDef) {
    return <p className="text-sm text-muted-foreground">Unknown section.</p>;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={moduleDef.label}
        description={staff?.name}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link href={`/principal/staff/${uid}`}><ArrowLeft className="h-4 w-4 mr-2" />Back</Link>
            </Button>
            {moduleKey !== "research" && moduleKey !== "financial" && (
              <Button asChild>
                <Link href={`/principal/staff/${uid}/${moduleKey}/edit`}><Pencil className="h-4 w-4 mr-2" />Edit</Link>
              </Button>
            )}
          </div>
        }
      />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : staff ? (
        <FacultyProfileModuleContent moduleKey={moduleKey} faculty={staff} includeTeachingAssignment={false} collegeType={collegeType} />
      ) : null}
    </div>
  );
}
