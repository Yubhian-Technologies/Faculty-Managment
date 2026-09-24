"use client";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionReportsView } from "@/components/attendance/SectionReportsView";

export default function HodAbsentReportPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Absent Reports" description="Subject-wise and consolidated absent students — daily, monthly, period, till now." />
      <SectionReportsView title="Absent Report" />
    </div>
  );
}
