"use client";

import { useEffect, useState } from "react";
import { Building2, CheckCircle, ChevronDown, ChevronUp, ExternalLink, RotateCcw, ShoppingCart, XCircle } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { CardSkeleton } from "@/components/shared/SkeletonLoader";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { QuotationsForm } from "@/components/shared/indent/QuotationsForm";
import { toast } from "@/hooks/useToast";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import { PURCHASE_CLEARANCE_STATUS_LABELS, type FinancePurchaseClearance } from "@/types";

type Row = FinancePurchaseClearance & { id: string; status: string };

const STATUS_STYLES: Record<string, string> = {
  PENDING_PURCHASE_REVIEW: "bg-yellow-100 text-yellow-800 border-yellow-200",
  REJECTED_BY_PURCHASE: "bg-red-100 text-red-800 border-red-200",
  RETURNED_TO_HOD: "bg-orange-100 text-orange-800 border-orange-200",
  PENDING_FINANCE_REVIEW: "bg-yellow-100 text-yellow-800 border-yellow-200",
  RETURNED_TO_PURCHASE: "bg-orange-100 text-orange-800 border-orange-200",
  REJECTED: "bg-red-100 text-red-800 border-red-200",
  APPROVED: "bg-green-100 text-green-800 border-green-200",
  GOODS_PURCHASED: "bg-blue-100 text-blue-800 border-blue-200",
  COMPLETED: "bg-emerald-100 text-emerald-800 border-emerald-200",
};

