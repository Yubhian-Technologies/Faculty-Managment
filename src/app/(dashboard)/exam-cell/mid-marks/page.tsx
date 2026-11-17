"use client";

import { MidMarksOverview } from "@/components/exams/MidMarksOverview";
import { PageHeader } from "@/components/shared/PageHeader";

export default function ExamCellMidMarksPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Mid Marks"
        description="Each subject's Mid marks per branch: who enters them, and the questions they are entered against."
      />
      <MidMarksOverview />
    </div>
  );
}
