"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, History, FileText, RefreshCw } from "lucide-react";
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
import { BudgetCategorySection } from "@/components/shared/budget/BudgetCategorySection";
import { toast } from "@/hooks/useToast";
import { collegeFetch } from "@/lib/api/collegeFetch";
import { formatDate, formatDateTime, formatCurrency, stripLeadingZeros } from "@/lib/utils";
import { NON_RECURRING_CATEGORIES, RECURRING_CATEGORIES, type FinanceBudget, type BudgetRequest } from "@/types";

type BudgetRow = FinanceBudget & Record<string, unknown>;

interface DepartmentGroup extends Record<string, unknown> {
  department: string;
  count: number;
  totalAllocated: number;
  totalUtilized: number;
  totalRemaining: number;
  statusSummary: string;
  budgets: BudgetRow[];
}

const STATUS_COLOR: Record<string, string> = {
  ACTIVE: "bg-green-100 text-green-800 border-green-200",
  REVISED: "bg-orange-100 text-orange-800 border-orange-200",
  CLOSED: "bg-gray-100 text-gray-800 border-gray-200",
};

const emptyCreateForm = () => ({ department: "", purpose: "", fiscalYear: "", allocatedAmount: "" });
const emptyReviseForm = () => ({ revisedAmount: "", reason: "" });

