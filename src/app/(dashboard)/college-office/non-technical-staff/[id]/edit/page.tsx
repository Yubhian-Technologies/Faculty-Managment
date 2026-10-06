"use client";

import { useParams } from "next/navigation";
import { DesignationOptions } from "@/components/faculty/DesignationOptions";
import { SupportingStaffEditPage } from "@/components/supportingStaff/SupportingStaffEditPage";
import { useAuthStore } from "@/store/authStore";

// Account/employment fields plus every profile section, as tabs (same look as the Add wizard) - see
// SupportingStaffEditPage. The per-section pages ([id]/[module]/edit) still work for anyone who lands on them.
//
// Also mounted at /principal/staff/non-technical/[id]/edit and /library/staff/[id]/edit (both re-exported from
// there) - Principal/VP's merged Staff page has no per-record detail hub of its own, so their post-save/back
// destination is the list; College Office's and Library's each go to that record's own detail hub. All
// destinations are preserved exactly via isCollegeLevel/isLibrary, same pattern as hod/faculty/new/page.tsx.
export default function EditNonTechnicalStaffAccountPage() {
  const params = useParams<{ id: string }>();
  const staffId = params.id;
  const user = useAuthStore((s) => s.user);
  const isCollegeLevel = user?.role === "PRINCIPAL" || user?.role === "VICE_PRINCIPAL";
  const isLibrary = user?.role === "LIBRARY";
  const loadFailPath = isCollegeLevel ? "/principal/staff" : isLibrary ? "/library/staff" : "/college-office/non-technical-staff";
  const backHref = isCollegeLevel ? "/principal/staff" : isLibrary ? `/library/staff/${staffId}` : `/college-office/non-technical-staff/${staffId}`;
  const backLabel = isCollegeLevel ? "Back to Staff" : "Back to Profile";

  return (
    <SupportingStaffEditPage
      staffId={staffId}
      title="Edit Non-Technical Staff"
      loadFailPath={loadFailPath}
      backHref={backHref}
      backLabel={backLabel}
      afterSavePath={backHref}
      designationContent={<DesignationOptions kind="non-technical" />}
      departmentMode={isLibrary ? "library" : "select"}
      otherDesignationPlaceholder="e.g. Store Keeper"
    />
  );
}
