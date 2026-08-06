"use client";

import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmergencyBudgetForm } from "../EmergencyBudgetForm";

export default function NewEmergencyBudgetRequestPage() {
  const router = useRouter();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Raise Emergency Budget Request"
        description="Submit an emergency budget request directly to Management"
      />
      <EmergencyBudgetForm
        onCancel={() => router.push("/principal/budget")}
        onSaved={() => router.push("/principal/budget")}
      />
    </div>
  );
}
