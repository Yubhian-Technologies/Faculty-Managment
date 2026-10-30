"use client";

import { use } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { BankReview } from "@/components/midBank/BankReview";

// HOD: one question bank of their branch - read it, then approve it or return it.
export default function HodBankPage({ params }: { params: Promise<{ deadlineId: string; bankId: string }> }) {
  const { deadlineId, bankId } = use(params);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Question bank"
        description="Review every question, then approve it (it goes to the Exam Cell) or return it to the faculty with remarks."
        actions={<Button asChild variant="ghost" size="sm"><Link href={`/hod/question-banks/${encodeURIComponent(deadlineId)}`}><ArrowLeft className="mr-1.5 h-4 w-4" />Progress</Link></Button>}
      />
      <BankReview id={bankId} />
    </div>
  );
}
