"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import { formatCurrency } from "@/lib/utils";
import type { FinancePayment, FinancePaymentType } from "@/types";

type Row = FinancePayment & Record<string, unknown>;

const TYPE_LABELS: Record<FinancePaymentType, string> = {
  VENDOR: "Vendor",
  STAFF_REIMBURSEMENT: "Staff Reimbursement",
  STUDENT_REFUND: "Student Refund",
};

const STATUS_COLOR: Record<string, string> = {
  PENDING: "bg-yellow-100 text-yellow-800 border-yellow-200",
  PROCESSED: "bg-blue-100 text-blue-800 border-blue-200",
  VERIFIED: "bg-green-100 text-green-800 border-green-200",
};

const emptyForm = () => ({ type: "VENDOR" as FinancePaymentType, payeeName: "", amount: "", purpose: "" });

export default function FinancePaymentsPage() {
  const [payments, setPayments] = useState<Row[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [isSaving, setIsSaving] = useState(false);
  const [actionTarget, setActionTarget] = useState<{ row: Row; status: "PROCESSED" | "VERIFIED" } | null>(null);
  const [reference, setReference] = useState("");
  const [isActing, setIsActing] = useState(false);

  function load() {
    setIsLoading(true);
    fetch("/api/college/finance-payments")
      .then((r) => r.json() as Promise<{ payments: Row[] }>)
      .then((d) => setPayments(d.payments ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load payments" }))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => { load(); }, []);

  async function handleCreate() {
    const { type, payeeName, amount, purpose } = form;
    if (!payeeName || !amount || !purpose) {
      toast({ variant: "destructive", title: "Fill in all required fields" });
      return;
    }
    setIsSaving(true);
    try {
      const res = await fetch("/api/college/finance-payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, payeeName, amount: Number(amount), purpose }),
      });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "Payment created" });
      setDialogOpen(false);
      setForm(emptyForm());
      load();
    } catch {
      toast({ variant: "destructive", title: "Failed to create payment" });
    } finally {
      setIsSaving(false);
    }
  }

  async function handleAction() {
    if (!actionTarget) return;
    setIsActing(true);
    try {
      const res = await fetch(`/api/college/finance-payments/${actionTarget.row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: actionTarget.status, paymentReference: reference || undefined }),
      });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: `Payment marked as ${actionTarget.status.toLowerCase()}` });
      setActionTarget(null);
      setReference("");
      load();
    } catch {
      toast({ variant: "destructive", title: "Action failed" });
    } finally {
      setIsActing(false);
    }
  }

  const columns: Column<Row>[] = [
    { key: "payeeName", header: "Payee" },
    { key: "type", header: "Type", render: (row) => <Badge variant="secondary">{TYPE_LABELS[row.type]}</Badge> },
    { key: "purpose", header: "Purpose", hideOnMobile: true },
    { key: "amount", header: "Amount", render: (row) => formatCurrency(row.amount) },
    { key: "paymentReference", header: "Reference", hideOnMobile: true, render: (row) => row.paymentReference ?? "—" },
    { key: "status", header: "Status", render: (row) => <Badge variant="outline" className={STATUS_COLOR[row.status]}>{row.status}</Badge> },
    {
      key: "actions", header: "", className: "text-right",
      render: (row) => (
        <div className="flex justify-end gap-1">
          {row.status === "PENDING" && (
            <Button size="sm" onClick={() => setActionTarget({ row, status: "PROCESSED" })}>Process</Button>
          )}
          {row.status === "PROCESSED" && (
            <Button size="sm" variant="outline" onClick={() => setActionTarget({ row, status: "VERIFIED" })}>Verify</Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payments"
        description="Process vendor payments, staff reimbursements, and student refunds"
        actions={
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-1" />
            New Payment
          </Button>
        }
      />

      <DataTable
        data={payments}
        columns={columns}
        isLoading={isLoading}
        searchPlaceholder="Search by payee..."
        searchKeys={["payeeName", "purpose"]}
        csvFilename="finance-payments"
        emptyTitle="No payments yet"
        emptyDescription="Create a payment for a vendor, staff reimbursement, or student refund."
        keyExtractor={(row) => row.id}
      />

      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) setForm(emptyForm()); setDialogOpen(o); }}>
        <DialogContent className="max-w-md" aria-describedby={undefined}>
          <DialogHeader><DialogTitle>New Payment</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Type *</Label>
              <Select value={form.type} onValueChange={(v) => setForm((f) => ({ ...f, type: v as FinancePaymentType }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(TYPE_LABELS) as FinancePaymentType[]).map((t) => (
                    <SelectItem key={t} value={t}>{TYPE_LABELS[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Payee Name *</Label>
              <Input value={form.payeeName} onChange={(e) => setForm((f) => ({ ...f, payeeName: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Amount *</Label>
              <Input type="number" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Purpose *</Label>
              <Input value={form.purpose} onChange={(e) => setForm((f) => ({ ...f, purpose: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={isSaving}>Cancel</Button>
            <Button onClick={() => void handleCreate()} loading={isSaving}>Create Payment</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!actionTarget} onOpenChange={(o) => { if (!o) { setActionTarget(null); setReference(""); } }}>
        <DialogContent className="max-w-sm" aria-describedby={undefined}>
          <DialogHeader><DialogTitle>{actionTarget?.status === "PROCESSED" ? "Process Payment" : "Verify Payment"}</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Label>Payment Reference</Label>
            <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. UTR / cheque number" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setActionTarget(null)} disabled={isActing}>Cancel</Button>
            <Button onClick={() => void handleAction()} loading={isActing}>Confirm</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
