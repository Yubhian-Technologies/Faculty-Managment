"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, User, IdCard, GraduationCap, BookOpen } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SectionCard } from "@/components/shared/SectionCard";
import { ProfileFieldsView } from "@/components/faculty/ProfileFieldsView";
import { PersonalDetailsView } from "@/components/shared/PersonalDetailsView";
import { TeachingLoadTable } from "@/components/faculty/TeachingLoadTable";
import { Avatar } from "@/components/shared/Avatar";
import { DESIGNATION_LABELS } from "@/types";
import type { Department, FacultyMember, TeachingAssignment, College, ResearchPublication } from "@/types";
import { buildTeachingLoadRows } from "@/lib/teaching/buildTeachingLoadRows";
import { formatDate } from "@/lib/utils";

export default function ManagementFacultyDetailPage() {
  const router = useRouter();
  const { collegeId, deptId, facultyId } = useParams<{ collegeId: string; deptId: string; facultyId: string }>();

  const { data, isLoading } = useQuery({
    queryKey: ["mgmt-faculty", collegeId, deptId, facultyId],
    queryFn: () =>
      fetch(`/api/management/colleges/${collegeId}/departments/${deptId}/faculty/${facultyId}`)
        .then((r) => r.json() as Promise<{ faculty: FacultyMember; teachingAssignments: TeachingAssignment[]; publications?: ResearchPublication[] }>),
  });

  const faculty = data?.faculty ?? null;
  const teachingAssignments = data?.teachingAssignments ?? [];
  const publications = data?.publications;

  const { data: collegeData } = useQuery({
    queryKey: ["mgmt-college-type", collegeId],
    queryFn: () =>
      fetch(`/api/management/colleges/${collegeId}`)
        .then((r) => r.json() as Promise<{ college?: College }>),
  });
  const collegeType = collegeData?.college?.type;

  const { data: departments } = useQuery({
    queryKey: ["mgmt-departments-for-hierarchy", collegeId],
    queryFn: () =>
      fetch(`/api/management/colleges/${collegeId}/departments`)
        .then((r) => r.json() as Promise<{ departments: Department[] }>)
        .then((d) => d.departments ?? []),
  });
  const parentDeptName = (() => {
    const dept = departments?.find((d) => d.name === faculty?.department);
    if (!dept?.parentDepartmentId) return null;
    return departments?.find((d) => d.id === dept.parentDepartmentId)?.name ?? null;
  })();

  return (
    <div className="space-y-6">
      <PageHeader
        title={faculty?.name ?? "Faculty Member"}
        description={faculty ? DESIGNATION_LABELS[faculty.designation] ?? faculty.designation : undefined}
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
            <div className="flex items-center gap-4 mb-4">
              <Avatar name={faculty.name} photoUrl={faculty.profilePhotoUrl} size="lg" />
            </div>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div><p className="text-xs text-muted-foreground">Employee ID</p><p className="text-sm font-medium">{faculty.employeeId}</p></div>
              <div><p className="text-xs text-muted-foreground">Email</p><p className="text-sm font-medium">{faculty.email}</p></div>
              <div><p className="text-xs text-muted-foreground">Phone</p><p className="text-sm font-medium">{faculty.phone || "-"}</p></div>
              <div>
                <p className="text-xs text-muted-foreground">Department</p>
                <p className="text-sm font-medium flex items-center gap-1.5">
                  {faculty.department}
                  {parentDeptName && <Badge variant="secondary" className="text-xs">Sub-department of {parentDeptName}</Badge>}
                </p>
              </div>
              <div><p className="text-xs text-muted-foreground">Designation</p><p className="text-sm font-medium">{DESIGNATION_LABELS[faculty.designation] ?? faculty.designation}</p></div>
              <div><p className="text-xs text-muted-foreground">Date of Joining</p><p className="text-sm font-medium">{faculty.joiningDate ? formatDate(faculty.joiningDate) : "-"}</p></div>
              <div><p className="text-xs text-muted-foreground">Qualification</p><p className="text-sm font-medium">{faculty.qualification || "-"}</p></div>
              <div><p className="text-xs text-muted-foreground">Specialization</p><p className="text-sm font-medium">{faculty.specialization || "-"}</p></div>
              <div><p className="text-xs text-muted-foreground">Experience (yrs)</p><p className="text-sm font-medium">{faculty.experienceYears}</p></div>
              <div><p className="text-xs text-muted-foreground">APAAR Faculty ID</p><p className="text-sm font-medium">{faculty.apaarFacultyId || "-"}</p></div>
              <div><p className="text-xs text-muted-foreground">Date of Joining Department</p><p className="text-sm font-medium">{faculty.dateOfJoiningDepartment ? formatDate(faculty.dateOfJoiningDepartment) : "-"}</p></div>
              <div><p className="text-xs text-muted-foreground">AICTE Eligible</p><p className="text-sm font-medium">{faculty.aicteEligible ? "Yes" : "No"}</p></div>
            </div>
          </SectionCard>

          <SectionCard icon={IdCard} title="Personal Details" accent="violet">
            <PersonalDetailsView value={faculty} />
          </SectionCard>

          <SectionCard icon={GraduationCap} title="Academic Profile" accent="emerald">
            <ProfileFieldsView profile={faculty.academicProfile} includeTeachingAssignment collegeType={collegeType} publications={publications} />
          </SectionCard>

          <SectionCard icon={BookOpen} title="Teaching Load" accent="amber">
            <TeachingLoadTable
              groups={buildTeachingLoadRows({
                currentAssignments: teachingAssignments,
                staticCourses: faculty.academicProfile?.teachingAssignment?.courses,
                department: faculty.department,
              })}
            />
          </SectionCard>
        </>
      )}
    </div>
  );
}
