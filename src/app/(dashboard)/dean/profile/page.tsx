"use client";

import { PageHeader } from "@/components/shared/PageHeader";
import { ProfilePhotoUpload } from "@/components/shared/ProfilePhotoUpload";
import { ChangePasswordDialog } from "@/components/shared/ChangePasswordDialog";
import { Card, CardContent } from "@/components/ui/card";
import { MyProfileModuleTiles } from "@/components/faculty/FacultyProfileHub";
import { ProfileIdentitySummary } from "@/components/shared/ProfileIdentitySummary";
import { useAuth } from "@/hooks/useAuth";

export default function DeanProfilePage() {
  const { user } = useAuth();
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
          <ProfileIdentitySummary user={user} />
        </CardContent>
      </Card>

      <MyProfileModuleTiles basePath="/dean/profile" />
    </div>
  );
}
