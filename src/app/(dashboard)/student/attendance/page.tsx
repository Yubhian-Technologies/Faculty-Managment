"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { StudentAttendanceReport } from "@/components/attendance/StudentAttendanceReport";

// "My Attendance" - the logged-in student's per-subject Held/Attended/% for a
// range they choose (Month / Period / Semester / Till now), loaded on demand
// with the Load Report button - same interaction as the faculty Attendance
// Report. All the work is in StudentAttendanceReport.
export default function StudentAttendancePage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-card/90 backdrop-blur-sm p-5 rounded-3xl border border-border/60 shadow-xs">
        <PageHeader title="My Attendance" description="Pick a view and press Load Report to see your attendance by subject" className="mb-0" />
        <Button asChild variant="outline" size="sm" className="rounded-full border-border/60">
          <Link href="/student">
            <ArrowLeft className="h-4 w-4 mr-1.5" /> Back to Dashboard
          </Link>
        </Button>
      </div>

      <StudentAttendanceReport />
    </div>
  );
}
