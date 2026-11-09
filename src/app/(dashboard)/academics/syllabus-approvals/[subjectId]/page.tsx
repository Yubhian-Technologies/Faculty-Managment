"use client";

import { use } from "react";
import { SyllabusEditor } from "@/components/syllabus/SyllabusEditor";

// Academics (Dean Academics): freeze or return a submitted syllabus; once frozen, edit it (every change recorded).
export default function SyllabusPage({ params }: { params: Promise<{ subjectId: string }> }) {
  const { subjectId } = use(params);
  return <SyllabusEditor subjectId={subjectId} backHref="/academics/syllabus-approvals" backLabel="Syllabus approvals" />;
}
