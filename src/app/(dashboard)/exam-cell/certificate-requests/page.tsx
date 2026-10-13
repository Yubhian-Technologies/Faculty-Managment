"use client";

import { PageHeader } from "@/components/shared/PageHeader";
import { ExamCellQueue } from "@/components/certifications/ExamCellQueue";

export default function ExamCellCertificateRequestsPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="PC & CMM Requests" description="Students awaiting Provisional Certificate and Consolidated Marks Memo" />
      <ExamCellQueue />
    </div>
  );
}
