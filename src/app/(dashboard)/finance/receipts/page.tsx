"use client";

import { useEffect, useState } from "react";
import { Plus, CheckCircle2, ExternalLink } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { FileUpload } from "@/components/shared/FileUpload";
import { toast } from "@/hooks/useToast";
import { collegeFetch } from "@/lib/api/collegeFetch";
import { formatCurrency, stripLeadingZeros } from "@/lib/utils";
import type { FinanceReceipt, FinanceReceiptRelatedType } from "@/types";

type Row = FinanceReceipt & Record<string, unknown>;

const RELATED_TYPES: FinanceReceiptRelatedType[] = ["BUDGET", "EXPENSE", "PAYMENT", "ALLOCATION", "INDENT"];

const emptyForm = () => ({ relatedType: "EXPENSE" as FinanceReceiptRelatedType, relatedId: "", amount: "", description: "" });

export default function FinanceReceiptsPage() {
  const [receipts, setReceipts] = useState<Row[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [file, setFile] = useState<File | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);

  function load() {
    setIsLoading(true);
    collegeFetch("/api/college/finance-receipts")
      .then((r) => r.json() as Promise<{ receipts: Row[] }>)
      .then((d) => setReceipts(d.receipts ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load receipts" }))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => { load(); }, []);

  async function handleCreate() {
    const { relatedType, relatedId, amount, description } = form;
    if (!relatedId || !amount || !description) {
      toast({ variant: "destructive", title: "Fill in all required fields" });
      return;
    }
    setIsSaving(true);
    try {
      let fileUrl: string | undefined;
      if (file) {
        const fd = new FormData();
        fd.append("file", file);
        const uploadRes = await fetch("/api/upload/finance-receipt", { method: "POST", body: fd });
        const uploadData = (await uploadRes.json()) as { url?: string; error?: string };
        if (!uploadRes.ok) throw new Error(uploadData.error ?? "Upload failed");
        fileUrl = uploadData.url;
      }
      const res = await collegeFetch("/api/college/finance-receipts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ relatedType, relatedId, amount: Number(amount), description, fileUrl }),
      });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "Receipt recorded" });
      setDialogOpen(false);
      setForm(emptyForm());
      setFile(null);
      load();
    } catch (err) {
      toast({ variant: "destructive", title: "Failed to record receipt", description: err instanceof Error ? err.message : undefined });
    } finally {
      setIsSaving(false);
    }
  }

  async function handleVerify(row: Row) {
    setVerifyingId(row.id);
    try {
      const res = await collegeFetch(`/api/college/finance-receipts/${row.id}`, { method: "PATCH" });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "Receipt verified" });
      load();
    } catch {
      toast({ variant: "destructive", title: "Failed to verify receipt" });
    } finally {
      setVerifyingId(null);
    }
  }

  const columns: Column<Row>[] = [
    { key: "description", header: "Description" },
    { key: "relatedType", header: "Related To", render: (row) => <Badge variant="secondary">{row.relatedType}</Badge> },
    { key: "amount", header: "Amount", render: (row) => formatCurrency(row.amount) },
    {
      key: "fileUrl", header: "File", hideOnMobile: true,
      render: (row) => row.fileUrl ? (
        <a href={row.fileUrl} target="_blank" rel="noopener noreferrer" className="text-primary inline-flex items-center gap-1 text-xs">
          View <ExternalLink className="h-3 w-3" />
        </a>
      ) : "—",
    },
    {
      key: "verified", header: "Status",
      render: (row) => row.verified
        ? <Badge variant="outline" className="bg-green-100 text-green-800 border-green-200">Verified</Badge>
        : <Badge variant="outline" className="bg-yellow-100 text-yellow-800 border-yellow-200">Unverified</Badge>,
    },
    {
      key: "actions", header: "", className: "text-right",
      render: (row) => !row.verified && (
        <Button size="sm" variant="outline" loading={verifyingId === row.id} onClick={() => void handleVerify(row)}>
          <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
          Verify
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Receipts"
        description="Record and verify receipts for budgets, expenses, payments, and allocations"
        actions={
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-1" />
            New Receipt
          </Button>
        }
      />

      <DataTable
        data={receipts}
        columns={columns}
        isLoading={isLoading}
        searchPlaceholder="Search receipts..."
        searchKeys={["description", "relatedId"]}
        csvFilename="finance-receipts"
        emptyTitle="No receipts recorded"
        emptyDescription="Record a receipt for a budget, expense, payment, or allocation for audit documentation."
        keyExtractor={(row) => row.id}
      />

      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) { setForm(emptyForm()); setFile(null); } setDialogOpen(o); }}>
        <DialogContent className="max-w-md" aria-describedby={undefined}>
          <DialogHeader><DialogTitle>New Receipt</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Related To *</Label>
              <Select value={form.relatedType} onValueChange={(v) => setForm((f) => ({ ...f, relatedType: v as FinanceReceiptRelatedType }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {RELATED_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Related Record ID *</Label>
              <Input value={form.relatedId} onChange={(e) => setForm((f) => ({ ...f, relatedId: e.target.value }))} placeholder="Budget / expense / payment / allocation ID" />
            </div>
            <div className="space-y-2">
              <Label>Amount *</Label>
              <Input type="number" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: stripLeadingZeros(e.target.value) }))} />
            </div>
            <div className="space-y-2">
              <Label>Description *</Label>
              <Textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={2} />
            </div>
            <div className="space-y-2">
              <Label>Receipt File (optional)</Label>
              <FileUpload onFileSelect={setFile} accept=".pdf,.jpg,.jpeg,.png" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={isSaving}>Cancel</Button>
            <Button onClick={() => void handleCreate()} loading={isSaving}>Record Receipt</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
