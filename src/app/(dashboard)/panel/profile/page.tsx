"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Pencil, Share2 } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { ProfilePhotoUpload } from "@/components/shared/ProfilePhotoUpload";
import { ChangePasswordDialog } from "@/components/shared/ChangePasswordDialog";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { MyProfileModuleTiles, FacultyIdentityFacts, FacultyStatusBadge } from "@/components/faculty/FacultyProfileHub";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "@/hooks/useToast";
import type { FacultyMember } from "@/types";

export default function FacultyProfilePage() {
  const { user } = useAuth();
  // The faculty member's own FacultyMember record - see the doc-comment on
  // GET /api/college/faculty/me. Drives the same fields grid the HOD sees on
  // this faculty member's detail page (hod/faculty/[id]).
  const [faculty, setFaculty] = useState<Partial<FacultyMember> | null>(null);
  // Set when this login has no linked faculty record (see GET /api/college/faculty/me).
  const [noRecordMessage, setNoRecordMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/college/faculty/me")
      .then((r) => r.json() as Promise<{ faculty: Partial<FacultyMember> | null; message?: string }>)
      .then((d) => {
        setFaculty(d.faculty ?? null);
        setNoRecordMessage(d.faculty ? null : (d.message ?? null));
      })
      .catch(() => {});
  }, []);

  if (!user) return null;

  const employeeId = faculty?.employeeId ?? null;

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
          <div className="flex items-center gap-4 flex-wrap">
            <ProfilePhotoUpload name={user.name} photoUrl={user.profilePhotoUrl} />
            <FacultyStatusBadge status={faculty?.status} />
          </div>
          {/* Same fields grid the HOD sees on this faculty member's own
              detail page (hod/faculty/[id]) - so "My Profile" never lags
              behind what the HOD can already see about them. */}
          {noRecordMessage && <p className="text-sm text-muted-foreground rounded-md border bg-muted/20 p-3">{noRecordMessage}</p>}
          <FacultyIdentityFacts faculty={faculty ?? {}} />
          {faculty && (
            <div className="flex justify-end pt-4 border-t">
              <Button asChild>
                <Link href="/panel/profile/edit"><Pencil className="h-4 w-4 mr-2" />Edit Details</Link>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <MyProfileModuleTiles basePath="/panel/profile" />
    </div>
  );
}
