"use client";

import { useEffect, useState } from "react";
import { Plus, ClipboardCheck, Building2 } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { ApprovalWorkflowList } from "@/components/finance/ApprovalWorkflowList";
import { IncomingBudgetRequests } from "./IncomingBudgetRequests";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import { formatCurrency, formatDate } from "@/lib/utils";
import type { FinanceBudgetRequest } from "@/types";

type Row = FinanceBudgetRequest & { id: string; status: string };

const emptyForm = () => ({ department: "", requestedAmount: "", purpose: "", justification: "" });

export default function FinanceBudgetApprovalsPage() {
  const [requests, setRequests] = useState<Row[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [isSaving, setIsSaving] = useState(false);

  function load() {
    setIsLoading(true);
    fetch("/api/college/finance-budget-requests")
      .then((r) => r.json() as Promise<{ requests: Row[] }>)
      .then((d) => setRequests(d.requests ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load budget requests" }))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => { load(); }, []);

  async function handleCreate() {
    const { department, requestedAmount, purpose, justification } = form;
    if (!department || !requestedAmount || !purpose) {
      toast({ variant: "destructive", title: "Fill in all required fields" });
      return;
    }
    setIsSaving(true);
    try {
      const res = await fetch("/api/college/finance-budget-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ department, requestedAmount: Number(requestedAmount), purpose, justification }),
      });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "Budget request logged" });
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
        title="Budget Approvals"
        description="Review, approve, reject, or return department budget requests"
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

      <div className="space-y-3">
        <h2 className="text-base font-semibold">Incoming from Departments</h2>
        <p className="text-sm text-muted-foreground -mt-2">
          Requests HODs submitted and Principals verified (Level 1 freeze) — approving one creates the budget automatically.
        </p>
        <IncomingBudgetRequests />
      </div>

      <div className="space-y-3">
        <h2 className="text-base font-semibold">Manually Logged Requests</h2>
        <ApprovalWorkflowList
          items={requests}
          isLoading={isLoading}
          patchUrl={(item) => `/api/college/finance-budget-requests/${item.id}`}
          onChanged={load}
          emptyTitle="No budget requests"
          emptyDescription="Log a budget request received from a department to start the approval workflow."
          icon={<ClipboardCheck className="h-8 w-8" />}
          renderSummary={(item) => (
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="font-semibold text-sm">{item.department}</span>
                <Badge variant="secondary" className="text-xs">{formatCurrency(item.requestedAmount)}</Badge>
              </div>
              <p className="text-xs text-muted-foreground">{item.purpose}</p>
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
      </div>

      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) setForm(emptyForm()); setDialogOpen(o); }}>
        <DialogContent className="max-w-md" aria-describedby={undefined}>
          <DialogHeader><DialogTitle>Log Budget Request</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Department *</Label>
              <Input value={form.department} onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))} placeholder="e.g. Mechanical Engineering" />
            </div>
            <div className="space-y-2">
              <Label>Requested Amount *</Label>
              <Input type="number" value={form.requestedAmount} onChange={(e) => setForm((f) => ({ ...f, requestedAmount: e.target.value }))} />
            </div>
            <div className="space-y-2">
              <Label>Purpose *</Label>
              <Input value={form.purpose} onChange={(e) => setForm((f) => ({ ...f, purpose: e.target.value }))} placeholder="e.g. New lab equipment" />
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
