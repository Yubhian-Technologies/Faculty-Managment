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
import type { FacultyMember, TeachingAssignment } from "@/types";

export default function HodFacultyModulePage() {
  const router = useRouter();
  const params = useParams<{ id: string; module: string }>();
  const facultyId = params.id;
  const moduleKey = params.module as ProfileModuleKey;
  const moduleDef = PROFILE_MODULES[moduleKey];
  const { collegeType } = useCollegeType();

  const [faculty, setFaculty] = useState<FacultyMember | null>(null);
  const [teachingAssignments, setTeachingAssignments] = useState<TeachingAssignment[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!moduleDef) return;
    Promise.all([
      fetch(`/api/college/faculty/${facultyId}`)
        .then((r) => r.json() as Promise<{ faculty?: FacultyMember }>)
        .then((d) => d.faculty ?? null),
      moduleKey === "teaching-load"
        ? fetch(`/api/college/teaching-assignments?facultyId=${encodeURIComponent(facultyId)}`)
            .then((r) => r.json() as Promise<{ assignments?: TeachingAssignment[] }>)
            .then((d) => d.assignments ?? [])
            .catch(() => [])
        : Promise.resolve([]),
    ])
      .then(([f, assignments]) => {
        if (!f) {
          toast({ variant: "destructive", title: "Faculty record not found" });
          router.push("/hod/faculty");
          return;
        }
        setFaculty(f);
        setTeachingAssignments(assignments);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load faculty record" }))
      .finally(() => setIsLoading(false));
  }, [facultyId, moduleKey, moduleDef, router]);

  if (!moduleDef) {
    return <p className="text-sm text-muted-foreground">Unknown section.</p>;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={moduleDef.label}
        description={faculty?.name}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link href={`/hod/faculty/${facultyId}`}><ArrowLeft className="h-4 w-4 mr-2" />Back</Link>
            </Button>
            {moduleKey !== "research" && moduleKey !== "financial" && (
              <Button asChild>
                <Link href={`/hod/faculty/${facultyId}/${moduleKey}/edit`}><Pencil className="h-4 w-4 mr-2" />Edit</Link>
              </Button>
            )}
          </div>
        }
      />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : faculty ? (
        <FacultyProfileModuleContent moduleKey={moduleKey} faculty={faculty} teachingAssignments={teachingAssignments} collegeType={collegeType} />
      ) : null}
    </div>
  );
}
