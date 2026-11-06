"use client";

import { use } from "react";
import { QuestionBankProgress } from "@/components/midBank/QuestionBankProgress";
import { AssignSetters } from "@/components/midBank/AssignSetters";

// HOD: one deadline's question banks in their branches - who is preparing each,
// how far, and the ones waiting for their approval. In a college where the HOD
// assigns the setters, assigning them comes first.
export default function HodQuestionBankProgressPage({ params }: { params: Promise<{ deadlineId: string }> }) {
  const { deadlineId } = use(params);
  return (
    <div className="space-y-6">
      <AssignSetters deadlineId={deadlineId} />
      <QuestionBankProgress deadlineId={deadlineId} base="/hod/question-banks" examCell={false} />
    </div>
  );
}
