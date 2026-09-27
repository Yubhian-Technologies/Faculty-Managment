"use client";

import { GraduatedStudentsView } from "@/components/students/GraduatedStudentsView";

export default function OfficeGraduatesPage() {
  return <GraduatedStudentsView studentDetailHref={(id) => `/college-office/students/${id}`} />;
}
