"use client";

import { PageHeader } from "@/components/shared/PageHeader";
import { Inbox } from "@/components/certifications/Inbox";

export default function PdCertificateRequestsPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Certificate Requests" description="Students awaiting sports kit/equipment clearance" />
      <Inbox />
    </div>
  );
}
