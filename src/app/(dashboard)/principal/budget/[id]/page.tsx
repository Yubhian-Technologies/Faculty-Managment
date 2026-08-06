"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle2, Pencil, RotateCcw, XCircle } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { BudgetCategorySection } from "@/components/shared/budget/BudgetCategorySection";
import { toast } from "@/hooks/useToast";
import { useAuth } from "@/hooks/useAuth";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/utils";
import { budgetRequestTotal, NON_RECURRING_CATEGORIES, RECURRING_CATEGORIES, type BudgetRequest } from "@/types";

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground font-normal">{label}</Label>
      <p className="text-sm font-medium">{value || "—"}</p>
    </div>
  );
}

export default function PrincipalBudgetDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { user } = useAuth();
  const [request, setRequest] = useState<BudgetRequest | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [mode, setMode] = useState<"idle" | "reject" | "return">("idle");
  const [remarks, setRemarks] = useState("");
  const [isSaving, setIsSaving] = useState(false);

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

  async function act(action: "VERIFY" | "REJECT" | "RETURN") {
    if ((action === "REJECT" || action === "RETURN") && !remarks.trim()) return;
    setIsSaving(true);
    try {
      const res = await fetch(`/api/college/budget-requests/${params.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, remarks: remarks.trim() || undefined }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? "Failed to update budget request");
      }
      toast({ variant: "success", title: action === "VERIFY" ? "Budget request verified" : action === "REJECT" ? "Budget request rejected" : "Budget request returned to HOD" });
      setMode("idle");
      setRemarks("");
      load();
    } catch (err) {
      toast({ variant: "destructive", title: "Failed to update", description: err instanceof Error ? err.message : undefined });
    } finally {
      setIsSaving(false);
    }
  }

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

  const canReview = request.status === "PENDING_PRINCIPAL_VERIFICATION";
  const canResubmit = request.isEmergency && request.status === "RETURNED_TO_PRINCIPAL" && request.hodUid === user?.uid;

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" onClick={() => router.push("/principal/budget")}>
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
            <ReadOnlyField label="Requested By" value={request.hodName} />
            <ReadOnlyField
              label="Date of Budget Request"
              value={request.requestDate ? formatDateTime(new Date(request.requestDate)) : ""}
            />
            {request.isEmergency && <ReadOnlyField label="Emergency Reason" value={request.emergencyReason ?? ""} />}
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
          <BudgetCategorySection label="Non Recurring" categories={NON_RECURRING_CATEGORIES} groups={request.nonRecurring} readOnly showPriority />
          <BudgetCategorySection label="Recurring" categories={RECURRING_CATEGORIES} groups={request.recurring} readOnly showPriority />
        </CardContent>
      </Card>

      {canReview && (
        <Card className="border-primary/30">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Review Budget Request</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {mode === "idle" ? (
              <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                <Button type="button" variant="destructive" onClick={() => setMode("reject")} disabled={isSaving}>
                  <XCircle className="h-4 w-4 mr-1" />
                  Reject
                </Button>
                <Button
                  type="button" variant="outline"
                  className="border-orange-300 text-orange-700 hover:bg-orange-50"
                  onClick={() => setMode("return")} disabled={isSaving}
                >
                  <RotateCcw className="h-4 w-4 mr-1" />
                  Return to HOD
                </Button>
                <Button type="button" onClick={() => void act("VERIFY")} loading={isSaving}>
                  <CheckCircle2 className="h-4 w-4 mr-1" />
                  Verify
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                <Label className="text-sm font-medium">
                  Remarks for {mode === "reject" ? "rejection" : "returning to HOD"} <span className="text-destructive">*</span>
                </Label>
                <Textarea
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  placeholder="Explain what needs to change or why this is rejected..."
                  rows={3}
                  disabled={isSaving}
                />
                <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                  <Button type="button" variant="ghost" onClick={() => { setMode("idle"); setRemarks(""); }} disabled={isSaving}>Cancel</Button>
                  <Button
                    type="button"
                    variant={mode === "reject" ? "destructive" : "default"}
                    onClick={() => void act(mode === "reject" ? "REJECT" : "RETURN")}
                    loading={isSaving}
                  >
                    Confirm {mode === "reject" ? "Rejection" : "Return"}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {canResubmit && (
        <Card>
          <CardContent className="pt-6">
            <Button onClick={() => router.push(`/principal/budget/${request.id}/edit`)}>
              <Pencil className="h-4 w-4 mr-1" />
              Edit & Resubmit
            </Button>
          </CardContent>
        </Card>
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
