"use client";

import { useState } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { SegmentedTabs } from "@/components/shared/SegmentedTabs";
import { Inbox } from "@/components/certifications/Inbox";
import { IssuanceQueue } from "@/components/certifications/IssuanceQueue";

// A faculty member's own certificate work: requests waiting on them as a student's mentor, class in-charge or a
// named approver / issuer. The menu shows this only while something is waiting (useNavVisibility).
export default function PanelCertificatesPage() {
  const [tab, setTab] = useState("approvals");
  return (
    <div className="space-y-6">
      <PageHeader title="Certificates" description="Students' certificate requests awaiting your approval." />
      <SegmentedTabs value={tab} onChange={setTab} options={[{ key: "approvals", label: "Approvals" }, { key: "issue", label: "To issue" }]} />
      {tab === "approvals" ? <Inbox /> : <IssuanceQueue />}
    </div>
  );
}
