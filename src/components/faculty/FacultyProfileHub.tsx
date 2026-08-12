"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronRight, Pencil } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar } from "@/components/shared/Avatar";
import { AvatarUploadField } from "@/components/shared/AvatarUploadField";
import { getFacultyProfileModules, type ProfileModuleKey } from "@/lib/faculty/profileModules";
import { formatDate } from "@/lib/utils";
import { toast } from "@/hooks/useToast";
import { DESIGNATION_LABELS, FACULTY_STATUS_LABELS } from "@/types";
import type { FacultyMember, FacultyStatus } from "@/types";
import type { Timestamp } from "firebase/firestore";

const STATUS_VARIANTS: Record<FacultyStatus, "default" | "secondary" | "outline" | "destructive"> = {
  INTERVIEW_DONE: "outline",
  ACTIVE: "default",
  ON_LEAVE: "outline",
  RESIGNED: "secondary",
  RETIRED: "secondary",
};

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === undefined || value === null || value === "") return null;
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-sm font-medium">{value}</p>
    </div>
  );
}

interface FacultyProfileHubProps {
  // Also reused (see principal/staff/[uid]/page.tsx and its siblings) to view a
  // bare login account (HOD/Principal/VP/College Office/Dean/...) that has no
  // real FacultyMember record - those store Date of Joining as `dateOfJoining`
  // (FMSUser's own field name) rather than `joiningDate`, hence the extra field.
  faculty: Partial<FacultyMember> & { dateOfJoining?: Timestamp };
  basePath: string; // e.g. "/hod/faculty/abc123" - tiles link to "{basePath}/{moduleKey}"
  hideFinancialModule?: boolean;
  excludeModules?: ProfileModuleKey[];
  backHref?: string;
  editHref?: string;
  parentDeptName?: string | null; // shown as a badge next to Department when it's a sub-department
}

interface ProfileModuleTilesProps {
  basePath: string;
  hideFinancialModule?: boolean;
  excludeModules?: ProfileModuleKey[];
}

// Just the tile grid, no identity header - for self-profile pages (My Profile)
// that already render their own account-details card above it.
export function ProfileModuleTiles({ basePath, hideFinancialModule, excludeModules }: ProfileModuleTilesProps) {
  const modules = getFacultyProfileModules({ hideFinancialModule, excludeModules });
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {modules.map((m) => (
        <Link key={m.key} href={`${basePath}/${m.key}`}>
          <Card className="cursor-pointer hover:border-primary hover:shadow-md transition-all duration-200">
            <CardContent className="p-5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <m.icon className="h-5 w-5 text-primary" />
                </div>
                <p className="font-medium">{m.label}</p>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );
}

// Landing page for a faculty member's details: identity summary + one tile per
// module (Personal, Academic Qualification, Research, ...) instead of one long
// scrolling form - each tile routes to its own page (FacultyProfileModuleContent).
export function FacultyProfileHub({
  faculty, basePath, hideFinancialModule, excludeModules, backHref, editHref, parentDeptName,
}: FacultyProfileHubProps) {
  const designationLabel = faculty.designation ? (DESIGNATION_LABELS[faculty.designation] ?? faculty.designation) : undefined;
  const [photoUrl, setPhotoUrl] = useState(faculty.profilePhotoUrl);

  // AvatarUploadField only uploads to Storage - this persists the resulting URL
  // onto the faculty record itself (and, server-side, syncs it to their login
  // account if they have one - see PATCH /api/college/faculty/[id]).
  async function handlePhotoUploaded(url: string) {
    setPhotoUrl(url);
    if (!faculty.id) return;
    try {
      const res = await fetch(`/api/college/faculty/${faculty.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profilePhotoUrl: url }),
      });
      if (!res.ok) throw new Error();
    } catch {
      toast({ variant: "destructive", title: "Photo uploaded but failed to save - try again" });
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={faculty.name ?? "Faculty Member"}
        description={designationLabel}
        actions={
          <div className="flex gap-2">
            {backHref && (
              <Button variant="outline" asChild>
                <Link href={backHref}><ArrowLeft className="h-4 w-4 mr-2" />Back</Link>
              </Button>
            )}
            {editHref && (
              <Button asChild>
                <Link href={editHref}><Pencil className="h-4 w-4 mr-2" />Edit</Link>
              </Button>
            )}
          </div>
        }
      />

      <Card>
        <CardContent className="p-5 space-y-4">
          <div className="flex items-center gap-4 flex-wrap">
            {faculty.id ? (
              <AvatarUploadField
                name={faculty.name ?? "?"}
                photoUrl={photoUrl}
                targetId={faculty.id}
                onUploaded={handlePhotoUploaded}
                onDeleted={() => void handlePhotoUploaded("")}
              />
            ) : (
              <Avatar name={faculty.name ?? "?"} photoUrl={photoUrl} size="lg" />
            )}
            {faculty.status && <Badge variant={STATUS_VARIANTS[faculty.status] ?? "secondary"}>{FACULTY_STATUS_LABELS[faculty.status] ?? faculty.status}</Badge>}
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Fact label="Employee ID" value={faculty.employeeId} />
            <Fact label="Email" value={faculty.email} />
            <Fact label="College Email" value={faculty.collegeEmail} />
            <Fact label="Phone" value={faculty.phone} />
            <Fact
              label="Department"
              value={
                <span className="flex items-center gap-1.5">
                  {faculty.department}
                  {parentDeptName && <Badge variant="secondary" className="text-xs">Sub-department of {parentDeptName}</Badge>}
                </span>
              }
            />
            <Fact label="Designation" value={designationLabel} />
            <Fact
              label={faculty.status === "INTERVIEW_DONE" ? "Expected to Join" : "Date of Joining"}
              value={
                faculty.joiningDate ? formatDate(faculty.joiningDate)
                  : faculty.dateOfJoining ? formatDate(faculty.dateOfJoining)
                  : undefined
              }
            />
            <Fact label="Qualification" value={faculty.qualification} />
            <Fact label="Specialization" value={faculty.specialization} />
            <Fact label="Experience (yrs)" value={faculty.experienceYears} />
            <Fact label="APAAR Faculty ID" value={faculty.apaarFacultyId} />
          </div>
        </CardContent>
      </Card>

      <ProfileModuleTiles basePath={basePath} hideFinancialModule={hideFinancialModule} excludeModules={excludeModules} />
    </div>
  );
}

// Self-profile counterpart to ProfileModuleTiles - the account-details card on
// My Profile pages already shows identity.
export function MyProfileModuleTiles({ basePath }: { basePath: string }) {
  return <ProfileModuleTiles basePath={basePath} />;
}
