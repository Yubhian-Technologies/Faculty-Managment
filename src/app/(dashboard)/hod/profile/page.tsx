"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { ProfilePhotoUpload } from "@/components/shared/ProfilePhotoUpload";
import { ChangePasswordDialog } from "@/components/shared/ChangePasswordDialog";
import { Card, CardContent } from "@/components/ui/card";
import { MyProfileModuleTiles } from "@/components/faculty/FacultyProfileHub";
import { ProfileIdentitySummary } from "@/components/shared/ProfileIdentitySummary";
import { useAuth } from "@/hooks/useAuth";
import type { Department } from "@/types";

export default function HodProfilePage() {
  const { user } = useAuth();
  const [parentDeptName, setParentDeptName] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.department) return;
    fetch("/api/college/departments")
      .then((r) => r.json() as Promise<{ departments: Department[] }>)
      .then((d) => {
        const departments = d.departments ?? [];
        const own = departments.find((dept) => dept.name === user.department);
        const parent = own?.parentDepartmentId ? departments.find((dept) => dept.id === own.parentDepartmentId) : null;
        setParentDeptName(parent?.name ?? null);
      })
      .catch(() => {});
  }, [user?.department]);

  if (!user) return null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Profile"
        description="Manage your profile photo and account details"
        actions={<ChangePasswordDialog />}
      />
      <Card>
        <CardContent className="p-6 space-y-6">
          <ProfilePhotoUpload name={user.name} photoUrl={user.profilePhotoUrl} />
          <ProfileIdentitySummary
            user={user}
            departmentBadge={parentDeptName ? `Sub-department of ${parentDeptName}` : undefined}
          />
        </CardContent>
      </Card>

      <MyProfileModuleTiles basePath="/hod/profile" />
    </div>
  );
}