export default function FinancePurchaseClearancePage() {
  const [requests, setRequests] = useState<Row[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  const [returnState, setReturnState] = useState<{ id: string; remarks: string } | null>(null);
  const [rejectState, setRejectState] = useState<{ id: string; remarks: string } | null>(null);

  function load() {
    setIsLoading(true);
    fetch("/api/college/finance-purchase-clearance")
      .then((r) => r.json() as Promise<{ requests: Row[] }>)
      .then((d) => setRequests(d.requests ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load purchase clearance requests" }))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => { load(); }, []);

  async function act(item: Row, action: "APPROVE" | "REJECT" | "RETURN", remarks?: string) {
    setActingId(item.id);
    try {
      const res = await fetch(`/api/college/finance-purchase-clearance/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, remarks }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? "Action failed");
      }
      toast({ variant: "success", title: action === "APPROVE" ? "Request approved" : action === "REJECT" ? "Request rejected" : "Request returned to Purchase Dept" });
      setReturnState(null);
      setRejectState(null);
      load();
    } catch (err) {
      toast({ variant: "destructive", title: "Action failed", description: err instanceof Error ? err.message : undefined });
    } finally {
      setActingId(null);
    }
  }

  const pending = requests.filter((r) => r.status === "PENDING_FINANCE_REVIEW");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Purchase Finance Clearance"
        description="Review vendor quotations and grant financial clearance"
      />

      <Card>
        <CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Pending Review</p>
          <p className="text-2xl font-bold text-yellow-600">{isLoading ? "…" : pending.length}</p>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="space-y-3">{[1, 2, 3].map((i) => <CardSkeleton key={i} />)}</div>
      ) : requests.length === 0 ? (
        <EmptyState
          title="No purchase clearance requests"
          description="Requests HODs raise, once quotations are sourced by Purchase Dept, will appear here for review."
          icon={<ShoppingCart className="h-8 w-8" />}
        />
      ) : (
        <div className="space-y-3">
          {requests.map((item) => {
            const isExpanded = expandedId === item.id;
            const isActingThis = actingId === item.id;
            const isReturning = returnState?.id === item.id;
            const isRejecting = rejectState?.id === item.id;
            const isPending = item.status === "PENDING_FINANCE_REVIEW";

            return (
              <Card key={item.id}>
                <CardHeader
                  className="pb-3 cursor-pointer"
                  onClick={() => setExpandedId(isExpanded ? null : item.id)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                        <span className="font-semibold text-sm">{item.department}</span>
                        <Badge variant="secondary" className="text-xs">{formatCurrency(item.estimatedAmount)}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{item.items}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant="outline" className={cn("text-xs", STATUS_STYLES[item.status])}>
                        {PURCHASE_CLEARANCE_STATUS_LABELS[item.status as keyof typeof PURCHASE_CLEARANCE_STATUS_LABELS] ?? item.status}
                      </Badge>
                      {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                    </div>
                  </div>
                </CardHeader>

                {isExpanded && (
                  <CardContent className="pt-0 space-y-3 text-sm">
                    <p className="text-xs text-muted-foreground">Raised by {item.hodName} on {formatDate(item.createdAt)}</p>

                    {(item.quotations ?? []).length > 0 && (
                      <div className="space-y-2">
                        <span className="text-xs uppercase tracking-wide text-muted-foreground">Vendor Quotations</span>
                        <QuotationsForm quotations={item.quotations ?? []} selectedQuotationId={item.selectedQuotationId} readOnly />
                      </div>
                    )}

                    {item.status === "COMPLETED" && (
                      <div>
                        <span className="text-xs uppercase tracking-wide text-muted-foreground">GRN Confirmation</span>
                        <div className="mt-1 rounded bg-muted/40 p-2 space-y-1">
                          <p>GRN #{item.grnNumber}</p>
                          <p className="text-muted-foreground">{item.grnMessage}</p>
                          <p className="text-xs text-muted-foreground">
                            Uploaded by {item.grnUploadedByName}{item.grnUploadedAt ? ` on ${formatDate(item.grnUploadedAt)}` : ""}
                          </p>
                          {item.grnUrl && (
                            <a href={item.grnUrl} target="_blank" rel="noopener noreferrer" className="text-primary inline-flex items-center gap-1 text-xs">
                              {item.grnFileName ?? "View GRN"} <ExternalLink className="h-3 w-3" />
                            </a>
                          )}
                        </div>
                      </div>
                    )}

                    {isPending && !isReturning && !isRejecting && (
                      <div className="flex flex-wrap gap-2 pt-2 border-t">
                        <Button
                          size="sm"
                          className="bg-green-600 hover:bg-green-700 text-white"
                          disabled={actingId !== null}
                          loading={isActingThis}
                          onClick={() => void act(item, "APPROVE")}
                        >
                          <CheckCircle className="h-3.5 w-3.5 mr-1" />
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="border-orange-300 text-orange-700 hover:bg-orange-50"
                          disabled={actingId !== null}
                          onClick={() => setReturnState({ id: item.id, remarks: "" })}
                        >
                          <RotateCcw className="h-3.5 w-3.5 mr-1" />
                          Return to Purchase Dept
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          disabled={actingId !== null}
                          onClick={() => setRejectState({ id: item.id, remarks: "" })}
                        >
                          <XCircle className="h-3.5 w-3.5 mr-1" />
                          Reject
                        </Button>
                      </div>
                    )}

                    {isReturning && (
                      <div className="space-y-2 rounded-md border border-orange-300/60 bg-orange-50 p-3 pt-2 border-t">
                        <Label className="text-sm font-medium">Remarks for Purchase Dept</Label>
                        <Textarea
                          value={returnState.remarks}
                          onChange={(e) => setReturnState((prev) => (prev ? { ...prev, remarks: e.target.value } : prev))}
                          placeholder="What needs to be revised in the quotations?"
                          rows={2}
                          className="resize-none text-sm bg-background"
                        />
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            className="bg-orange-600 hover:bg-orange-700 text-white"
                            loading={isActingThis}
                            disabled={!returnState.remarks.trim()}
                            onClick={() => void act(item, "RETURN", returnState.remarks.trim())}
                          >
                            Confirm Return
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setReturnState(null)} disabled={isActingThis}>
                            Cancel
                          </Button>
                        </div>
                      </div>
                    )}

                    {isRejecting && (
                      <div className="space-y-2 rounded-md border border-red-300/60 bg-red-50 p-3 pt-2 border-t">
                        <Label className="text-sm font-medium">Reason for rejecting</Label>
                        <Textarea
                          value={rejectState.remarks}
                          onChange={(e) => setRejectState((prev) => (prev ? { ...prev, remarks: e.target.value } : prev))}
                          placeholder="Why is this request being rejected?"
                          rows={2}
                          className="resize-none text-sm bg-background"
                        />
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="destructive"
                            loading={isActingThis}
                            disabled={!rejectState.remarks.trim()}
                            onClick={() => void act(item, "REJECT", rejectState.remarks.trim())}
                          >
                            Confirm Reject
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setRejectState(null)} disabled={isActingThis}>
                            Cancel
                          </Button>
                        </div>
                      </div>
                    )}
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