function groupByDepartment(budgets: BudgetRow[]): DepartmentGroup[] {
  const map = new Map<string, BudgetRow[]>();
  for (const b of budgets) {
    const list = map.get(b.department) ?? [];
    list.push(b);
    map.set(b.department, list);
  }
  return Array.from(map.entries())
    .map(([department, rows]) => {
      const statusCounts: Record<string, number> = {};
      for (const r of rows) statusCounts[r.status] = (statusCounts[r.status] ?? 0) + 1;
      return {
        department,
        count: rows.length,
        totalAllocated: rows.reduce((s, r) => s + r.allocatedAmount, 0),
        totalUtilized: rows.reduce((s, r) => s + r.utilizedAmount, 0),
        totalRemaining: rows.reduce((s, r) => s + (r.allocatedAmount - r.utilizedAmount), 0),
        statusSummary: Object.entries(statusCounts)
          .map(([status, n]) => `${n} ${status.charAt(0)}${status.slice(1).toLowerCase()}`)
          .join(" · "),
        budgets: rows,
      };
    })
    .sort((a, b) => a.department.localeCompare(b.department));
}

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
  const [sourceRequest, setSourceRequest] = useState<BudgetRequest | null>(null);
  const [isLoadingSource, setIsLoadingSource] = useState(false);
  const [selectedDeptName, setSelectedDeptName] = useState<string | null>(null);

  const groups = useMemo(() => groupByDepartment(budgets), [budgets]);
  // Derived by name (not a captured object) so the dialog reflects live totals
  // after a Revise/Close reload recomputes `groups`, instead of freezing on
  // whatever snapshot was selected at click time.
  const selectedDept = groups.find((g) => g.department === selectedDeptName) ?? null;

  async function viewSourceRequest(requestId: string) {
    setIsLoadingSource(true);
    try {
      const res = await collegeFetch(`/api/college/budget-requests/${requestId}`);
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { request: BudgetRequest };
      setSourceRequest(data.request);
    } catch {
      toast({ variant: "destructive", title: "Failed to load original request" });
    } finally {
      setIsLoadingSource(false);
    }
  }

  function load() {
    setIsLoading(true);
    collegeFetch("/api/college/finance-budgets")
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
      const res = await collegeFetch("/api/college/finance-budgets", {
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
      const res = await collegeFetch(`/api/college/finance-budgets/${reviseTarget.id}`, {
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
      const res = await collegeFetch(`/api/college/finance-budgets/${budget.id}`, {
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

  const budgetColumns: Column<BudgetRow>[] = [
    { key: "purpose", header: "Purpose" },
    { key: "fiscalYear", header: "Financial Year" },
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
          {row.sourceRequestId && (
            <Button size="sm" variant="ghost" onClick={() => void viewSourceRequest(row.sourceRequestId as string)} loading={isLoadingSource}>
              <FileText className="h-3.5 w-3.5" />
            </Button>
          )}
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

  const groupColumns: Column<DepartmentGroup>[] = [
    { key: "department", header: "Department" },
    { key: "count", header: "Budgets", render: (g) => String(g.count) },
    { key: "totalAllocated", header: "Allocated", render: (g) => formatCurrency(g.totalAllocated) },
    { key: "totalUtilized", header: "Utilized", render: (g) => formatCurrency(g.totalUtilized) },
    { key: "totalRemaining", header: "Remaining", render: (g) => formatCurrency(g.totalRemaining) },
    { key: "statusSummary", header: "Status", hideOnMobile: true },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Budget Management"
        description="Allocate, revise, and monitor department budgets"
        actions={
          <>
            <Button variant="outline" size="sm" onClick={load} loading={isLoading}>
              <RefreshCw className="h-4 w-4 mr-1" />
              Refresh
            </Button>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4 mr-1" />
              New Budget
            </Button>
          </>
        }
      />

      <DataTable
        data={groups}
        columns={groupColumns}
        isLoading={isLoading}
        searchPlaceholder="Search by department..."
        searchKeys={["department"]}
        csvFilename="finance-budgets-by-department"
        emptyTitle="No budgets yet"
        emptyDescription="Create a budget to start tracking allocations and utilization."
        keyExtractor={(g) => g.department}
        onRowClick={(g) => setSelectedDeptName(g.department)}
      />

      {/* Department budget overview dialog */}
      <Dialog open={!!selectedDeptName} onOpenChange={(o) => { if (!o) setSelectedDeptName(null); }}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto" aria-describedby={undefined}>
          <DialogHeader><DialogTitle>Budget Overview — {selectedDept?.department}</DialogTitle></DialogHeader>
          {selectedDept && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground">Total Allocated</p>
                  <p className="text-lg font-semibold">{formatCurrency(selectedDept.totalAllocated)}</p>
                </div>
                <div className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground">Total Utilized</p>
                  <p className="text-lg font-semibold">{formatCurrency(selectedDept.totalUtilized)}</p>
                </div>
                <div className="rounded-md border p-3">
                  <p className="text-xs text-muted-foreground">Total Remaining</p>
                  <p className="text-lg font-semibold">{formatCurrency(selectedDept.totalRemaining)}</p>
                </div>
              </div>
              <DataTable
                data={selectedDept.budgets}
                columns={budgetColumns}
                searchPlaceholder="Search by purpose..."
                searchKeys={["purpose", "fiscalYear"]}
                csvFilename={`finance-budgets-${selectedDept.department}`}
                emptyTitle="No budgets"
                keyExtractor={(row) => row.id}
              />
            </div>
          )}
        </DialogContent>
      </Dialog>

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
                <Label>Financial Year *</Label>
                <Input value={createForm.fiscalYear} onChange={(e) => setCreateForm((f) => ({ ...f, fiscalYear: e.target.value }))} placeholder="2026-27" />
              </div>
              <div className="space-y-2">
                <Label>Allocated Amount *</Label>
                <Input type="number" value={createForm.allocatedAmount} onChange={(e) => setCreateForm((f) => ({ ...f, allocatedAmount: stripLeadingZeros(e.target.value) }))} placeholder="500000" />
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
              <Input type="number" value={reviseForm.revisedAmount} onChange={(e) => setReviseForm((f) => ({ ...f, revisedAmount: stripLeadingZeros(e.target.value) }))} />
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

      {/* Original request dialog */}
      <Dialog open={!!sourceRequest} onOpenChange={(o) => { if (!o) setSourceRequest(null); }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" aria-describedby={undefined}>
          <DialogHeader><DialogTitle>Original Request — {sourceRequest?.title}</DialogTitle></DialogHeader>
          {sourceRequest && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Submitted by {sourceRequest.hodName} ({sourceRequest.department}), academic year {sourceRequest.academicYear}
                {sourceRequest.requestDate ? `, requested on ${formatDateTime(new Date(sourceRequest.requestDate))}` : ""}
              </p>
              <BudgetCategorySection label="Non Recurring" categories={NON_RECURRING_CATEGORIES} groups={sourceRequest.nonRecurring} readOnly />
              <BudgetCategorySection label="Recurring" categories={RECURRING_CATEGORIES} groups={sourceRequest.recurring} readOnly />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
