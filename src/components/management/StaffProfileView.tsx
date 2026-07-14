"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ProfileFieldsView } from "@/components/faculty/ProfileFieldsView";
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
  const [profile, setProfile] = useState<(FMSUser & { academicProfile?: FacultyProfileFields }) | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const qs = new URLSearchParams({ role, ...(department ? { department } : {}) });
    fetch(`/api/management/colleges/${collegeId}/staff?${qs}`)
      .then((r) => r.json() as Promise<{ profile: (FMSUser & { academicProfile?: FacultyProfileFields }) | null }>)
      .then((d) => setProfile(d.profile))
      .finally(() => setIsLoading(false));
  }, [collegeId, role, department]);

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
          <Card>
            <CardHeader><CardTitle className="text-base">Identity</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div><p className="text-xs text-muted-foreground">Name</p><p className="text-sm font-medium">{profile.name}</p></div>
              <div><p className="text-xs text-muted-foreground">Email</p><p className="text-sm font-medium">{profile.email}</p></div>
              <div><p className="text-xs text-muted-foreground">Phone</p><p className="text-sm font-medium">{profile.phone || "—"}</p></div>
              <div><p className="text-xs text-muted-foreground">Employee ID</p><p className="text-sm font-medium">{profile.employeeId || "—"}</p></div>
              <div><p className="text-xs text-muted-foreground">Designation</p><p className="text-sm font-medium">{profile.designation || "—"}</p></div>
              <div><p className="text-xs text-muted-foreground">Department</p><p className="text-sm font-medium">{profile.department || "—"}</p></div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Academic Profile</CardTitle></CardHeader>
            <CardContent>
              <ProfileFieldsView profile={profile.academicProfile} includeTeachingAssignment={role === "HOD"} />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
