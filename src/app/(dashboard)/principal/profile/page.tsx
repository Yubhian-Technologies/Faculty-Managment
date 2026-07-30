"use client";

import { useRouter } from "next/navigation";
import { Pencil, IdCard, GraduationCap } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { ProfilePhotoUpload } from "@/components/shared/ProfilePhotoUpload";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/shared/SectionCard";
import { PersonalDetailsView } from "@/components/shared/PersonalDetailsView";
import { ProfileFieldsView } from "@/components/faculty/ProfileFieldsView";
import { useAuth } from "@/hooks/useAuth";
import { ROLE_LABELS } from "@/types";

export default function PrincipalProfilePage() {
  const router = useRouter();
  const { user } = useAuth();
  if (!user) return null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Profile"
        description="Manage your profile photo and account details"
        actions={
          <Button variant="outline" onClick={() => router.push("/principal/profile/edit")}>
            <Pencil className="h-4 w-4 mr-2" />Edit
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
            {user.designation && (
              <div>
                <p className="text-xs text-muted-foreground">Designation</p>
                <p className="text-sm font-medium">{user.designation}</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <SectionCard icon={IdCard} title="Personal Details" accent="violet">
        <PersonalDetailsView value={user} />
      </SectionCard>

      <SectionCard icon={GraduationCap} title="Academic Profile" accent="emerald">
        <ProfileFieldsView profile={user.academicProfile} includeTeachingAssignment={false} hideFinancialModule />
      </SectionCard>
    </div>
  );
}
