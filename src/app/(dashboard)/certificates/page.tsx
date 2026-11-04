"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { SegmentedTabs } from "@/components/shared/SegmentedTabs";
import { Inbox } from "@/components/certifications/Inbox";
import { IssuanceQueue } from "@/components/certifications/IssuanceQueue";
import { CertificateRegister } from "@/components/certifications/CertificateRegister";
import { CertificateSetup } from "@/components/certifications/CertificateSetup";
import { useAuth } from "@/hooks/useAuth";

// The shared certificate workspace for college staff: requests waiting on my approval, certificates I issue, the
// register (Principal / VP / College Office / Exam Cell) and Setup (Principal / College Admin / VP edit; College
// Office reads). Every list comes from the API, which shows each person only what is theirs.

const REGISTER = ["PRINCIPAL", "VICE_PRINCIPAL", "COLLEGE_OFFICE", "EXAM_CELL"];
const ADMIN = ["PRINCIPAL", "VICE_PRINCIPAL"];

function Workspace() {
  const { user } = useAuth();
  const params = useSearchParams();
  const router = useRouter();
  const held = new Set<string>([user?.role ?? "", ...(user?.roles ?? [])]);
  const canRegister = REGISTER.some((r) => held.has(r));
  const isAdmin = ADMIN.some((r) => held.has(r));
  const canSetup = isAdmin || held.has("COLLEGE_OFFICE");
  const options = [
    { key: "approvals", label: "Approvals" },
    { key: "issue", label: "To issue" },
    ...(canRegister ? [{ key: "register", label: "Register" }] : []),
    ...(canSetup ? [{ key: "setup", label: "Setup" }] : []),
  ];
  const asked = params.get("tab") ?? "approvals";
  const tab = options.some((o) => o.key === asked) ? asked : "approvals";

  return (
    <div className="space-y-6">
      <PageHeader title="Certificates" description="Approve students' certificate requests, issue them, and keep the register" />
      <SegmentedTabs options={options} value={tab} onChange={(k) => router.replace(`/certificates?tab=${k}`)} />
      {tab === "approvals" && <Inbox />}
      {tab === "issue" && <IssuanceQueue />}
      {tab === "register" && <CertificateRegister canRevoke={isAdmin} />}
      {tab === "setup" && <CertificateSetup canEdit={isAdmin} />}
    </div>
  );
}

export default function CertificatesPage() {
  return <Suspense fallback={<p className="text-sm text-muted-foreground">Loading…</p>}><Workspace /></Suspense>;
}
