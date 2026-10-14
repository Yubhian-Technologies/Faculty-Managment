"use client";

import { PageHeader } from "@/components/shared/PageHeader";
import { Inbox } from "@/components/certifications/Inbox";
import { IssuanceQueue } from "@/components/certifications/IssuanceQueue";

export default function CollegeOfficeCertificatesPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Certificate Issuance" description="Fee verification and final issuance" />
      <div>
        <h2 className="font-semibold mb-3">Fee Verification</h2>
        <Inbox />
      </div>
      <div>
        <h2 className="font-semibold mb-3">Ready to Issue</h2>
        <IssuanceQueue />
      </div>
    </div>
  );
}
