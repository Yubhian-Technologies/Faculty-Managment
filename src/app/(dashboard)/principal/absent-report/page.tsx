"use client";
import { useOwnerRoleLabel } from "@/hooks/useOwnerRoleLabel";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionReportsView } from "@/components/attendance/SectionReportsView";
export default function PrincipalAbsentReportPage() {
  const who = useOwnerRoleLabel();
  return (
    <div className="space-y-6">
      <PageHeader title={`Absent Reports (${who})`} description="All sections — filter by section; same absent logic as HOD." />
      <SectionReportsView title={`Absent Report — ${who} (college-wide)`} />
    </div>
  );
}
