"use client";

import { useEffect, useState } from "react";
import { RefreshCw, ExternalLink } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FileUpload } from "@/components/shared/FileUpload";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import { formatCurrency, formatDate } from "@/lib/utils";
import { PURCHASE_CLEARANCE_STATUS_LABELS, type FinancePurchaseClearance } from "@/types";

type Row = FinancePurchaseClearance & Record<string, unknown>;

const STATUS_COLOR: Record<string, string> = {
  PENDING: "bg-yellow-100 text-yellow-800 border-yellow-200",
  APPROVED: "bg-green-100 text-green-800 border-green-200",
  REJECTED: "bg-red-100 text-red-800 border-red-200",
  RETURNED: "bg-orange-100 text-orange-800 border-orange-200",
  GOODS_PURCHASED: "bg-blue-100 text-blue-800 border-blue-200",
  COMPLETED: "bg-emerald-100 text-emerald-800 border-emerald-200",
};

const emptyGrnForm = () => ({ grnNumber: "", grnMessage: "" });

export default function HODPurchaseClearancePage() {
  const [requests, setRequests] = useState<Row[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [grnForm, setGrnForm] = useState(emptyGrnForm());
  const [grnFile, setGrnFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const selected = requests.find((r) => r.id === selectedId) ?? null;

  function load() {
    setIsLoading(true);
    fetch("/api/college/finance-purchase-clearance")
      .then((r) => r.json() as Promise<{ requests: Row[] }>)
      .then((d) => setRequests(d.requests ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load purchase clearance requests" }))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => { load(); }, []);

  async function handleUploadGrn() {
    if (!selected) return;
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

      const res = await fetch(`/api/college/finance-purchase-clearance/${selected.id}`, {
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

  const columns: Column<Row>[] = [
    { key: "items", header: "Items" },
    { key: "estimatedAmount", header: "Estimated Amount", render: (row) => formatCurrency(row.estimatedAmount) },
    {
      key: "status", header: "Status",
      render: (row) => (
        <Badge variant="outline" className={STATUS_COLOR[row.status]}>
          {PURCHASE_CLEARANCE_STATUS_LABELS[row.status]}
        </Badge>
      ),
    },
    { key: "createdAt", header: "Logged On", hideOnMobile: true, render: (row) => formatDate(row.createdAt) },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Purchase Clearance"
        description="Track your department's purchase clearances and confirm goods received"
        actions={
          <Button variant="outline" size="sm" onClick={load} loading={isLoading}>
            <RefreshCw className="h-4 w-4 mr-1" />
            Refresh
          </Button>
        }
      />

      <DataTable
        data={requests}
        columns={columns}
        isLoading={isLoading}
        searchPlaceholder="Search by items..."
        searchKeys={["items"]}
        emptyTitle="No purchase clearance requests"
        emptyDescription="Requests logged by Finance for your department will appear here."
        keyExtractor={(row) => row.id}
        onRowClick={(row) => setSelectedId(row.id)}
      />

      <Dialog open={!!selectedId} onOpenChange={(o) => { if (!o) { setSelectedId(null); setGrnForm(emptyGrnForm()); setGrnFile(null); } }}>
        <DialogContent className="max-w-lg" aria-describedby={undefined}>
          <DialogHeader><DialogTitle>{selected?.items}</DialogTitle></DialogHeader>
          {selected && (
            <div className="space-y-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Estimated Amount</span>
                <span className="font-medium">{formatCurrency(selected.estimatedAmount)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Status</span>
                <Badge variant="outline" className={STATUS_COLOR[selected.status]}>
                  {PURCHASE_CLEARANCE_STATUS_LABELS[selected.status]}
                </Badge>
              </div>
              {selected.financeComments && (
                <div className="text-sm">
                  <span className="text-xs uppercase tracking-wide text-muted-foreground">Finance Comments</span>
                  <p className="mt-1 rounded bg-muted/40 p-2">{selected.financeComments}</p>
                </div>
              )}

              {selected.status === "GOODS_PURCHASED" && (
                <div className="space-y-4 border-t pt-4">
                  <p className="text-sm text-muted-foreground">
                    Finance has purchased these goods. Upload the GRN to confirm they were received and close out this request.
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
                    Confirm Goods Received
                  </Button>
                </div>
              )}

              {selected.status === "COMPLETED" && (
                <div className="space-y-2 border-t pt-4 text-sm">
                  <p className="font-medium">GRN #{selected.grnNumber}</p>
                  <p className="text-muted-foreground">{selected.grnMessage}</p>
                  <p className="text-xs text-muted-foreground">
                    Uploaded by {selected.grnUploadedByName}{selected.grnUploadedAt ? ` on ${formatDate(selected.grnUploadedAt)}` : ""}
                  </p>
                  {selected.grnUrl && (
                    <a href={selected.grnUrl} target="_blank" rel="noopener noreferrer" className="text-primary inline-flex items-center gap-1 text-xs">
                      {selected.grnFileName ?? "View GRN"} <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
