"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { ArrowLeft, User, IdCard, GraduationCap } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/shared/SectionCard";
import { Avatar } from "@/components/shared/Avatar";
import { ProfileFieldsView } from "@/components/faculty/ProfileFieldsView";
import { PersonalDetailsView } from "@/components/shared/PersonalDetailsView";
import type { FMSUser, FacultyProfileFields, UserRole } from "@/types";

interface Props {
  collegeId: string;
  role: Extract<UserRole, "PRINCIPAL" | "VICE_PRINCIPAL" | "HOD">;
  title: string;
  department?: string;
  backHref: string;
}

export function StaffProfileView({ collegeId, role, title, department, backHref }: Props) {
  const router = useRouter();

  const { data: profile, isLoading } = useQuery({
    queryKey: ["mgmt-staff", collegeId, role, department],
    queryFn: () => {
      const qs = new URLSearchParams({ role, ...(department ? { department } : {}) });
      return fetch(`/api/management/colleges/${collegeId}/staff?${qs}`)
        .then((r) => r.json() as Promise<{ profile: (FMSUser & { academicProfile?: FacultyProfileFields }) | null }>)
        .then((d) => d.profile);
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title={title}
        description={profile?.name ?? "No profile on record"}
        actions={
          <Button variant="outline" onClick={() => router.push(backHref)}>
            <ArrowLeft className="h-4 w-4 mr-2" />Back
          </Button>
        }
      />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !profile ? (
        <p className="text-sm text-muted-foreground">No {title.toLowerCase()} is currently assigned.</p>
      ) : (
        <>
          <SectionCard icon={User} title="Identity" accent="blue">
            <div className="flex items-center gap-4 mb-4">
              <Avatar name={profile.name} photoUrl={profile.profilePhotoUrl} size="lg" />
            </div>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div><p className="text-xs text-muted-foreground">Name</p><p className="text-sm font-medium">{profile.name}</p></div>
              <div><p className="text-xs text-muted-foreground">Email</p><p className="text-sm font-medium">{profile.email}</p></div>
              <div><p className="text-xs text-muted-foreground">Phone</p><p className="text-sm font-medium">{profile.phone || "—"}</p></div>
              <div><p className="text-xs text-muted-foreground">Employee ID</p><p className="text-sm font-medium">{profile.employeeId || "—"}</p></div>
              <div><p className="text-xs text-muted-foreground">Designation</p><p className="text-sm font-medium">{profile.designation || "—"}</p></div>
              <div><p className="text-xs text-muted-foreground">Department</p><p className="text-sm font-medium">{profile.department || "—"}</p></div>
            </div>
          </SectionCard>

          <SectionCard icon={IdCard} title="Personal Details" accent="violet">
            <PersonalDetailsView value={profile} />
          </SectionCard>

          <SectionCard icon={GraduationCap} title="Academic Profile" accent="emerald">
            <ProfileFieldsView profile={profile.academicProfile} includeTeachingAssignment={role === "HOD"} />
          </SectionCard>
        </>
      )}
    </div>
  );
}
