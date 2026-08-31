"use client";

import { useEffect, useState } from "react";
import { Share2 } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { ProfilePhotoUpload } from "@/components/shared/ProfilePhotoUpload";
import { ChangePasswordDialog } from "@/components/shared/ChangePasswordDialog";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MyProfileModuleTiles } from "@/components/faculty/FacultyProfileHub";
import { ProfileIdentitySummary } from "@/components/shared/ProfileIdentitySummary";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/useToast";

export default function FacultyProfilePage() {
  const { user } = useAuth();
  const [employeeId, setEmployeeId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/college/faculty/me")
      .then((r) => r.json() as Promise<{ faculty: { employeeId?: string } | null }>)
      .then((d) => setEmployeeId(d.faculty?.employeeId ?? null))
      .catch(() => {});
  }, []);

  if (!user) return null;

  function copyPublicProfileLink() {
    if (!employeeId) return;
    void navigator.clipboard.writeText(`${window.location.origin}/faculty-public/facultyid=${encodeURIComponent(employeeId)}`);
    toast({ variant: "success", title: "Public profile link copied" });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Profile"
        description="Manage your profile photo and account details"
        actions={
          <div className="flex gap-2">
            <ChangePasswordDialog />
            {employeeId && (
              <Button variant="outline" onClick={copyPublicProfileLink}>
                <Share2 className="h-4 w-4 mr-2" />Copy Public Profile Link
              </Button>
            )}
          </div>
        }
      />
      <Card>
        <CardContent className="p-6 space-y-6">
          <ProfilePhotoUpload name={user.name} photoUrl={user.profilePhotoUrl} />
          <ProfileIdentitySummary user={user} />
        </CardContent>
      </Card>

      <MyProfileModuleTiles basePath="/panel/profile" />
    </div>
  );
}
