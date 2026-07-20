"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { toast } from "@/hooks/useToast";
import { EmergencyBudgetForm } from "../../EmergencyBudgetForm";
import type { BudgetRequest } from "@/types";

export default function EditEmergencyBudgetRequestPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const [request, setRequest] = useState<BudgetRequest | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/college/budget-requests/${id}`)
      .then((r) => r.json() as Promise<{ request?: BudgetRequest; error?: string }>)
      .then((d) => {
        if (!d.request) {
          toast({ variant: "destructive", title: d.error ?? "Budget request not found" });
          router.push("/principal/budget");
          return;
        }
        setRequest(d.request);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load budget request" }))
      .finally(() => setLoading(false));
  }, [id, router]);

  if (loading) {
    return (
      <div className="max-w-3xl">
        <PageHeader title="Edit & Resubmit Emergency Request" description="Loading…" />
      </div>
    );
  }

  if (!request) return null;

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        title="Edit & Resubmit Emergency Request"
        description="Update the returned request and resubmit it to Management"
      />
      <EmergencyBudgetForm
        editingRequest={request}
        onCancel={() => router.push("/principal/budget")}
        onSaved={() => router.push("/principal/budget")}
      />
    </div>
  );
}
