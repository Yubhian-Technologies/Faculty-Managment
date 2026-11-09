"use client";

import { use } from "react";
import { SyllabusEditor } from "@/components/syllabus/SyllabusEditor";

// Faculty: read a subject's syllabus (units, COs, CO-PO mapping) and its change history.
export default function SyllabusPage({ params }: { params: Promise<{ subjectId: string }> }) {
  const { subjectId } = use(params);
  return <SyllabusEditor subjectId={subjectId} backHref="/panel/mid-bank" backLabel="Mid Question Bank" />;
}
