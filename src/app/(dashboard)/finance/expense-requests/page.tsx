"use client";

import { useEffect, useState } from "react";
import { Plus, ClipboardList, Building2 } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { ApprovalWorkflowList } from "@/components/finance/ApprovalWorkflowList";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import { collegeFetch } from "@/lib/api/collegeFetch";
import { formatCurrency, formatDate, stripLeadingZeros } from "@/lib/utils";
import type { FinanceBudget, FinanceExpenseRequest } from "@/types";

type Row = FinanceExpenseRequest & { id: string; status: string };

const emptyForm = () => ({ department: "", budgetId: "", amount: "", purpose: "", justification: "" });

export default function FinanceExpenseRequestsPage() {
  const [requests, setRequests] = useState<Row[]>([]);
  const [budgets, setBudgets] = useState<FinanceBudget[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [isSaving, setIsSaving] = useState(false);

  function load() {
    setIsLoading(true);
    Promise.all([
      collegeFetch("/api/college/finance-expense-requests").then((r) => r.json() as Promise<{ requests: Row[] }>).then((d) => d.requests ?? []),
      collegeFetch("/api/college/finance-budgets?status=ACTIVE").then((r) => r.json() as Promise<{ budgets: FinanceBudget[] }>).then((d) => d.budgets ?? []),
    ]).then(([r, b]) => { setRequests(r); setBudgets(b); })
      .catch(() => toast({ variant: "destructive", title: "Failed to load expense requests" }))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => { load(); }, []);

  async function handleCreate() {
    const { department, budgetId, amount, purpose, justification } = form;
    if (!department || !budgetId || !amount || !purpose) {
      toast({ variant: "destructive", title: "Fill in all required fields" });
      return;
    }
    setIsSaving(true);
    try {
      const res = await collegeFetch("/api/college/finance-expense-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ department, budgetId, amount: Number(amount), purpose, justification }),
      });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "Expense request logged" });
      setDialogOpen(false);
      setForm(emptyForm());
      load();
    } catch {
      toast({ variant: "destructive", title: "Failed to log request" });
    } finally {
      setIsSaving(false);
    }
  }

  const budgetName = (id: string) => budgets.find((b) => b.id === id)?.department ?? id;
  const pending = requests.filter((r) => r.status === "PENDING");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Expense Requests"
        description="Review expenditure requests against available budget"
        actions={
          <Button onClick={() => setDialogOpen(true)} disabled={budgets.length === 0}>
            <Plus className="h-4 w-4 mr-1" />
            Log Request
          </Button>
        }
      />

      <Card>
        <CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Pending Requests</p>
          <p className="text-2xl font-bold text-yellow-600">{isLoading ? "…" : pending.length}</p>
        </CardContent>
      </Card>

      <ApprovalWorkflowList
        items={requests}
        isLoading={isLoading}
        patchUrl={(item) => `/api/college/finance-expense-requests/${item.id}`}
        onChanged={load}
        emptyTitle="No expense requests"
        emptyDescription="Log an expenditure request received from a department to start the approval workflow."
        icon={<ClipboardList className="h-8 w-8" />}
        renderSummary={(item) => (
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="font-semibold text-sm">{item.department}</span>
              <Badge variant="secondary" className="text-xs">{formatCurrency(item.amount)}</Badge>
            </div>
            <p className="text-xs text-muted-foreground">{item.purpose} · Budget: {budgetName(item.budgetId)}</p>
          </div>
        )}
        renderDetails={(item) => (
          <div className="text-sm space-y-2 pt-1">
            {item.justification && (
              <div>
                <span className="text-xs uppercase tracking-wide text-muted-foreground">Justification</span>
                <p className="mt-1 rounded bg-muted/40 p-2">{item.justification}</p>
              </div>
            )}
            <p className="text-xs text-muted-foreground">Logged by {item.loggedByName} on {formatDate(item.createdAt)}</p>
            {item.financeRemarks && (
              <div>
                <span className="text-xs uppercase tracking-wide text-muted-foreground">Finance Remarks</span>
                <p className="mt-1 rounded bg-muted/40 p-2">{item.financeRemarks}</p>
              </div>
            )}
          </div>
        )}
      />

      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) setForm(emptyForm()); setDialogOpen(o); }}>
        <DialogContent className="max-w-md" aria-describedby={undefined}>
          <DialogHeader><DialogTitle>Log Expense Request</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Department *</Label>
              <Input value={form.department} onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))} placeholder="e.g. Mechanical Engineering" />
            </div>
            <div className="space-y-2">
              <Label>Budget *</Label>
              <Select value={form.budgetId} onValueChange={(v) => setForm((f) => ({ ...f, budgetId: v }))}>
                <SelectTrigger><SelectValue placeholder="Select budget..." /></SelectTrigger>
                <SelectContent>
                  {budgets.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.department} — {formatCurrency(b.allocatedAmount - b.utilizedAmount)} available
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Amount *</Label>
              <Input type="number" value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: stripLeadingZeros(e.target.value) }))} />
            </div>
            <div className="space-y-2">
              <Label>Purpose *</Label>
              <Input value={form.purpose} onChange={(e) => setForm((f) => ({ ...f, purpose: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Justification</Label>
              <Textarea value={form.justification} onChange={(e) => setForm((f) => ({ ...f, justification: e.target.value }))} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={isSaving}>Cancel</Button>
            <Button onClick={() => void handleCreate()} loading={isSaving}>Log Request</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
