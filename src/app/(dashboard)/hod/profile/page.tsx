"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { ProfilePhotoUpload } from "@/components/shared/ProfilePhotoUpload";
import { ChangePasswordDialog } from "@/components/shared/ChangePasswordDialog";
import { Card, CardContent } from "@/components/ui/card";
import { MyProfileModuleTiles } from "@/components/faculty/FacultyProfileHub";
import { ProfileIdentitySummary } from "@/components/shared/ProfileIdentitySummary";
import { useAuth } from "@/hooks/useAuth";
import { useMyDepartments } from "@/hooks/useMyDepartments";
import type { Department } from "@/types";

export default function HodProfilePage() {
  const { user } = useAuth();
  const myDepartments = useMyDepartments();
  const [departments, setDepartments] = useState<Department[]>([]);

  useEffect(() => {
    fetch("/api/college/departments")
      .then((r) => r.json() as Promise<{ departments: Department[] }>)
      .then((d) => setDepartments(d.departments ?? []))
      .catch(() => {});
  }, []);

  // The "sub-department of X" badge only makes sense for a single owned
  // sub-department - an HOD running two or more departments just gets the
  // plain department list from ProfileIdentitySummary instead.
  const own = myDepartments.length === 1 ? departments.find((dept) => dept.name === myDepartments[0]) : undefined;
  const parent = own?.parentDepartmentId ? departments.find((dept) => dept.id === own.parentDepartmentId) : undefined;
  const parentDeptName = parent?.name ?? null;

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
