"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, Pencil } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { BudgetCategorySection } from "@/components/shared/budget/BudgetCategorySection";
import { toast } from "@/hooks/useToast";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/utils";
import { budgetRequestTotal, NON_RECURRING_CATEGORIES, RECURRING_CATEGORIES, type BudgetRequest } from "@/types";
import { BudgetForm } from "../BudgetForm";

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground font-normal">{label}</Label>
      <p className="text-sm font-medium">{value || "—"}</p>
    </div>
  );
}

export default function HODBudgetDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [request, setRequest] = useState<BudgetRequest | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showResubmit, setShowResubmit] = useState(false);

  function load() {
    setIsLoading(true);
    fetch(`/api/college/budget-requests/${params.id}`)
      .then((r) => r.json() as Promise<{ request?: BudgetRequest; error?: string }>)
      .then((d) => {
        if (!d.request) throw new Error(d.error ?? "Not found");
        setRequest(d.request);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load budget request" }))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => { load(); }, [params.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoading) {
    return <div className="h-64 rounded-xl border bg-muted/30 animate-pulse" />;
  }
  if (!request) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => router.push("/hod/budget")}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to Budget
        </Button>
        <p className="text-sm text-muted-foreground">Budget request not found.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" onClick={() => router.push("/hod/budget")}>
        <ArrowLeft className="h-4 w-4 mr-1" />
        Back to Budget
      </Button>

      <PageHeader
        title={request.title}
        description={`${request.department} — submitted ${formatDate(request.createdAt)}`}
        actions={<StatusBadge status={request.status} />}
      />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Budget Information</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <ReadOnlyField label="Department" value={request.department} />
            <ReadOnlyField label="Academic Year" value={request.academicYear} />
            <ReadOnlyField
              label="Date of Budget Request"
              value={request.requestDate ? formatDateTime(new Date(request.requestDate)) : ""}
            />
            <ReadOnlyField label="Submitted" value={formatDate(request.createdAt)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center justify-between">
            Item Details
            <span className="text-sm font-semibold">{formatCurrency(budgetRequestTotal(request))}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <BudgetCategorySection label="Non Recurring" categories={NON_RECURRING_CATEGORIES} groups={request.nonRecurring} readOnly />
          <BudgetCategorySection label="Recurring" categories={RECURRING_CATEGORIES} groups={request.recurring} readOnly />
        </CardContent>
      </Card>

      {request.status === "RETURNED_TO_HOD" && !showResubmit && (
        <Card>
          <CardContent className="pt-6">
            <Button onClick={() => setShowResubmit(true)}>
              <Pencil className="h-4 w-4 mr-1" />
              Edit & Resubmit
            </Button>
          </CardContent>
        </Card>
      )}

      {showResubmit && (
        <div className="space-y-4">
          <h2 className="text-lg font-semibold">Edit & Resubmit Budget Request</h2>
          <BudgetForm
            editingRequest={request}
            onCancel={() => setShowResubmit(false)}
            onSaved={() => router.push("/hod/budget")}
          />
        </div>
      )}

      {request.history?.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">History</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {request.history.map((h, i) => (
              <div key={i} className="rounded-md border p-3 text-sm space-y-1">
                <div className="flex justify-between font-medium">
                  <span>{h.action}</span>
                  <span className="text-xs text-muted-foreground">{formatDate(h.at)}</span>
                </div>
                <p className="text-xs text-muted-foreground">by {h.byName} ({h.byRole})</p>
                {h.remarks && <p className="text-muted-foreground">{h.remarks}</p>}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
