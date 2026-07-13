"use client";

import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import { formatCurrency } from "@/lib/utils";
import type { FinanceBudget, FinanceFundAllocation, FinanceAllocationTargetType } from "@/types";

type Row = FinanceFundAllocation & Record<string, unknown>;

const STATUS_COLOR: Record<string, string> = {
  ACTIVE: "bg-green-100 text-green-800 border-green-200",
  MODIFIED: "bg-orange-100 text-orange-800 border-orange-200",
  EXHAUSTED: "bg-red-100 text-red-800 border-red-200",
  CLOSED: "bg-gray-100 text-gray-800 border-gray-200",
};

const TARGET_TYPES: FinanceAllocationTargetType[] = ["DEPARTMENT", "PROJECT", "EVENT", "PURCHASE"];

const emptyCreateForm = () => ({ budgetId: "", targetType: "DEPARTMENT" as FinanceAllocationTargetType, targetName: "", amount: "" });
const emptyModifyForm = () => ({ remainingAmount: "", reason: "" });

export default function FinanceFundAllocationPage() {
  const [allocations, setAllocations] = useState<Row[]>([]);
  const [budgets, setBudgets] = useState<FinanceBudget[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState(emptyCreateForm());
  const [isSaving, setIsSaving] = useState(false);
  const [modifyTarget, setModifyTarget] = useState<Row | null>(null);
  const [modifyForm, setModifyForm] = useState(emptyModifyForm());
  const [isModifying, setIsModifying] = useState(false);

  function load() {
    setIsLoading(true);
    Promise.all([
      fetch("/api/college/finance-fund-allocations").then((r) => r.json() as Promise<{ allocations: Row[] }>).then((d) => d.allocations ?? []),
      fetch("/api/college/finance-budgets?status=ACTIVE").then((r) => r.json() as Promise<{ budgets: FinanceBudget[] }>).then((d) => d.budgets ?? []),
    ]).then(([a, b]) => { setAllocations(a); setBudgets(b); })
      .catch(() => toast({ variant: "destructive", title: "Failed to load allocations" }))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => { load(); }, []);

  async function handleCreate() {
    const { budgetId, targetType, targetName, amount } = createForm;
    if (!budgetId || !targetName || !amount) {
      toast({ variant: "destructive", title: "Fill in all required fields" });
      return;
    }
    setIsSaving(true);
    try {
      const res = await fetch("/api/college/finance-fund-allocations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ budgetId, targetType, targetName, amount: Number(amount) }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error);
      }
      toast({ variant: "success", title: "Funds allocated" });
      setCreateOpen(false);
      setCreateForm(emptyCreateForm());
      load();
    } catch (err) {
      toast({ variant: "destructive", title: "Failed to allocate funds", description: err instanceof Error ? err.message : undefined });
    } finally {
      setIsSaving(false);
    }
  }

  async function handleModify() {
    if (!modifyTarget) return;
    const { remainingAmount, reason } = modifyForm;
    if (!remainingAmount || !reason) {
      toast({ variant: "destructive", title: "Remaining amount and reason required" });
      return;
    }
    setIsModifying(true);
    try {
      const res = await fetch(`/api/college/finance-fund-allocations/${modifyTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ remainingAmount: Number(remainingAmount), reason }),
      });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "Allocation modified" });
      setModifyTarget(null);
      setModifyForm(emptyModifyForm());
      load();
    } catch {
      toast({ variant: "destructive", title: "Failed to modify allocation" });
    } finally {
      setIsModifying(false);
    }
  }

  const columns: Column<Row>[] = [
    { key: "targetName", header: "Allocated To" },
    { key: "targetType", header: "Type", render: (row) => <Badge variant="secondary">{row.targetType}</Badge> },
    { key: "amount", header: "Amount", render: (row) => formatCurrency(row.amount) },
    { key: "remainingAmount", header: "Remaining", render: (row) => formatCurrency(row.remainingAmount) },
    { key: "status", header: "Status", render: (row) => <Badge variant="outline" className={STATUS_COLOR[row.status]}>{row.status}</Badge> },
    {
      key: "actions", header: "", className: "text-right",
      render: (row) => (
        <Button size="sm" variant="outline" onClick={() => setModifyTarget(row)}>Modify</Button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fund Allocation"
        description="Allocate approved budgets to departments, projects, events, and purchases"
        actions={
          <Button onClick={() => setCreateOpen(true)} disabled={budgets.length === 0}>
            <Plus className="h-4 w-4 mr-1" />
            Allocate Funds
          </Button>
        }
      />

      <DataTable
        data={allocations}
        columns={columns}
        isLoading={isLoading}
        searchPlaceholder="Search by target name..."
        searchKeys={["targetName"]}
        csvFilename="finance-fund-allocations"
        emptyTitle="No allocations yet"
        emptyDescription="Allocate funds from an active budget to a department, project, event, or purchase."
        keyExtractor={(row) => row.id}
      />

      <Dialog open={createOpen} onOpenChange={(o) => { if (!o) setCreateForm(emptyCreateForm()); setCreateOpen(o); }}>
        <DialogContent className="max-w-md" aria-describedby={undefined}>
          <DialogHeader><DialogTitle>Allocate Funds</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Budget *</Label>
              <Select value={createForm.budgetId} onValueChange={(v) => setCreateForm((f) => ({ ...f, budgetId: v }))}>
                <SelectTrigger><SelectValue placeholder={budgets.length === 0 ? "No active budgets" : "Select budget..."} /></SelectTrigger>
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
              <Label>Allocate To (Type) *</Label>
              <Select value={createForm.targetType} onValueChange={(v) => setCreateForm((f) => ({ ...f, targetType: v as FinanceAllocationTargetType }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TARGET_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Name *</Label>
              <Input value={createForm.targetName} onChange={(e) => setCreateForm((f) => ({ ...f, targetName: e.target.value }))} placeholder="e.g. Annual Tech Fest" />
            </div>
            <div className="space-y-2">
              <Label>Amount *</Label>
              <Input type="number" value={createForm.amount} onChange={(e) => setCreateForm((f) => ({ ...f, amount: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={isSaving}>Cancel</Button>
            <Button onClick={() => void handleCreate()} loading={isSaving}>Allocate</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!modifyTarget} onOpenChange={(o) => { if (!o) { setModifyTarget(null); setModifyForm(emptyModifyForm()); } }}>
        <DialogContent className="max-w-md" aria-describedby={undefined}>
          <DialogHeader><DialogTitle>Modify Allocation — {modifyTarget?.targetName}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>New Remaining Amount *</Label>
              <Input type="number" value={modifyForm.remainingAmount} onChange={(e) => setModifyForm((f) => ({ ...f, remainingAmount: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Reason *</Label>
              <Textarea value={modifyForm.reason} onChange={(e) => setModifyForm((f) => ({ ...f, reason: e.target.value }))} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setModifyTarget(null)} disabled={isModifying}>Cancel</Button>
            <Button onClick={() => void handleModify()} loading={isModifying}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
