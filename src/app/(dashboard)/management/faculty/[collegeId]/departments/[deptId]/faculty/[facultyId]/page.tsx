"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, User, IdCard, GraduationCap } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/shared/SectionCard";
import { ProfileFieldsView } from "@/components/faculty/ProfileFieldsView";
import { PersonalDetailsView } from "@/components/shared/PersonalDetailsView";
import { DESIGNATION_LABELS } from "@/types";
import type { FacultyMember } from "@/types";

export default function ManagementFacultyDetailPage() {
  const router = useRouter();
  const { collegeId, deptId, facultyId } = useParams<{ collegeId: string; deptId: string; facultyId: string }>();

  const { data: faculty, isLoading } = useQuery({
    queryKey: ["mgmt-faculty", collegeId, deptId, facultyId],
    queryFn: () =>
      fetch(`/api/management/colleges/${collegeId}/departments/${deptId}/faculty/${facultyId}`)
        .then((r) => r.json() as Promise<{ faculty: FacultyMember }>)
        .then((d) => d.faculty ?? null),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title={faculty?.name ?? "Faculty Member"}
        description={faculty ? DESIGNATION_LABELS[faculty.designation] : undefined}
        actions={
          <Button variant="outline" onClick={() => router.push(`/management/faculty/${collegeId}/departments/${deptId}`)}>
            <ArrowLeft className="h-4 w-4 mr-2" />Back
          </Button>
        }
      />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !faculty ? (
        <p className="text-sm text-muted-foreground">Faculty record not found.</p>
      ) : (
        <>
          <SectionCard icon={User} title="Identity" accent="blue">
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div><p className="text-xs text-muted-foreground">Employee ID</p><p className="text-sm font-medium">{faculty.employeeId}</p></div>
              <div><p className="text-xs text-muted-foreground">Email</p><p className="text-sm font-medium">{faculty.email}</p></div>
              <div><p className="text-xs text-muted-foreground">Phone</p><p className="text-sm font-medium">{faculty.phone || "—"}</p></div>
              <div><p className="text-xs text-muted-foreground">Department</p><p className="text-sm font-medium">{faculty.department}</p></div>
              <div><p className="text-xs text-muted-foreground">Designation</p><p className="text-sm font-medium">{DESIGNATION_LABELS[faculty.designation]}</p></div>
              <div><p className="text-xs text-muted-foreground">Qualification</p><p className="text-sm font-medium">{faculty.qualification || "—"}</p></div>
              <div><p className="text-xs text-muted-foreground">Specialization</p><p className="text-sm font-medium">{faculty.specialization || "—"}</p></div>
              <div><p className="text-xs text-muted-foreground">Experience (yrs)</p><p className="text-sm font-medium">{faculty.experienceYears}</p></div>
            </div>
          </SectionCard>

          <SectionCard icon={IdCard} title="Personal Details" accent="violet">
            <PersonalDetailsView value={faculty} />
          </SectionCard>

          <SectionCard icon={GraduationCap} title="Academic Profile" accent="emerald">
            <ProfileFieldsView profile={faculty.academicProfile} includeTeachingAssignment />
          </SectionCard>
        </>
      )}
    </div>
  );
}
