"use client";

import { PageHeader } from "@/components/shared/PageHeader";
import { DepartmentOverview } from "@/components/certifications/DepartmentOverview";
import { Inbox } from "@/components/certifications/Inbox";

export default function HodCertificateRequestsPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Certificate Requests" description="Students awaiting your verification" />
      <DepartmentOverview />
      <Inbox />
    </div>
  );
}
