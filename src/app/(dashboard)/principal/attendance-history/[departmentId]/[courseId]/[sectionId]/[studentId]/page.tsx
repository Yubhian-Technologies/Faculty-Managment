"use client";

import { useParams, useSearchParams } from "next/navigation";
import { StudentAttendanceHistoryReport } from "@/components/attendance/StudentAttendanceHistoryReport";

export default function PrincipalStudentAttendanceHistoryPage() {
  const { departmentId, courseId, sectionId, studentId } = useParams<{
    departmentId: string; courseId: string; sectionId: string; studentId: string;
  }>();
  const searchParams = useSearchParams();
  const name = searchParams.get("name") || "Student";
  const deptLabel = searchParams.get("deptLabel") || "";
  const courseLabel = searchParams.get("courseLabel") || "";
  const sectionLabel = searchParams.get("sectionLabel") || "";

  const backHref = `/principal/attendance-history/${departmentId}/${courseId}/${sectionId}`
    + `?deptLabel=${encodeURIComponent(deptLabel)}&courseLabel=${encodeURIComponent(courseLabel)}&sectionLabel=${encodeURIComponent(sectionLabel)}`;

  return <StudentAttendanceHistoryReport studentId={studentId} studentName={name} backHref={backHref} />;
}
