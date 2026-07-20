"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { CheckCircle2, XCircle, RotateCcw, AlertTriangle, FileText, Pencil } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { BudgetCategorySection } from "@/components/shared/budget/BudgetCategorySection";
import { toast } from "@/hooks/useToast";
import { useAuth } from "@/hooks/useAuth";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/utils";
import { budgetRequestTotal, NON_RECURRING_CATEGORIES, RECURRING_CATEGORIES, type BudgetRequest } from "@/types";

interface ReadOnlyFieldProps {
  label: string;
  value: string;
}

function ReadOnlyField({ label, value }: ReadOnlyFieldProps) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground font-normal">{label}</Label>
      <p className="text-sm font-medium">{value || "—"}</p>
    </div>
  );
}

export default function BudgetRequestDetailPage() {
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();

  const [request, setRequest] = useState<BudgetRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<"idle" | "reject" | "return">("idle");
  const [remarks, setRemarks] = useState("");
  const [isSaving, setIsSaving] = useState(false);

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

  const isPending = request?.status === "PENDING_PRINCIPAL_VERIFICATION";
  const canResubmit =
    !!request && request.isEmergency && request.status === "RETURNED_TO_PRINCIPAL" && request.hodUid === user?.uid;

  function reset() {
    setMode("idle");
    setRemarks("");
  }

  async function act(action: "VERIFY" | "REJECT" | "RETURN") {
    if (!request) return;
    if ((action === "REJECT" || action === "RETURN") && !remarks.trim()) {
      toast({ variant: "destructive", title: "Remarks are required" });
      return;
    }
    setIsSaving(true);
    try {
      const res = await fetch(`/api/college/budget-requests/${request.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, remarks: remarks.trim() || undefined }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? "Action failed");
      }
      toast({
        variant: "success",
        title: action === "VERIFY" ? "Request verified — Level 1 freeze applied" : action === "REJECT" ? "Request rejected" : "Request returned to HOD",
      });
      reset();
      router.push("/principal/budget");
    } catch (err) {
      toast({ variant: "destructive", title: "Action failed", description: err instanceof Error ? err.message : undefined });
    } finally {
      setIsSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-2xl">
        <PageHeader title="Budget Request" description="Loading…" />
      </div>
    );
  }

  if (!request) return null;

  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader
        title={request.title}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <StatusBadge status={request.status} />
            {request.isEmergency && (
              <Badge variant="destructive" className="gap-1">
                <AlertTriangle className="h-3 w-3" />
                Emergency · {request.emergencyType === "GOODS" ? "Goods" : "Non-Goods"}
              </Badge>
            )}
          </div>
        }
      />

      <Card>
        <CardContent className="pt-6 space-y-6">
          {/* Budget Information */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-muted-foreground">Budget Information</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <ReadOnlyField label="Department" value={request.department} />
              <ReadOnlyField label="Requested By" value={request.hodName} />
              <ReadOnlyField label="Academic Year" value={request.academicYear} />
              <ReadOnlyField
                label="Date of Budget Request"
                value={request.requestDate ? formatDateTime(new Date(request.requestDate)) : ""}
              />
              <ReadOnlyField label="Submitted" value={formatDate(request.createdAt)} />
            </div>
            {request.isEmergency && (
              <ReadOnlyField label="Emergency Reason" value={request.emergencyReason ?? ""} />
            )}
            {request.reportFileUrl && (
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground font-normal">Finance Report</Label>
                <div>
                  <a
                    href={request.reportFileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                  >
                    <FileText className="h-4 w-4" />
                    {request.reportFileName ?? "View Report"}
                  </a>
                </div>
              </div>
            )}
          </div>

          {/* Item Details */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-muted-foreground">Item Details</h3>
              <span className="text-sm font-semibold">{formatCurrency(budgetRequestTotal(request))}</span>
            </div>
            <BudgetCategorySection label="Non Recurring" categories={NON_RECURRING_CATEGORIES} groups={request.nonRecurring} readOnly />
            <BudgetCategorySection label="Recurring" categories={RECURRING_CATEGORIES} groups={request.recurring} readOnly />
          </div>

          {/* History */}
          {request.history?.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-muted-foreground">History</h3>
              <div className="space-y-2">
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
              </div>
            </div>
          )}

          {canResubmit && (
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end pt-4 border-t">
              <Button type="button" onClick={() => router.push(`/principal/budget/${request.id}/edit`)}>
                <Pencil className="h-4 w-4 mr-1" />
                Edit &amp; Resubmit
              </Button>
            </div>
          )}

          {isPending && mode === "idle" && (
            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end pt-4 border-t">
              <Button type="button" variant="destructive" onClick={() => setMode("reject")} disabled={isSaving}>
                <XCircle className="h-4 w-4 mr-1" />
                Reject
              </Button>
              <Button
                type="button"
                variant="outline"
                className="border-orange-300 text-orange-700 hover:bg-orange-50"
                onClick={() => setMode("return")}
                disabled={isSaving}
              >
                <RotateCcw className="h-4 w-4 mr-1" />
                Return to HOD
              </Button>
              <Button type="button" onClick={() => void act("VERIFY")} loading={isSaving}>
                <CheckCircle2 className="h-4 w-4 mr-1" />
                Verify & Freeze (L1)
              </Button>
            </div>
          )}

          {isPending && (mode === "reject" || mode === "return") && (
            <div className="space-y-3 pt-4 border-t">
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
                <Button type="button" variant="ghost" onClick={reset} disabled={isSaving}>
                  Cancel
                </Button>
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
    </div>
  );
}
