"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle, ExternalLink, RotateCcw, Send, XCircle } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { QuotationsForm } from "@/components/shared/indent/QuotationsForm";
import { toast } from "@/hooks/useToast";
import { formatCurrency, formatDate } from "@/lib/utils";
import { PURCHASE_CLEARANCE_STATUS_LABELS, type FinancePurchaseClearance, type PurchaseQuotation } from "@/types";

const MIN_QUOTATIONS = 3;

const STATUS_COLOR: Record<string, string> = {
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

export default function PurchaseClearanceDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [item, setItem] = useState<FinancePurchaseClearance | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [quotations, setQuotations] = useState<PurchaseQuotation[]>([]);
  const [selectedQuotationId, setSelectedQuotationId] = useState("");
  const [actionState, setActionState] = useState<{ type: "RETURN" | "REJECT"; remarks: string } | null>(null);
  const [isActing, setIsActing] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isMarking, setIsMarking] = useState(false);

  function load() {
    setIsLoading(true);
    fetch("/api/college/finance-purchase-clearance")
      .then((r) => r.json() as Promise<{ requests: FinancePurchaseClearance[] }>)
      .then((d) => {
        const found = (d.requests ?? []).find((r) => r.id === params.id) ?? null;
        setItem(found);
        setQuotations(found?.quotations?.length ? found.quotations : []);
        setSelectedQuotationId(found?.selectedQuotationId ?? "");
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load request" }))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => { load(); }, [params.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function act(action: "REJECT" | "RETURN", remarks: string) {
    if (!item) return;
    setIsActing(true);
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
      toast({ variant: "success", title: action === "REJECT" ? "Request rejected" : "Request returned to HOD" });
      setActionState(null);
      load();
    } catch (err) {
      toast({ variant: "destructive", title: "Action failed", description: err instanceof Error ? err.message : undefined });
    } finally {
      setIsActing(false);
    }
  }

  async function handleSendToFinance() {
    if (!item) return;
    setIsSending(true);
    try {
      const res = await fetch(`/api/college/finance-purchase-clearance/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "SEND_TO_FINANCE", quotations, selectedQuotationId }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? "Failed to send to Finance");
      }
      toast({ variant: "success", title: "Sent to Finance" });
      load();
    } catch (err) {
      toast({ variant: "destructive", title: "Failed to send to Finance", description: err instanceof Error ? err.message : undefined });
    } finally {
      setIsSending(false);
    }
  }

  async function handleMarkGoodsPurchased() {
    if (!item) return;
    setIsMarking(true);
    try {
      const res = await fetch(`/api/college/finance-purchase-clearance/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "GOODS_PURCHASED" }),
      });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "Marked as goods purchased", description: "The requesting HOD has been notified to upload a GRN." });
      load();
    } catch {
      toast({ variant: "destructive", title: "Failed to update status" });
    } finally {
      setIsMarking(false);
    }
  }

  if (isLoading) {
    return <div className="h-64 rounded-xl border bg-muted/30 animate-pulse" />;
  }

  if (!item) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => router.push("/purchase/indents")}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to Indent Requests
        </Button>
        <p className="text-sm text-muted-foreground">Request not found.</p>
      </div>
    );
  }

  const canReview = item.status === "PENDING_PURCHASE_REVIEW";
  const canSourceQuotations = item.status === "PENDING_PURCHASE_REVIEW" || item.status === "RETURNED_TO_PURCHASE";
  const canSendToFinance = canSourceQuotations && quotations.length >= MIN_QUOTATIONS && !!selectedQuotationId;

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" onClick={() => router.push("/purchase/indents")}>
        <ArrowLeft className="h-4 w-4 mr-1" />
        Back to Indent Requests
      </Button>

      <PageHeader
        title={item.items}
        description={`${item.department} — raised by ${item.hodName} on ${formatDate(item.createdAt)}`}
        actions={
          <Badge variant="outline" className={STATUS_COLOR[item.status]}>
            {PURCHASE_CLEARANCE_STATUS_LABELS[item.status]}
          </Badge>
        }
      />

      {item.status === "RETURNED_TO_PURCHASE" && (
        <div className="rounded-md border border-orange-300/60 bg-orange-50 p-3 text-sm">
          <p className="font-medium text-orange-800">Returned by Finance for correction</p>
          <p className="mt-1 text-orange-700">
            {[...(item.history ?? [])].reverse().find((h) => h.remarks)?.remarks}
          </p>
        </div>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center justify-between">
            Request Details
            <span className="text-sm font-semibold">{formatCurrency(item.estimatedAmount)}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">{item.items}</CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Vendor Quotations</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {canSourceQuotations ? (
            <>
              <QuotationsForm
                quotations={quotations}
                selectedQuotationId={selectedQuotationId}
                onChange={setQuotations}
                onSelectedChange={setSelectedQuotationId}
              />
              <p className="text-xs text-muted-foreground">
                Add at least {MIN_QUOTATIONS} quotations and mark one as recommended before sending to Finance.
              </p>
            </>
          ) : (
            <QuotationsForm quotations={item.quotations ?? []} selectedQuotationId={item.selectedQuotationId} readOnly />
          )}
        </CardContent>
      </Card>

      {item.status === "APPROVED" && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Mark Goods Purchased</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Finance has approved this request. Once you&apos;ve bought the goods, mark this purchased to notify {item.hodName} to confirm receipt.
            </p>
            <Button disabled={isMarking} loading={isMarking} onClick={() => void handleMarkGoodsPurchased()}>
              <CheckCircle className="h-4 w-4 mr-1" />
              Mark Goods Purchased
            </Button>
          </CardContent>
        </Card>
      )}

      {item.status === "GOODS_PURCHASED" && (
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <CheckCircle className="h-3.5 w-3.5" />
          Waiting for {item.hodName} to upload the GRN and confirm receipt.
        </div>
      )}

      {item.status === "COMPLETED" && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">GRN Confirmation</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
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
          </CardContent>
        </Card>
      )}

      {canSourceQuotations && (
        <Card>
          <CardContent className="pt-6 space-y-3">
            {actionState ? (
              <div className="space-y-2 rounded-md border border-orange-300/60 bg-orange-50 p-3">
                <Label className="text-sm font-medium">
                  {actionState.type === "RETURN" ? "Remarks for HOD" : "Reason for rejecting"}
                </Label>
                <Textarea
                  value={actionState.remarks}
                  onChange={(e) => setActionState({ ...actionState, remarks: e.target.value })}
                  placeholder={actionState.type === "RETURN" ? "What needs to be corrected?" : "Why is this request being rejected?"}
                  rows={2}
                  className="resize-none text-sm bg-background"
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    className={actionState.type === "RETURN" ? "bg-orange-600 hover:bg-orange-700 text-white" : ""}
                    variant={actionState.type === "REJECT" ? "destructive" : "default"}
                    loading={isActing}
                    disabled={!actionState.remarks.trim()}
                    onClick={() => void act(actionState.type, actionState.remarks.trim())}
                  >
                    Confirm {actionState.type === "RETURN" ? "Return" : "Reject"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setActionState(null)} disabled={isActing}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button disabled={!canSendToFinance || isSending} loading={isSending} onClick={() => void handleSendToFinance()}>
                  <Send className="h-4 w-4 mr-1" />
                  Send to Finance
                </Button>
                {canReview && (
                  <>
                    <Button
                      variant="outline"
                      className="border-orange-300 text-orange-700 hover:bg-orange-50"
                      onClick={() => setActionState({ type: "RETURN", remarks: "" })}
                    >
                      <RotateCcw className="h-4 w-4 mr-1" />
                      Return to HOD
                    </Button>
                    <Button variant="destructive" onClick={() => setActionState({ type: "REJECT", remarks: "" })}>
                      <XCircle className="h-4 w-4 mr-1" />
                      Reject
                    </Button>
                  </>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {(item.history ?? []).length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">History</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {item.history.map((h, i) => (
              <div key={i} className="rounded-md border p-3 text-sm space-y-1">
                <div className="flex justify-between font-medium">
                  <span>{PURCHASE_CLEARANCE_STATUS_LABELS[h.action] ?? h.action}</span>
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
