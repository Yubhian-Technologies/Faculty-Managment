"use client";

import { PageHeader } from "@/components/shared/PageHeader";
import { StudentCertificates } from "@/components/certifications/StudentCertificates";

export default function StudentCertificatesPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="Certificates" description="Apply for certificates, follow every approval, and download what is issued" />
      <StudentCertificates />
    </div>
  );
}
