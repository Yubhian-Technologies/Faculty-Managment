"use client";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionReportsView } from "@/components/attendance/SectionReportsView";

export default function HodAbsentReportPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Absent Reports" description="Subject-wise and consolidated absentees: daily, monthly, for a period or to date." />
      <SectionReportsView title="Absent Report" />
    </div>
  );
}
