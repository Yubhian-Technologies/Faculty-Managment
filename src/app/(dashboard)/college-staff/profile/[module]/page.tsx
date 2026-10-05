"use client";

import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Pencil } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { MyProfileModulePage } from "@/components/faculty/MyProfileModulePage";
import { SupportingStaffModuleContent } from "@/components/supportingStaff/SupportingStaffModuleContent";
import { SUPPORTING_STAFF_MODULES, type SupportingStaffModuleKey } from "@/lib/supportingStaff/profileModules";
import { supportingStaffDisplayName } from "@/lib/supportingStaff/supportingStaffDisplayName";
import { useOwnSupportingStaff } from "@/hooks/useOwnSupportingStaff";

// One section of a Supporting Staff member's own profile, read from their staff record (the same sections their
// HOD / College Office sees). A login with no linked staff record keeps the plain account sections it always had.
export default function CollegeStaffProfileModulePage() {
  const params = useParams<{ module: string }>();
  const moduleKey = params.module as SupportingStaffModuleKey;
  const moduleDef = SUPPORTING_STAFF_MODULES[moduleKey];
  const { staff, loading, message } = useOwnSupportingStaff();

  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!staff) return <MyProfileModulePage basePath="/college-staff/profile" />;
  if (!moduleDef) return <p className="text-sm text-muted-foreground">Unknown section.</p>;

  return (
    <div className="space-y-6">
      <PageHeader
        title={moduleDef.label}
        description={supportingStaffDisplayName(staff)}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" asChild>
              <Link href="/college-staff/profile"><ArrowLeft className="h-4 w-4 mr-2" />Back</Link>
            </Button>
            <Button asChild>
              <Link href={`/college-staff/profile/${moduleKey}/edit`}><Pencil className="h-4 w-4 mr-2" />Edit</Link>
            </Button>
          </div>
        }
      />
      {message && <p className="text-sm text-muted-foreground">{message}</p>}
      <SupportingStaffModuleContent moduleKey={moduleKey} staff={staff} />
    </div>
  );
}
