"use client";

import { useEffect, useState } from "react";
import { Plus, ShoppingCart, Building2, ChevronDown, ChevronUp } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { CardSkeleton } from "@/components/shared/SkeletonLoader";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import type { FinanceBudget, FinancePurchaseClearance } from "@/types";

type Row = FinancePurchaseClearance & { id: string; status: string };

const STATUS_STYLES: Record<string, string> = {
  PENDING: "bg-yellow-100 text-yellow-800 border-yellow-200",
  APPROVED: "bg-green-100 text-green-800 border-green-200",
  REJECTED: "bg-red-100 text-red-800 border-red-200",
  RETURNED: "bg-orange-100 text-orange-800 border-orange-200",
};

const emptyForm = () => ({ department: "", requestedByName: "", items: "", estimatedAmount: "", budgetId: "" });

export default function PurchaseRequestsPage() {
  const [requests, setRequests] = useState<Row[]>([]);
  const [budgets, setBudgets] = useState<FinanceBudget[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [isSaving, setIsSaving] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

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
      toast({ variant: "success", title: "Purchase request sent to Finance" });
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
        title="Purchase Requests"
        description="Log purchase requests and track their clearance status with Finance"
        actions={
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="h-4 w-4 mr-1" />
            Log Request
          </Button>
        }
      />

      <Card>
        <CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Awaiting Finance Clearance</p>
          <p className="text-2xl font-bold text-yellow-600">{isLoading ? "…" : pending.length}</p>
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="space-y-3">{[1, 2, 3].map((i) => <CardSkeleton key={i} />)}</div>
      ) : requests.length === 0 ? (
        <EmptyState
          title="No purchase requests"
          description="Log a purchase request to send it to Finance for clearance."
          icon={<ShoppingCart className="h-8 w-8" />}
        />
      ) : (
        <div className="space-y-3">
          {requests.map((item) => {
            const isExpanded = expandedId === item.id;
            return (
              <Card key={item.id}>
                <CardHeader
                  className="pb-3 cursor-pointer"
                  onClick={() => setExpandedId(isExpanded ? null : item.id)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                        <span className="font-semibold text-sm">{item.department}</span>
                        <Badge variant="secondary" className="text-xs">{formatCurrency(item.estimatedAmount)}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">{item.items}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant="outline" className={cn("text-xs", STATUS_STYLES[item.status])}>
                        {item.status}
                      </Badge>
                      {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                    </div>
                  </div>
                </CardHeader>

                {isExpanded && (
                  <CardContent className="pt-0 space-y-2 text-sm">
                    <p className="text-xs text-muted-foreground">
                      Requested by {item.requestedByName}, logged by {item.loggedByName} on {formatDate(item.createdAt)}
                    </p>
                    {item.financeComments && (
                      <div>
                        <span className="text-xs uppercase tracking-wide text-muted-foreground">Finance Comments</span>
                        <p className="mt-1 rounded bg-muted/40 p-2">{item.financeComments}</p>
                      </div>
                    )}
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}

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
