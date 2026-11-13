"use client";
import { PageHeader } from "@/components/shared/PageHeader";
import { SectionReportsView } from "@/components/attendance/SectionReportsView";

export default function HodShortageReportPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Attendance Shortage Students" description="Students below the attendance threshold (75% by default), subject-wise or consolidated, daily, monthly, for a period or to date." />
      <SectionReportsView title="Shortage Report (default 75%)" />
    </div>
  );
}
