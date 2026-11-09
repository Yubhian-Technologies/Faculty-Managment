"use client";

import { use, useState } from "react";
import { QuestionBankProgress } from "@/components/midBank/QuestionBankProgress";
import { AssignSetters } from "@/components/midBank/AssignSetters";

// HOD: one deadline's question banks in their branches - who is preparing each,
// how far, and the ones waiting for their approval. In a college where the HOD
// assigns the setters, assigning them comes first.
export default function HodQuestionBankProgressPage({ params }: { params: Promise<{ deadlineId: string }> }) {
  const { deadlineId } = use(params);
  // A saved assignment shows in the progress below at once (it re-reads).
  const [progressKey, setProgressKey] = useState(0);
  return (
    <div className="space-y-6">
      <AssignSetters deadlineId={deadlineId} onChanged={() => setProgressKey((k) => k + 1)} />
      <QuestionBankProgress key={progressKey} deadlineId={deadlineId} base="/hod/question-banks" examCell={false} />
    </div>
  );
}
