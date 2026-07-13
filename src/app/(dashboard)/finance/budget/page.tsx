"use client";

import { useEffect, useState } from "react";
import { Plus, History } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import { formatDate, formatCurrency } from "@/lib/utils";
import type { FinanceBudget } from "@/types";

type BudgetRow = FinanceBudget & Record<string, unknown>;

const STATUS_COLOR: Record<string, string> = {
  ACTIVE: "bg-green-100 text-green-800 border-green-200",
  REVISED: "bg-orange-100 text-orange-800 border-orange-200",
  CLOSED: "bg-gray-100 text-gray-800 border-gray-200",
};

const emptyCreateForm = () => ({ department: "", purpose: "", fiscalYear: "", allocatedAmount: "" });
const emptyReviseForm = () => ({ revisedAmount: "", reason: "" });

export default function FinanceBudgetPage() {
  const [budgets, setBudgets] = useState<BudgetRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState(emptyCreateForm());
  const [isSaving, setIsSaving] = useState(false);
  const [reviseTarget, setReviseTarget] = useState<BudgetRow | null>(null);
  const [reviseForm, setReviseForm] = useState(emptyReviseForm());
  const [isRevising, setIsRevising] = useState(false);
  const [historyTarget, setHistoryTarget] = useState<BudgetRow | null>(null);

  function load() {
    setIsLoading(true);
    fetch("/api/college/finance-budgets")
      .then((r) => r.json() as Promise<{ budgets: BudgetRow[] }>)
      .then((d) => setBudgets(d.budgets ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load budgets" }))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => { load(); }, []);

  async function handleCreate() {
    const { department, purpose, fiscalYear, allocatedAmount } = createForm;
    if (!department || !purpose || !fiscalYear || !allocatedAmount) {
      toast({ variant: "destructive", title: "Fill in all fields" });
      return;
    }
    setIsSaving(true);
    try {
      const res = await fetch("/api/college/finance-budgets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ department, purpose, fiscalYear, allocatedAmount: Number(allocatedAmount) }),
      });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "Budget created" });
      setCreateOpen(false);
      setCreateForm(emptyCreateForm());
      load();
    } catch {
      toast({ variant: "destructive", title: "Failed to create budget" });
    } finally {
      setIsSaving(false);
    }
  }

  async function handleRevise() {
    if (!reviseTarget) return;
    const { revisedAmount, reason } = reviseForm;
    if (!revisedAmount || !reason) {
      toast({ variant: "destructive", title: "Revised amount and reason required" });
      return;
    }
    setIsRevising(true);
    try {
      const res = await fetch(`/api/college/finance-budgets/${reviseTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "REVISE", revisedAmount: Number(revisedAmount), reason }),
      });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "Budget revised" });
      setReviseTarget(null);
      setReviseForm(emptyReviseForm());
      load();
    } catch {
      toast({ variant: "destructive", title: "Failed to revise budget" });
    } finally {
      setIsRevising(false);
    }
  }

  async function handleClose(budget: BudgetRow) {
    try {
      const res = await fetch(`/api/college/finance-budgets/${budget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "CLOSE" }),
      });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "Budget closed" });
      load();
    } catch {
      toast({ variant: "destructive", title: "Failed to close budget" });
    }
  }

  const columns: Column<BudgetRow>[] = [
    { key: "department", header: "Department" },
    { key: "purpose", header: "Purpose", hideOnMobile: true },
    { key: "fiscalYear", header: "Fiscal Year" },
    { key: "allocatedAmount", header: "Allocated", render: (row) => formatCurrency(row.allocatedAmount) },
    { key: "utilizedAmount", header: "Utilized", render: (row) => formatCurrency(row.utilizedAmount) },
    {
      key: "remaining", header: "Remaining",
      render: (row) => formatCurrency(row.allocatedAmount - row.utilizedAmount),
    },
    {
      key: "status", header: "Status",
      render: (row) => <Badge variant="outline" className={STATUS_COLOR[row.status]}>{row.status}</Badge>,
    },
    {
      key: "actions", header: "", className: "text-right",
      render: (row) => (
        <div className="flex items-center gap-1 justify-end">
          {row.revisions?.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => setHistoryTarget(row)}>
              <History className="h-3.5 w-3.5" />
            </Button>
          )}
          {row.status !== "CLOSED" && (
            <>
              <Button size="sm" variant="outline" onClick={() => setReviseTarget(row)}>Revise</Button>
              <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => void handleClose(row)}>Close</Button>
            </>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Budget Management"
        description="Allocate, revise, and monitor department budgets"
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-1" />
            New Budget
          </Button>
        }
      />

      <DataTable
        data={budgets}
        columns={columns}
        isLoading={isLoading}
        searchPlaceholder="Search by department..."
        searchKeys={["department", "purpose", "fiscalYear"]}
        csvFilename="finance-budgets"
        emptyTitle="No budgets yet"
        emptyDescription="Create a budget to start tracking allocations and utilization."
        keyExtractor={(row) => row.id}
      />

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={(o) => { if (!o) setCreateForm(emptyCreateForm()); setCreateOpen(o); }}>
        <DialogContent className="max-w-md" aria-describedby={undefined}>
          <DialogHeader><DialogTitle>New Budget</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Department *</Label>
              <Input value={createForm.department} onChange={(e) => setCreateForm((f) => ({ ...f, department: e.target.value }))} placeholder="e.g. Computer Science" />
            </div>
            <div className="space-y-2">
              <Label>Purpose *</Label>
              <Input value={createForm.purpose} onChange={(e) => setCreateForm((f) => ({ ...f, purpose: e.target.value }))} placeholder="e.g. Lab equipment & maintenance" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Fiscal Year *</Label>
                <Input value={createForm.fiscalYear} onChange={(e) => setCreateForm((f) => ({ ...f, fiscalYear: e.target.value }))} placeholder="2026-27" />
              </div>
              <div className="space-y-2">
                <Label>Allocated Amount *</Label>
                <Input type="number" value={createForm.allocatedAmount} onChange={(e) => setCreateForm((f) => ({ ...f, allocatedAmount: e.target.value }))} placeholder="500000" />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={isSaving}>Cancel</Button>
            <Button onClick={() => void handleCreate()} loading={isSaving}>Create Budget</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Revise dialog */}
      <Dialog open={!!reviseTarget} onOpenChange={(o) => { if (!o) { setReviseTarget(null); setReviseForm(emptyReviseForm()); } }}>
        <DialogContent className="max-w-md" aria-describedby={undefined}>
          <DialogHeader><DialogTitle>Revise Budget — {reviseTarget?.department}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Current allocation: {reviseTarget && formatCurrency(reviseTarget.allocatedAmount)}
            </p>
            <div className="space-y-2">
              <Label>Revised Amount *</Label>
              <Input type="number" value={reviseForm.revisedAmount} onChange={(e) => setReviseForm((f) => ({ ...f, revisedAmount: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Reason *</Label>
              <Textarea value={reviseForm.reason} onChange={(e) => setReviseForm((f) => ({ ...f, reason: e.target.value }))} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReviseTarget(null)} disabled={isRevising}>Cancel</Button>
            <Button onClick={() => void handleRevise()} loading={isRevising}>Save Revision</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Revision history dialog */}
      <Dialog open={!!historyTarget} onOpenChange={(o) => { if (!o) setHistoryTarget(null); }}>
        <DialogContent className="max-w-md" aria-describedby={undefined}>
          <DialogHeader><DialogTitle>Revision History — {historyTarget?.department}</DialogTitle></DialogHeader>
          <div className="space-y-3 max-h-80 overflow-y-auto">
            {historyTarget?.revisions.map((rev, i) => (
              <div key={i} className="rounded-md border p-3 text-sm space-y-1">
                <div className="flex justify-between font-medium">
                  <span>{formatCurrency(rev.previousAmount)} → {formatCurrency(rev.revisedAmount)}</span>
                  <span className="text-xs text-muted-foreground">{formatDate(rev.revisedAt)}</span>
                </div>
                <p className="text-muted-foreground">{rev.reason}</p>
                <p className="text-xs text-muted-foreground">by {rev.revisedByName}</p>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
