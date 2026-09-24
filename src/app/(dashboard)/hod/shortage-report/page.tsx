"use client";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionReportsView } from "@/components/attendance/SectionReportsView";

export default function HodShortageReportPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Attendance Shortage Students" description="Students below threshold — subject-wise or consolidated, daily/monthly/period/till now. Default 75%." />
      <SectionReportsView title="Shortage Report (default 75%)" />
    </div>
  );
}
