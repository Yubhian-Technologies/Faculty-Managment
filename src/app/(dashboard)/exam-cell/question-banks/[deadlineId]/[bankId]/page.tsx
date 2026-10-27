"use client";

import { use } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { BankReview } from "@/components/midBank/BankReview";

// Exam Cell: one faculty member's question bank, read-only, with its PDF.
export default function ExamCellBankPage({ params }: { params: Promise<{ deadlineId: string; bankId: string }> }) {
  const { deadlineId, bankId } = use(params);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Question bank"
        description="Read-only: progress, outstanding issues and a full preview. The PDF is available once every unit is complete."
        actions={<Button asChild variant="ghost" size="sm"><Link href={`/exam-cell/question-banks/${encodeURIComponent(deadlineId)}`}><ArrowLeft className="mr-1.5 h-4 w-4" />Progress</Link></Button>}
      />
      <BankReview id={bankId} />
    </div>
  );
}
