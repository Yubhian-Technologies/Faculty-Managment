"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Pencil } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { ProfilePhotoUpload } from "@/components/shared/ProfilePhotoUpload";
import { ChangePasswordDialog } from "@/components/shared/ChangePasswordDialog";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/useToast";
import { ROLE_LABELS } from "@/types";

interface Props {
  basePath: string;       // e.g. "/super-admin/profile"
  fetchEndpoint: string;  // "/api/admin/users/me" | "/api/location/users/me"
  photoEndpoint: string;  // "/api/admin/users/me/photo" | "/api/location/users/me/photo"
}

// Self-profile VIEW for GLOBAL/LOCATION-scoped roles, which have no academic
// module data (see src/lib/faculty/profileModules.ts) - so unlike
// MyProfileModuleTiles this is a single view+edit pair, not a module hub.
// Same principle either way: view first, then an explicit Edit step - never a
// directly-editable form.
export function MyAccountProfileView({ basePath, fetchEndpoint, photoEndpoint }: Props) {
  const { user } = useAuth();
  const [phone, setPhone] = useState<string | undefined>(undefined);
  // Only present for LOCATION-scoped roles - /api/location/users/me resolves
  // and returns both; /api/admin/users/me (GLOBAL roles) has neither, since a
  // Super Admin/Management/Finance/Purchase Dept user isn't tied to one
  // location, so both stay unset and their fields below stay hidden.
  const [department, setDepartment] = useState<string | undefined>(undefined);
  const [locationName, setLocationName] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(fetchEndpoint)
      .then((r) => r.json() as Promise<{ user?: { phone?: string; department?: string }; locationName?: string }>)
      .then((d) => {
        setPhone(d.user?.phone);
        setDepartment(d.user?.department);
        setLocationName(d.locationName);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load profile" }))
      .finally(() => setLoading(false));
  }, [fetchEndpoint]);

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
          <ProfilePhotoUpload name={user.name} photoUrl={user.profilePhotoUrl} endpoint={photoEndpoint} />
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
            {locationName && (
              <div>
                <p className="text-xs text-muted-foreground">Location</p>
                <p className="text-sm font-medium">{locationName}</p>
              </div>
            )}
            <div>
              <p className="text-xs text-muted-foreground">Phone</p>
              <p className="text-sm font-medium">{loading ? "…" : phone || "-"}</p>
            </div>
            {department && (
              <div>
                <p className="text-xs text-muted-foreground">Department</p>
                <p className="text-sm font-medium">{department}</p>
              </div>
            )}
          </div>
          <div className="flex justify-end pt-4 border-t">
            <Button asChild>
              <Link href={`${basePath}/edit`}>
                <Pencil className="h-4 w-4 mr-2" />
                Edit Details
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
