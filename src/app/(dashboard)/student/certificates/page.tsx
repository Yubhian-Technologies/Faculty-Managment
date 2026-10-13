"use client";

import { PageHeader } from "@/components/shared/PageHeader";
import { RequestForm } from "@/components/certifications/RequestForm";

export default function StudentCertificatesPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Certificate Management" description="Request and track your certificates" />
      <RequestForm />
    </div>
  );
}
