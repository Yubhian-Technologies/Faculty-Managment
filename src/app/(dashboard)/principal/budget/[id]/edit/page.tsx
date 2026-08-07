"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/useToast";
import type { BudgetRequest } from "@/types";
import { EmergencyBudgetForm } from "../../EmergencyBudgetForm";

export default function EditEmergencyBudgetRequestPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [request, setRequest] = useState<BudgetRequest | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/college/budget-requests/${params.id}`)
      .then((r) => r.json() as Promise<{ request?: BudgetRequest; error?: string }>)
      .then((d) => {
        if (!d.request) throw new Error(d.error ?? "Not found");
        setRequest(d.request);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load budget request" }))
      .finally(() => setIsLoading(false));
  }, [params.id]);

  if (isLoading) {
    return <div className="h-64 rounded-xl border bg-muted/30 animate-pulse" />;
  }
  if (!request) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => router.push("/principal/budget")}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to Budget
        </Button>
        <p className="text-sm text-muted-foreground">Budget request not found.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" onClick={() => router.push(`/principal/budget/${request.id}`)}>
        <ArrowLeft className="h-4 w-4 mr-1" />
        Back to Request
      </Button>
      <PageHeader title="Edit & Resubmit Emergency Request" description={request.title} />
      <EmergencyBudgetForm
        editingRequest={request}
        onCancel={() => router.push(`/principal/budget/${request.id}`)}
        onSaved={() => router.push(`/principal/budget/${request.id}`)}
      />
    </div>
  );
}
