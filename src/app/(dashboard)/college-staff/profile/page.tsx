"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { Pencil } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { ProfilePhotoUpload } from "@/components/shared/ProfilePhotoUpload";
import { ChangePasswordDialog } from "@/components/shared/ChangePasswordDialog";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MyProfileModuleTiles } from "@/components/faculty/FacultyProfileHub";
import { ProfileIdentitySummary } from "@/components/shared/ProfileIdentitySummary";
import { SupportingStaffIdentityFacts, SupportingStaffModuleTiles, SupportingStaffStatusBadge } from "@/components/supportingStaff/SupportingStaffSelfProfile";
import { supportingStaffDisplayName } from "@/lib/supportingStaff/supportingStaffDisplayName";
import { useAuth } from "@/hooks/useAuth";
import { useAuthStore } from "@/store/authStore";
import { useOwnSupportingStaff } from "@/hooks/useOwnSupportingStaff";
import { MyResumeDownloadButton } from "@/components/faculty/MyResumeDownloadButton";

// A Supporting Staff member's own My Profile - laid out like a faculty member's (/panel/profile): photo + status,
// the Identity & Employment facts from their staff record, Edit Details, and a tile per profile section. A login that
// isn't linked to a staff record keeps the plain account view this page always had.
export default function CollegeStaffProfilePage() {
  const { user } = useAuth();
  const setUser = useAuthStore((s) => s.setUser);
  const { staff, loading, message, reload } = useOwnSupportingStaff();

  // The record is the source of truth for the photo. The login (and the cached copy in this browser) is only a
  // mirror, so a photo set by the HOD / College Office on the record is brought into the avatar once, on arrival.
  const syncedFromRecord = useRef(false);
  useEffect(() => {
    if (syncedFromRecord.current || !staff || !user) return;
    syncedFromRecord.current = true;
    const recordPhoto = staff.profilePhotoUrl || undefined;
    if (recordPhoto !== (user.profilePhotoUrl || undefined)) setUser({ ...user, profilePhotoUrl: recordPhoto });
  }, [staff, user, setUser]);

  // After this person uploads / removes their own photo the record has changed too - show what is stored.
  const storePhoto = user?.profilePhotoUrl;
  useEffect(() => {
    if (syncedFromRecord.current) void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storePhoto]);

  if (!user) return null;

  if (loading) {
    return (
      <div className="space-y-6">
        <PageHeader title="My Profile" description="Loading…" />
      </div>
    );
  }

  // No linked staff record: the account-only view, exactly as before.
  if (!staff) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="My Profile"
          description="Manage your profile photo and account details"
          actions={<div className="flex gap-2"><MyResumeDownloadButton /><ChangePasswordDialog /></div>}
        />
        {message && <p className="text-sm text-muted-foreground rounded-md border bg-muted/20 p-3">{message}</p>}
        <Card>
          <CardContent className="p-6 space-y-6">
            <ProfilePhotoUpload name={user.name} photoUrl={user.profilePhotoUrl} />
            <ProfileIdentitySummary user={user} />
          </CardContent>
        </Card>

        <MyProfileModuleTiles basePath="/college-staff/profile" />
      </div>
    );
  }

  const displayName = supportingStaffDisplayName(staff) || user.name;

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Profile"
        description="Manage your profile photo and account details"
        actions={<div className="flex gap-2"><MyResumeDownloadButton /><ChangePasswordDialog /></div>}
      />
      <Card>
        <CardContent className="p-6 space-y-6">
          <div className="flex items-center gap-4 flex-wrap">
            <ProfilePhotoUpload name={displayName} photoUrl={staff.profilePhotoUrl || undefined} />
            <SupportingStaffStatusBadge status={staff.status} />
          </div>
          <SupportingStaffIdentityFacts staff={staff} />
          <div className="flex justify-end pt-4 border-t">
            <Button asChild>
              <Link href="/college-staff/profile/edit"><Pencil className="h-4 w-4 mr-2" />Edit Details</Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      <SupportingStaffModuleTiles basePath="/college-staff/profile" />
    </div>
  );
}
