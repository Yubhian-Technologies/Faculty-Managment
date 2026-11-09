"use client";

import { use } from "react";
import { SyllabusEditor } from "@/components/syllabus/SyllabusEditor";

// HOD: prepare the syllabus of a subject their department looks after (Subject Department), submit it to Academics.
export default function SyllabusPage({ params }: { params: Promise<{ subjectId: string }> }) {
  const { subjectId } = use(params);
  return <SyllabusEditor subjectId={subjectId} backHref="/hod/subjects" backLabel="Subjects" />;
}
