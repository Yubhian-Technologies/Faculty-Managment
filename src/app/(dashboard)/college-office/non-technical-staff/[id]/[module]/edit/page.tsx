"use client";

import { SupportingStaffModuleEditPage } from "@/components/supportingStaff/SupportingStaffModuleEditPage";
import { useAuthStore } from "@/store/authStore";

// Also mounted at /principal/staff/non-technical/[id]/[module]/edit
// (re-exported from there) - basePath picks the right destination for
// whichever route rendered this, same isCollegeLevel pattern as
// hod/faculty/new/page.tsx.
export default function NonTechnicalStaffModuleEditPage() {
  const user = useAuthStore((s) => s.user);
  const isCollegeLevel = user?.role === "PRINCIPAL" || user?.role === "VICE_PRINCIPAL";
  const isLibrary = user?.role === "LIBRARY";
  const basePath = isLibrary ? "/library/staff" : isCollegeLevel ? "/principal/staff/non-technical" : "/college-office/non-technical-staff";
  return <SupportingStaffModuleEditPage basePath={basePath} />;
}
