"use client";

import { useParams } from "next/navigation";
import { StudentDetailsPage } from "@/components/students/StudentDetailsPage";

export default function CollegeOfficeStudentDetailsPage() {
  const { studentId } = useParams<{ studentId: string }>();
  return <StudentDetailsPage studentId={studentId} backHref="/college-office/students" editable />;
}
