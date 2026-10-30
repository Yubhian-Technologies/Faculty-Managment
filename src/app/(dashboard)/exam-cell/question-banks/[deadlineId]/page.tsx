"use client";

import { use } from "react";
import { QuestionBankProgress } from "@/components/midBank/QuestionBankProgress";

// Exam Cell: one deadline's question banks, every branch, with HOD approval status.
export default function QuestionBankProgressPage({ params }: { params: Promise<{ deadlineId: string }> }) {
  const { deadlineId } = use(params);
  return <QuestionBankProgress deadlineId={deadlineId} base="/exam-cell/question-banks" examCell />;
}
