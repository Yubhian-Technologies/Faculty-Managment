"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Pencil } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { FacultyProfileModuleContent } from "@/components/faculty/FacultyProfileModuleContent";
import { facultyDisplayName } from "@/lib/faculty/facultyDisplayName";
import { PROFILE_MODULES, type ProfileModuleKey } from "@/lib/faculty/profileModules";
import { useCollegeType } from "@/hooks/useCollegeType";
import { toast } from "@/hooks/useToast";
import { resolveListBack, withListBack } from "@/lib/listReturn";
import type { FacultyMember, TeachingAssignment } from "@/types";

export default function HodFacultyModulePage() {
  const router = useRouter();
  const params = useParams<{ id: string; module: string }>();
  const facultyId = params.id;
  const moduleKey = params.module as ProfileModuleKey;
  const moduleDef = PROFILE_MODULES[moduleKey];
  const { collegeType } = useCollegeType();
  // The Faculty Register as this page was reached from (status tab, department).
  const listHref = resolveListBack(useSearchParams(), "/hod/faculty");

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
          router.push(listHref);
          return;
        }
        setFaculty(f);
        setTeachingAssignments(assignments);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load faculty record" }))
      .finally(() => setIsLoading(false));
  }, [facultyId, moduleKey, moduleDef, router, listHref]);

  if (!moduleDef) {
    return <p className="text-sm text-muted-foreground">Unknown section.</p>;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={moduleDef.label}
        description={facultyDisplayName(faculty)}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link href={withListBack(`/hod/faculty/${facultyId}`, listHref, "/hod/faculty")}><ArrowLeft className="h-4 w-4 mr-2" />Back</Link>
            </Button>
            {moduleKey !== "research" && moduleKey !== "financial" && (
              <Button asChild>
                <Link href={withListBack(`/hod/faculty/${facultyId}/${moduleKey}/edit`, listHref, "/hod/faculty")}><Pencil className="h-4 w-4 mr-2" />Edit</Link>
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
