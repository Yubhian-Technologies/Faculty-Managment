"use client";

import { useParams } from "next/navigation";
import { PersonMonthlyAttendanceView } from "@/components/attendance/PersonMonthlyAttendanceView";

export default function CollegeOfficeStaffMonthlyAttendancePage() {
  const { uid } = useParams<{ uid: string }>();
  return <PersonMonthlyAttendanceView facultyId={uid} backHref="/college-office/staff-attendance" />;
}
