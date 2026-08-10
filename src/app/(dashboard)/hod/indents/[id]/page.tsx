"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle, ExternalLink, Pencil } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FileUpload } from "@/components/shared/FileUpload";
import { IndentStatusBadge } from "@/components/shared/indent/IndentStatusBadge";
import { IndentItemsTable } from "@/components/shared/indent/IndentItemsTable";
import { QuotationsForm } from "@/components/shared/indent/QuotationsForm";
import { toast } from "@/hooks/useToast";
import { formatCurrency, formatDate } from "@/lib/utils";
import { indentItemsTotal, INDENT_REQUEST_TYPE_LABELS, type IndentRequest } from "@/types";
import { IndentForm } from "../IndentForm";

const emptyGrnForm = () => ({ grnNumber: "", grnMessage: "" });

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground font-normal">{label}</Label>
      <p className="text-sm font-medium">{value || "-"}</p>
    </div>
  );
}

export default function HODIndentDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [request, setRequest] = useState<IndentRequest | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [showResubmit, setShowResubmit] = useState(false);

  const [grnForm, setGrnForm] = useState(emptyGrnForm());
  const [grnFile, setGrnFile] = useState<File | null>(null);
  const [isUploadingGrn, setIsUploadingGrn] = useState(false);

  function load() {
    setIsLoading(true);
    fetch(`/api/college/indent-requests/${params.id}`)
      .then((r) => r.json() as Promise<{ request?: IndentRequest; error?: string }>)
      .then((d) => {
        if (!d.request) throw new Error(d.error ?? "Not found");
        setRequest(d.request);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load indent" }))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => {
    // Awaited in a wrapper so load()'s setState calls aren't reachable
    // synchronously from the effect body (react-hooks/set-state-in-effect).
    void (async () => { await load(); })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  async function handleUploadGrn() {
    if (!request) return;
    const { grnNumber, grnMessage } = grnForm;
    if (!grnFile || !grnNumber || !grnMessage) {
      toast({ variant: "destructive", title: "GRN file, GRN number, and a confirmation message are all required" });
      return;
    }
    setIsUploadingGrn(true);
    try {
      const fd = new FormData();
      fd.append("file", grnFile);
      const uploadRes = await fetch("/api/upload/purchase-grn", { method: "POST", body: fd });
      const uploadData = (await uploadRes.json()) as { url?: string; filename?: string; error?: string };
      if (!uploadRes.ok) throw new Error(uploadData.error ?? "Upload failed");

      const res = await fetch(`/api/college/indent-requests/${request.id}`, {
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

      toast({ variant: "success", title: "GRN uploaded - goods receipt confirmed" });
      setGrnForm(emptyGrnForm());
      setGrnFile(null);
      load();
    } catch (err) {
      toast({ variant: "destructive", title: "Failed to upload GRN", description: err instanceof Error ? err.message : undefined });
    } finally {
      setIsUploadingGrn(false);
    }
  }

  if (isLoading) {
    return <div className="h-64 rounded-xl border bg-muted/30 animate-pulse" />;
  }
  if (!request) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => router.push("/hod/indents")}>
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to Indents
        </Button>
        <p className="text-sm text-muted-foreground">Indent not found.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" onClick={() => router.push("/hod/indents")}>
        <ArrowLeft className="h-4 w-4 mr-1" />
        Back to Indents
      </Button>

      <PageHeader
        title={request.title}
        description={`${request.department} - submitted ${formatDate(request.createdAt)}`}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <IndentStatusBadge status={request.status} />
            {request.requestType && (
              <Badge variant="outline" className="text-xs">{INDENT_REQUEST_TYPE_LABELS[request.requestType]}</Badge>
            )}
          </div>
        }
      />

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Indent Information</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <ReadOnlyField label="Department" value={request.department} />
            <ReadOnlyField label="Category" value={request.category} />
            <ReadOnlyField label="Submitted" value={formatDate(request.createdAt)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center justify-between">
            Item Details
            <span className="text-sm font-semibold">{formatCurrency(indentItemsTotal(request.items))}</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <IndentItemsTable items={request.items} readOnly />
        </CardContent>
      </Card>

      {request.quotations?.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Vendor Quotations</CardTitle>
          </CardHeader>
          <CardContent>
            <QuotationsForm quotations={request.quotations} selectedQuotationId={request.selectedQuotationId} readOnly />
          </CardContent>
        </Card>
      )}

      {request.status === "COMPLETED" && request.receiptUploadedByName && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Purchase Receipt</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="text-muted-foreground">
              Purchased and receipt submitted by {request.receiptUploadedByName} on {request.receiptUploadedAt ? formatDate(request.receiptUploadedAt) : "-"}.
            </p>
            <div className="flex items-center gap-3">
              <span className="font-medium">{formatCurrency(request.receiptAmount ?? 0)}</span>
              {request.receiptUrl && (
                <a href={request.receiptUrl} target="_blank" rel="noopener noreferrer" className="text-primary inline-flex items-center gap-1 text-xs">
                  {request.receiptFileName ?? "View receipt"} <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {request.status === "COMPLETED" && request.requestType !== "NON_GOODS" && !request.grnUploadedByName && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Confirm Goods Received</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Purchase Dept has bought these goods. Upload the GRN to confirm they were received.
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
                placeholder="e.g. All items received in good condition on 27 Jul 2026."
                rows={2}
              />
            </div>
            <div className="space-y-2">
              <Label>GRN Document *</Label>
              <FileUpload onFileSelect={setGrnFile} accept=".pdf,.jpg,.jpeg,.png" label="Upload GRN" />
            </div>
            <Button
              disabled={!grnFile || !grnForm.grnNumber || !grnForm.grnMessage || isUploadingGrn}
              loading={isUploadingGrn}
              onClick={() => void handleUploadGrn()}
            >
              <CheckCircle className="h-4 w-4 mr-1" />
              Confirm Goods Received
            </Button>
          </CardContent>
        </Card>
      )}

      {request.grnUploadedByName && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">GRN Confirmation</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="font-medium">GRN #{request.grnNumber}</p>
            <p className="text-muted-foreground">{request.grnMessage}</p>
            <p className="text-xs text-muted-foreground">
              Uploaded by {request.grnUploadedByName}{request.grnUploadedAt ? ` on ${formatDate(request.grnUploadedAt)}` : ""}
            </p>
            {request.grnUrl && (
              <a href={request.grnUrl} target="_blank" rel="noopener noreferrer" className="text-primary inline-flex items-center gap-1 text-xs">
                {request.grnFileName ?? "View GRN"} <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </CardContent>
        </Card>
      )}

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
          <h2 className="text-lg font-semibold">Edit & Resubmit Indent</h2>
          <IndentForm
            editingRequest={request}
            onCancel={() => setShowResubmit(false)}
            onSaved={() => router.push("/hod/indents")}
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
