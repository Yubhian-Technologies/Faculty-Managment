"use client";

import { QuestionBankOverview } from "@/components/midBank/QuestionBankOverview";

// HOD > Mid Question Bank: the question bank deadlines, their own branches only.
export default function HodQuestionBanksPage() {
  return <QuestionBankOverview base="/hod/question-banks" examCell={false} />;
}
