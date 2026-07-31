"use client";

import Link from "next/link";
import { Pencil } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { ProfilePhotoUpload } from "@/components/shared/ProfilePhotoUpload";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MyProfileDetails } from "@/components/faculty/MyProfileDetails";
import { useAuth } from "@/hooks/useAuth";
import { ROLE_LABELS } from "@/types";

export default function HodProfilePage() {
  const { user } = useAuth();
  if (!user) return null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Profile"
        description="Manage your profile photo and account details"
        actions={
          <Button asChild size="sm" variant="outline">
            <Link href="/hod/profile/edit"><Pencil className="mr-2 h-4 w-4" />Edit Profile</Link>
          </Button>
        }
      />
      <Card>
        <CardContent className="p-6 space-y-6">
          <ProfilePhotoUpload name={user.name} photoUrl={user.profilePhotoUrl} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t">
            <div>
              <p className="text-xs text-muted-foreground">Name</p>
              <p className="text-sm font-medium">{user.name}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Email</p>
              <p className="text-sm font-medium">{user.email}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Role</p>
              <p className="text-sm font-medium">{ROLE_LABELS[user.role]}</p>
            </div>
            {user.department && (
              <div>
                <p className="text-xs text-muted-foreground">Department</p>
                <p className="text-sm font-medium">{user.department}</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <MyProfileDetails />
    </div>
  );
}
