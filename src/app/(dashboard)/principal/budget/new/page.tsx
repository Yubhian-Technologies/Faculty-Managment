"use client";

import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmergencyBudgetForm } from "../EmergencyBudgetForm";

export default function NewEmergencyBudgetRequestPage() {
  const router = useRouter();

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="Raise Emergency Budget Request"
        description="Submit an urgent, out-of-cycle budget request directly to Management"
      />
      <EmergencyBudgetForm
        editingRequest={null}
        onCancel={() => router.push("/principal/budget")}
        onSaved={() => router.push("/principal/budget")}
      />
    </div>
  );
}
