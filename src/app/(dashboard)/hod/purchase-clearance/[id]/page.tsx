"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle, ExternalLink } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FileUpload } from "@/components/shared/FileUpload";
import { QuotationsForm } from "@/components/shared/indent/QuotationsForm";
import { toast } from "@/hooks/useToast";
import { formatCurrency, formatDate, stripLeadingZeros } from "@/lib/utils";
import { PURCHASE_CLEARANCE_STATUS_LABELS, type FinancePurchaseClearance } from "@/types";

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

const emptyGrnForm = () => ({ grnNumber: "", grnMessage: "" });
const emptyResubmitForm = () => ({ items: "", estimatedAmount: "" });

export default function HODPurchaseClearanceDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [item, setItem] = useState<FinancePurchaseClearance | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const [resubmitForm, setResubmitForm] = useState(emptyResubmitForm());
  const [isResubmitting, setIsResubmitting] = useState(false);

  const [grnForm, setGrnForm] = useState(emptyGrnForm());
  const [grnFile, setGrnFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  function load() {
    setIsLoading(true);
    fetch("/api/college/finance-purchase-clearance")
      .then((r) => r.json() as Promise<{ requests: FinancePurchaseClearance[] }>)
      .then((d) => {
        const found = (d.requests ?? []).find((r) => r.id === params.id) ?? null;
        setItem(found);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load request" }))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => { load(); }, [params.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleResubmit() {
    if (!item) return;
    const items = resubmitForm.items || item.items;
    const estimatedAmount = resubmitForm.estimatedAmount || String(item.estimatedAmount);
    if (!items || !estimatedAmount) {
      toast({ variant: "destructive", title: "Fill in all required fields" });
      return;
    }
    setIsResubmitting(true);
    try {
      const res = await fetch(`/api/college/finance-purchase-clearance/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "RESUBMIT", items, estimatedAmount: Number(estimatedAmount) }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? "Failed to resubmit");
      }
      toast({ variant: "success", title: "Request resubmitted" });
      setResubmitForm(emptyResubmitForm());
      load();
    } catch (err) {
      toast({ variant: "destructive", title: "Failed to resubmit", description: err instanceof Error ? err.message : undefined });
    } finally {
      setIsResubmitting(false);
    }
  }

  async function handleUploadGrn() {
    if (!item) return;
    const { grnNumber, grnMessage } = grnForm;
    if (!grnFile || !grnNumber || !grnMessage) {
      toast({ variant: "destructive", title: "GRN file, GRN number, and a confirmation message are all required" });
      return;
    }
    setIsUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", grnFile);
      const uploadRes = await fetch("/api/upload/purchase-grn", { method: "POST", body: fd });
      const uploadData = (await uploadRes.json()) as { url?: string; filename?: string; error?: string };
      if (!uploadRes.ok) throw new Error(uploadData.error ?? "Upload failed");

      const res = await fetch(`/api/college/finance-purchase-clearance/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "UPLOAD_GRN",
          grnUrl: uploadData.url,
          grnFileName: uploadData.filename,
          grnNumber,
          grnMessage,
        }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? "Failed to save GRN");
      }

      toast({ variant: "success", title: "GRN uploaded — goods receipt confirmed" });
      setGrnForm(emptyGrnForm());
      setGrnFile(null);
      load();
    } catch (err) {
      toast({ variant: "destructive", title: "Failed to upload GRN", description: err instanceof Error ? err.message : undefined });
    } finally {
      setIsUploading(false);
    }
  }

  if (isLoading) {
    return <div className="h-64 rounded-xl border bg-muted/30 animate-pulse" />;
  }

  if (!item) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => router.push("/hod/purchase-clearance")}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to Purchase Clearance
        </Button>
        <p className="text-sm text-muted-foreground">Request not found.</p>
      </div>
    );
  }

  const latestRemarks = [...(item.history ?? [])].reverse().find((h) => h.remarks)?.remarks;

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" onClick={() => router.push("/hod/purchase-clearance")}>
        <ArrowLeft className="h-4 w-4 mr-1" />
        Back to Purchase Clearance
      </Button>

      <PageHeader
        title={item.items}
        description={`${item.department} — raised on ${formatDate(item.createdAt)}`}
        actions={
          <Badge variant="outline" className={STATUS_COLOR[item.status]}>
            {PURCHASE_CLEARANCE_STATUS_LABELS[item.status]}
          </Badge>
        }
      />

      {item.status === "RETURNED_TO_HOD" && latestRemarks && (
        <div className="rounded-md border border-orange-300/60 bg-orange-50 p-3 text-sm">
          <p className="font-medium text-orange-800">Returned by Purchase Dept for correction</p>
          <p className="mt-1 text-orange-700">{latestRemarks}</p>
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

      {item.status === "RETURNED_TO_HOD" && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Edit & Resubmit</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">Edit and resubmit this request for Purchase Dept review.</p>
            <div className="space-y-2">
              <Label>Items / Purpose *</Label>
              <Textarea
                value={resubmitForm.items || item.items}
                onChange={(e) => setResubmitForm((f) => ({ ...f, items: e.target.value }))}
                rows={3}
              />
            </div>
            <div className="space-y-2">
              <Label>Estimated Amount *</Label>
              <Input
                type="number"
                value={resubmitForm.estimatedAmount || String(item.estimatedAmount)}
                onChange={(e) => setResubmitForm((f) => ({ ...f, estimatedAmount: stripLeadingZeros(e.target.value) }))}
              />
            </div>
            <Button loading={isResubmitting} onClick={() => void handleResubmit()}>Resubmit</Button>
          </CardContent>
        </Card>
      )}

      {(item.quotations ?? []).length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Vendor Quotations</CardTitle>
          </CardHeader>
          <CardContent>
            <QuotationsForm quotations={item.quotations ?? []} selectedQuotationId={item.selectedQuotationId} readOnly />
          </CardContent>
        </Card>
      )}

      {item.status === "GOODS_PURCHASED" && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Confirm Goods Received</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Purchase Dept has bought these goods. Upload the GRN to confirm they were received and close out this request.
            </p>
            <div className="space-y-2">
              <Label>GRN Number *</Label>
              <Input value={grnForm.grnNumber} onChange={(e) => setGrnForm((f) => ({ ...f, grnNumber: e.target.value }))} placeholder="e.g. GRN-2026-0142" />
            </div>
            <div className="space-y-2">
              <Label>Confirmation Message *</Label>
              <Textarea
                value={grnForm.grnMessage}
                onChange={(e) => setGrnForm((f) => ({ ...f, grnMessage: e.target.value }))}
                placeholder="e.g. All items received in good condition on 14 Jul 2026."
                rows={2}
              />
            </div>
            <div className="space-y-2">
              <Label>GRN Document *</Label>
              <FileUpload onFileSelect={setGrnFile} accept=".pdf,.jpg,.jpeg,.png" label="Upload GRN" />
            </div>
            <Button
              disabled={!grnFile || !grnForm.grnNumber || !grnForm.grnMessage || isUploading}
              loading={isUploading}
              onClick={() => void handleUploadGrn()}
            >
              <CheckCircle className="h-4 w-4 mr-1" />
              Confirm Goods Received
            </Button>
          </CardContent>
        </Card>
      )}

      {item.status === "COMPLETED" && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">GRN Confirmation</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="font-medium">GRN #{item.grnNumber}</p>
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

      {(item.history ?? []).length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">History</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {item.history.map((h, i) => (
              <div key={i} className="rounded-md border p-3 text-sm space-y-1">
                <div className="flex justify-between font-medium">
                  <span>{PURCHASE_CLEARANCE_STATUS_LABELS[h.action as keyof typeof PURCHASE_CLEARANCE_STATUS_LABELS] ?? h.action}</span>
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
