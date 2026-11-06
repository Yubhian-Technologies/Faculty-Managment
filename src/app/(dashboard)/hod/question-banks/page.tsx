"use client";

import { QuestionBankOverview } from "@/components/midBank/QuestionBankOverview";
import { DepartmentSubjectsCard } from "@/components/midBank/DepartmentSubjectsCard";

// HOD > Mid Question Bank: the question bank deadlines, their own branches only (plus the subjects
// their department looks after in other branches), and those subjects' syllabus.
export default function HodQuestionBanksPage() {
  return (
    <div className="space-y-6">
      <QuestionBankOverview base="/hod/question-banks" examCell={false} />
      <DepartmentSubjectsCard />
    </div>
  );
}
