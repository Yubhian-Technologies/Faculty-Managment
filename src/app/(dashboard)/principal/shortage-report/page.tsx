"use client";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionReportsView } from "@/components/attendance/SectionReportsView";
export default function PrincipalShortageReportPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Shortage Reports (Principal)" description="Students below threshold — college-wide." />
      <SectionReportsView title="Shortage Report — Principal" />
    </div>
  );
}
