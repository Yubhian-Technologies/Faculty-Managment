"use client";

import { PageHeader } from "@/components/shared/PageHeader";
import { ProfilePhotoUpload } from "@/components/shared/ProfilePhotoUpload";
import { ChangePasswordDialog } from "@/components/shared/ChangePasswordDialog";
import { PublicProfileLinkButton } from "@/components/shared/PublicProfileLinkButton";
import { Card, CardContent } from "@/components/ui/card";
import { ProfileModuleTiles } from "@/components/faculty/FacultyProfileHub";
import { ProfileIdentitySummary } from "@/components/shared/ProfileIdentitySummary";
import { useAuth } from "@/hooks/useAuth";

// College Admin has no nav entry into this page at all (see navConfig.ts's
// My Profile item) - it's a role-login, not one continuous employee, so its
// Name/Phone/password live in CollegeAdminAccountMenu off the sidebar's
// account row instead. This page is Principal/VP only.
export default function PrincipalProfilePage() {
  const { user } = useAuth();
  if (!user) return null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Profile"
        description="Manage your profile photo and account details"
        actions={
          <div className="flex gap-2">
            <ChangePasswordDialog />
            <PublicProfileLinkButton />
          </div>
        }
      />
      <Card>
        <CardContent className="p-6 space-y-6">
          <ProfilePhotoUpload name={user.name} photoUrl={user.profilePhotoUrl} />
          <ProfileIdentitySummary user={user} designation={user.designation} />
        </CardContent>
      </Card>

      <ProfileModuleTiles
        basePath="/principal/profile"
        hideFinancialModule
        excludeModules={["teaching-load"]}
      />
    </div>
  );
}
