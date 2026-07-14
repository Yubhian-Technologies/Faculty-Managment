"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle, RotateCcw, Send, XCircle } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { IndentStatusBadge } from "@/components/shared/indent/IndentStatusBadge";
import { IndentItemsTable } from "@/components/shared/indent/IndentItemsTable";
import { QuotationsForm } from "@/components/shared/indent/QuotationsForm";
import { toast } from "@/hooks/useToast";
import { formatCurrency, formatDate } from "@/lib/utils";
import { indentItemsTotal, type IndentQuotation, type IndentRequest } from "@/types";

const MIN_QUOTATIONS = 3;

export default function PurchaseIndentDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [request, setRequest] = useState<IndentRequest | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [quotations, setQuotations] = useState<IndentQuotation[]>([]);
  const [selectedQuotationId, setSelectedQuotationId] = useState<string>("");
  const [actionState, setActionState] = useState<{ type: "RETURN" | "REJECT"; remarks: string } | null>(null);
  const [isActing, setIsActing] = useState(false);

  function load() {
    setIsLoading(true);
    fetch(`/api/college/indent-requests/${params.id}`)
      .then((r) => r.json() as Promise<{ request?: IndentRequest; error?: string }>)
      .then((d) => {
        if (!d.request) throw new Error(d.error ?? "Not found");
        setRequest(d.request);
        setQuotations(d.request.quotations?.length ? d.request.quotations : []);
        setSelectedQuotationId(d.request.selectedQuotationId ?? "");
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load indent" }))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => { load(); }, [params.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function act(action: "REJECT" | "RETURN" | "SEND_TO_FINANCE", remarks?: string) {
    if (!request) return;
    setIsActing(true);
    try {
      const res = await fetch(`/api/college/indent-requests/${request.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          action === "SEND_TO_FINANCE"
            ? { action, quotations, selectedQuotationId }
            : { action, remarks }
        ),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? "Action failed");
      }
      toast({
        variant: "success",
        title: action === "SEND_TO_FINANCE" ? "Sent to Finance" : action === "REJECT" ? "Indent rejected" : "Indent returned to HOD",
      });
      setActionState(null);
      load();
    } catch (err) {
      toast({ variant: "destructive", title: "Action failed", description: err instanceof Error ? err.message : undefined });
    } finally {
      setIsActing(false);
    }
  }

  if (isLoading) {
    return <div className="h-64 rounded-xl border bg-muted/30 animate-pulse" />;
  }
  if (!request) {
    return <EmptyRequest onBack={() => router.push("/purchase/indents")} />;
  }

  const canReview = request.status === "PENDING_PURCHASE_REVIEW";
  const canSourceQuotations = request.status === "PENDING_PURCHASE_REVIEW" || request.status === "RETURNED_TO_PURCHASE";
  const canSendToFinance = canSourceQuotations && quotations.length >= MIN_QUOTATIONS && !!selectedQuotationId;

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" onClick={() => router.push("/purchase/indents")}>
        <ArrowLeft className="h-4 w-4 mr-1" />
        Back to Indents
      </Button>

      <PageHeader
        title={request.title}
        description={`${request.department} — raised by ${request.hodName} on ${formatDate(request.createdAt)}`}
        actions={<IndentStatusBadge status={request.status} className="text-sm" />}
      />

      {request.status === "RETURNED_TO_PURCHASE" && (
        <div className="rounded-md border border-orange-300/60 bg-orange-50 p-3 text-sm">
          <p className="font-medium text-orange-800">Returned by Finance for correction</p>
          <p className="mt-1 text-orange-700">
            {[...(request.history ?? [])].reverse().find((h) => h.remarks)?.remarks}
          </p>
        </div>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center justify-between">
            Items
            <span className="text-sm font-semibold">{formatCurrency(indentItemsTotal(request.items))}</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <IndentItemsTable items={request.items} readOnly />
        </CardContent>
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
            <QuotationsForm quotations={request.quotations} selectedQuotationId={request.selectedQuotationId} readOnly />
          )}
        </CardContent>
      </Card>

      {(canReview || canSourceQuotations) && (
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
                  placeholder={actionState.type === "RETURN" ? "What needs to be corrected?" : "Why is this indent being rejected?"}
                  rows={2}
                  className="resize-none text-sm bg-background"
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    className={actionState.type === "RETURN" ? "bg-orange-600 hover:bg-orange-700 text-white" : ""}
                    variant={actionState.type === "REJECT" ? "destructive" : "default"}
                    disabled={!actionState.remarks.trim()}
                    loading={isActing}
                    onClick={() => void act(actionState.type, actionState.remarks.trim())}
                  >
                    {actionState.type === "RETURN" ? "Confirm Return" : "Confirm Reject"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setActionState(null)} disabled={isActing}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {canSourceQuotations && (
                  <Button disabled={!canSendToFinance || isActing} loading={isActing} onClick={() => void act("SEND_TO_FINANCE")}>
                    <Send className="h-4 w-4 mr-1" />
                    Send to Finance
                  </Button>
                )}
                {canReview && (
                  <>
                    <Button
                      variant="outline"
                      className="border-orange-300 text-orange-700 hover:bg-orange-50"
                      disabled={isActing}
                      onClick={() => setActionState({ type: "RETURN", remarks: "" })}
                    >
                      <RotateCcw className="h-4 w-4 mr-1" />
                      Return to HOD
                    </Button>
                    <Button
                      variant="destructive"
                      disabled={isActing}
                      onClick={() => setActionState({ type: "REJECT", remarks: "" })}
                    >
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
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        <CheckCircle className="h-3.5 w-3.5" />
        Once sent to Finance, this indent moves to Finance&apos;s review queue for approval and disbursement.
      </div>
    </div>
  );
}

function EmptyRequest({ onBack }: { onBack: () => void }) {
  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={onBack}>
        <ArrowLeft className="h-4 w-4 mr-1" />
        Back to Indents
      </Button>
      <p className="text-sm text-muted-foreground">Indent not found.</p>
    </div>
  );
}
