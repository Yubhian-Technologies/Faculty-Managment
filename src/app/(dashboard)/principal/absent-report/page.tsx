"use client";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionReportsView } from "@/components/attendance/SectionReportsView";
export default function PrincipalAbsentReportPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Absent Reports (Principal)" description="All sections — filter by section; same absent logic as HOD." />
      <SectionReportsView title="Absent Report — Principal (college-wide)" />
    </div>
  );
}
