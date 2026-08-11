"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Pencil } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { FacultyProfileModuleContent } from "@/components/faculty/FacultyProfileModuleContent";
import { PROFILE_MODULES, type ProfileModuleKey } from "@/lib/faculty/profileModules";
import { toast } from "@/hooks/useToast";
import type { College, CollegeType, FacultyMember } from "@/types";

export default function SuperAdminUserModulePage() {
  const router = useRouter();
  const params = useParams<{ uid: string; module: string }>();
  const uid = params.uid;
  const moduleKey = params.module as ProfileModuleKey;
  const moduleDef = PROFILE_MODULES[moduleKey];

  const [staff, setStaff] = useState<Partial<FacultyMember> | null>(null);
  const [collegeType, setCollegeType] = useState<CollegeType | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!moduleDef) return;
    fetch(`/api/admin/users/${uid}`)
      .then((r) => r.json() as Promise<{ user?: Partial<FacultyMember>; error?: string }>)
      .then((d) => {
        if (!d.user) {
          toast({ variant: "destructive", title: d.error ?? "User not found" });
          router.push("/super-admin/users");
          return;
        }
        setStaff(d.user);
        return fetch("/api/admin/colleges")
          .then((r) => r.json() as Promise<{ colleges?: College[] }>)
          .then((c) => setCollegeType(c.colleges?.find((x) => x.id === d.user?.collegeId)?.type))
          .catch(() => {});
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load user" }))
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
              <Link href={`/super-admin/users/${uid}?role=PRINCIPAL`}><ArrowLeft className="h-4 w-4 mr-2" />Back</Link>
            </Button>
            {moduleKey !== "research" && moduleKey !== "financial" && (
              <Button asChild>
                <Link href={`/super-admin/users/${uid}/${moduleKey}/edit`}><Pencil className="h-4 w-4 mr-2" />Edit</Link>
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
