"use client";

import { QuestionBankOverview } from "@/components/midBank/QuestionBankOverview";

// Exam Cell > Mid Question Bank: every deadline, every branch.
export default function MidQuestionBankOverviewPage() {
  return <QuestionBankOverview base="/exam-cell/question-banks" examCell />;
}
