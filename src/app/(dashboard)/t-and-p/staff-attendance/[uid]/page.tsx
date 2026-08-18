"use client";

import { useParams } from "next/navigation";
import { PersonMonthlyAttendanceView } from "@/components/attendance/PersonMonthlyAttendanceView";

export default function TAndPStaffMonthlyAttendancePage() {
  const { uid } = useParams<{ uid: string }>();
  return <PersonMonthlyAttendanceView facultyId={uid} backHref="/t-and-p/staff-attendance" />;
}
