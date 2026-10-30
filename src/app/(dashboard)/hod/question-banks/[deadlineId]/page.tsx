"use client";

import { use } from "react";
import { QuestionBankProgress } from "@/components/midBank/QuestionBankProgress";

// HOD: one deadline's question banks in their branches - who is preparing each,
// how far, and the ones waiting for their approval.
export default function HodQuestionBankProgressPage({ params }: { params: Promise<{ deadlineId: string }> }) {
  const { deadlineId } = use(params);
  return <QuestionBankProgress deadlineId={deadlineId} base="/hod/question-banks" examCell={false} />;
}
