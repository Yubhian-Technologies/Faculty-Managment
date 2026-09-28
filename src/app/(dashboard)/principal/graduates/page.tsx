"use client";

import { GraduatedStudentsView } from "@/components/students/GraduatedStudentsView";

export default function PrincipalGraduatesPage() {
  return <GraduatedStudentsView studentDetailHref={(id) => `/principal/students/${id}`} />;
}
