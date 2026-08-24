"use client";

import { useParams } from "next/navigation";
import { StudentDetailsPage } from "@/components/students/StudentDetailsPage";

export default function HodStudentDetailsPage() {
  const { studentId } = useParams<{ studentId: string }>();
  return <StudentDetailsPage studentId={studentId} backHref="/hod/students" />;
}
