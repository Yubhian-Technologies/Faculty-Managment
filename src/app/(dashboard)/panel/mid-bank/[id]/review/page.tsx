"use client";

import { use } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { BankReview } from "@/components/midBank/BankReview";

// Faculty: review a Mid question bank and download its PDF.
export default function MidBankReviewPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ download?: string }> }) {
  const { id } = use(params);
  const { download } = use(searchParams);
  const base = `/panel/mid-bank/${encodeURIComponent(id)}`;
  return (
    <div className="space-y-6">
      <PageHeader
        title="Review"
        description="Outstanding items, a full preview and, once complete, the PDF."
        actions={
          <Button asChild variant="ghost" size="sm"><Link href="/panel/mid-bank"><ArrowLeft className="mr-1.5 h-4 w-4" />All subjects</Link></Button>
        }
      />
      <BankReview id={id} editHref={(qid) => `${base}?q=${qid}`} writeHref={base} autoDownload={download === "1"} />
    </div>
  );
}
