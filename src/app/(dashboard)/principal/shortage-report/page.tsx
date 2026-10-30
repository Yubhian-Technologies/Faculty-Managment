"use client";
import { useOwnerRoleLabel } from "@/hooks/useOwnerRoleLabel";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionReportsView } from "@/components/attendance/SectionReportsView";
export default function PrincipalShortageReportPage() {
  const who = useOwnerRoleLabel();
  return (
    <div className="space-y-6">
      <PageHeader title={`Shortage Reports (${who})`} description="Students below threshold — college-wide." />
      <SectionReportsView title={`Shortage Report — ${who}`} />
    </div>
  );
}
