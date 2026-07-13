"use client";

import { useEffect, useState } from "react";
import { Plus, ShoppingCart, Building2 } from "lucide-react";
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
import { formatCurrency, formatDate } from "@/lib/utils";
import type { FinanceBudget, FinancePurchaseClearance } from "@/types";

type Row = FinancePurchaseClearance & { id: string; status: string };

const emptyForm = () => ({ department: "", requestedByName: "", items: "", estimatedAmount: "", budgetId: "" });

export default function FinancePurchaseClearancePage() {
  const [requests, setRequests] = useState<Row[]>([]);
  const [budgets, setBudgets] = useState<FinanceBudget[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [isSaving, setIsSaving] = useState(false);

  function load() {
    setIsLoading(true);
    Promise.all([
      fetch("/api/college/finance-purchase-clearance").then((r) => r.json() as Promise<{ requests: Row[] }>).then((d) => d.requests ?? []),
      fetch("/api/college/finance-budgets?status=ACTIVE").then((r) => r.json() as Promise<{ budgets: FinanceBudget[] }>).then((d) => d.budgets ?? []),
    ]).then(([r, b]) => { setRequests(r); setBudgets(b); })
      .catch(() => toast({ variant: "destructive", title: "Failed to load purchase requests" }))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => { load(); }, []);

  async function handleCreate() {
    const { department, requestedByName, items, estimatedAmount, budgetId } = form;
    if (!department || !requestedByName || !items || !estimatedAmount) {
      toast({ variant: "destructive", title: "Fill in all required fields" });
      return;
    }
    setIsSaving(true);
    try {
      const res = await fetch("/api/college/finance-purchase-clearance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ department, requestedByName, items, estimatedAmount: Number(estimatedAmount), budgetId: budgetId || undefined }),
      });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "Purchase request logged" });
      setDialogOpen(false);
      setForm(emptyForm());
      load();
    } catch {
      toast({ variant: "destructive", title: "Failed to log request" });
    } finally {
      setIsSaving(false);
    }
  }

  const pending = requests.filter((r) => r.status === "PENDING");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Purchase Finance Clearance"
        description="Review purchase requests and grant financial clearance"
        actions={
          <Button onClick={() => setDialogOpen(true)}>
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
        patchUrl={(item) => `/api/college/finance-purchase-clearance/${item.id}`}
        onChanged={load}
        emptyTitle="No purchase requests"
        emptyDescription="Log a purchase request received from a department to start the clearance workflow."
        icon={<ShoppingCart className="h-8 w-8" />}
        renderSummary={(item) => (
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="font-semibold text-sm">{item.department}</span>
              <Badge variant="secondary" className="text-xs">{formatCurrency(item.estimatedAmount)}</Badge>
            </div>
            <p className="text-xs text-muted-foreground">{item.items}</p>
          </div>
        )}
        renderDetails={(item) => (
          <div className="text-sm space-y-2 pt-1">
            <p className="text-xs text-muted-foreground">Requested by {item.requestedByName}, logged by {item.loggedByName} on {formatDate(item.createdAt)}</p>
            {item.financeComments && (
              <div>
                <span className="text-xs uppercase tracking-wide text-muted-foreground">Finance Comments</span>
                <p className="mt-1 rounded bg-muted/40 p-2">{item.financeComments}</p>
              </div>
            )}
          </div>
        )}
      />

      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) setForm(emptyForm()); setDialogOpen(o); }}>
        <DialogContent className="max-w-md" aria-describedby={undefined}>
          <DialogHeader><DialogTitle>Log Purchase Request</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Department *</Label>
              <Input value={form.department} onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Requested By *</Label>
              <Input value={form.requestedByName} onChange={(e) => setForm((f) => ({ ...f, requestedByName: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Items / Purpose *</Label>
              <Textarea value={form.items} onChange={(e) => setForm((f) => ({ ...f, items: e.target.value }))} rows={2} />
            </div>
            <div className="space-y-2">
              <Label>Estimated Amount *</Label>
              <Input type="number" value={form.estimatedAmount} onChange={(e) => setForm((f) => ({ ...f, estimatedAmount: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Linked Budget (optional)</Label>
              <Select value={form.budgetId} onValueChange={(v) => setForm((f) => ({ ...f, budgetId: v }))}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent>
                  {budgets.map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.department} — {formatCurrency(b.allocatedAmount - b.utilizedAmount)} available</SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
