"use client";

import { PageHeader } from "@/components/shared/PageHeader";
import { SegmentedTabs } from "@/components/shared/SegmentedTabs";
import { StaffAccountsSection } from "@/components/staff/StaffAccountsSection";

export default function PrincipalFacultyStaffPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Faculty" description="Staff accounts (College Office, HOD, ...) for your college" />
      <SegmentedTabs
        value="staff"
        options={[
          { key: "faculty", label: "Teaching Staff", href: "/principal/faculty" },
          { key: "supporting", label: "Supporting Staff", href: "/principal/faculty/supporting-staff" },
          { key: "staff", label: "Staff", href: "/principal/faculty/staff" },
        ]}
      />
      <StaffAccountsSection />
    </div>
  );
}
