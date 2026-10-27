"use client";

import { use } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { BankReview } from "@/components/midBank/BankReview";

// HOD: a read-only look at a Mid question bank of the department, with its PDF.
export default function HodMidBankPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Mid question bank"
        description="Read-only: progress, outstanding issues and a full preview. The PDF is available once every unit is complete."
        actions={<Button asChild variant="ghost" size="sm"><Link href="/hod/mid-paper-setter"><ArrowLeft className="mr-1.5 h-4 w-4" />Mid Paper Setter</Link></Button>}
      />
      <BankReview id={id} />
    </div>
  );
}
