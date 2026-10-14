"use client";

import { PageHeader } from "@/components/shared/PageHeader";
import { Inbox } from "@/components/certifications/Inbox";

export default function HostelCertificateRequestsPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Certificate Requests" description="Students awaiting hostel fee clearance" />
      <Inbox />
    </div>
  );
}
