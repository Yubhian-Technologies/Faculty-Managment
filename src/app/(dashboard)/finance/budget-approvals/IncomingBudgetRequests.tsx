"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, CheckCircle, XCircle, RotateCcw, Building2, RefreshCw, AlertTriangle, Flag } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/shared/EmptyState";
import { CardSkeleton } from "@/components/shared/SkeletonLoader";
import { BudgetCategorySection } from "@/components/shared/budget/BudgetCategorySection";
import { toast } from "@/hooks/useToast";
import { formatCurrency, formatDate } from "@/lib/utils";
import { budgetRequestTotal, NON_RECURRING_CATEGORIES, RECURRING_CATEGORIES, type BudgetRequest } from "@/types";

type Row = BudgetRequest & { collegeId: string; collegeName: string };

function defaultFiscalYear(): string {
  const d = new Date();
  const startYear = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1; // FY starts April
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

export function IncomingBudgetRequests() {
  const [requests, setRequests] = useState<Row[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  const [mode, setMode] = useState<"idle" | "approve" | "reject" | "return" | "reconsider">("idle");
  const [fiscalYear, setFiscalYear] = useState(defaultFiscalYear());
  const [remarks, setRemarks] = useState("");
  // Items left unticked ("not approved") land here awaiting a per-item reason —
  // ticked items need no entry at all, since ticked == approved is the default.
  // itemId -> "title (category)"
  const [flaggedItems, setFlaggedItems] = useState<Record<string, string>>({});
  // itemId -> Finance's reason that specific item can't be approved as-is.
  const [itemReasons, setItemReasons] = useState<Record<string, string>>({});

  function load() {
    setIsLoading(true);
    // FINANCE is a GLOBAL role overseeing every college — this must fan out
    // across all of them, not just whichever college happens to be the
    // sidebar's currently "selected" one (see /api/finance/budget-requests/overview).
    fetch("/api/finance/budget-requests/overview?status=L1_FROZEN")
      .then((r) => r.json() as Promise<{ requests: Row[] }>)
      .then((d) => {
        const sorted = [...(d.requests ?? [])].sort(
          (a, b) => new Date(a.requestDate).getTime() - new Date(b.requestDate).getTime()
        );
        setRequests(sorted);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load incoming budget requests" }))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => { load(); }, []);

  function resetAction() {
    setMode("idle");
    setFiscalYear(defaultFiscalYear());
    setRemarks("");
    setFlaggedItems({});
    setItemReasons({});
  }

  function toggleFlag(itemId: string, label: string) {
    setFlaggedItems((prev) => {
      const next = { ...prev };
      if (next[itemId]) delete next[itemId];
      else next[itemId] = label;
      return next;
    });
    // Un-ticking back to "approved" drops any reason that was attached.
    setItemReasons((prev) => {
      if (!(itemId in prev)) return prev;
      const next = { ...prev };
      delete next[itemId];
      return next;
    });
  }

  function setItemReason(itemId: string, reason: string) {
    setItemReasons((prev) => ({ ...prev, [itemId]: reason }));
  }

  const allFlaggedItemsHaveReasons = Object.keys(flaggedItems).every((id) => itemReasons[id]?.trim());

  function reconsiderRemarks(): string {
    return Object.entries(flaggedItems)
      .map(([itemId, label]) => `${label}: ${itemReasons[itemId]?.trim() || "(no reason provided)"}`)
      .join("\n");
  }

  async function act(request: Row, action: "APPROVE" | "REJECT" | "RETURN", remarksOverride?: string) {
    const effectiveRemarks = remarksOverride ?? remarks;
    if (action === "APPROVE" && !fiscalYear.trim()) {
      toast({ variant: "destructive", title: "Financial year is required" });
      return;
    }
    if ((action === "REJECT" || action === "RETURN") && !effectiveRemarks.trim()) {
      toast({ variant: "destructive", title: "Remarks are required" });
      return;
    }
    setActingId(request.id);
    try {
      // Target this request's own college explicitly — it may not be whichever
      // college the sidebar currently has "selected" (see load() above).
      const res = await fetch(`/api/college/budget-requests/${request.id}?collegeId=${encodeURIComponent(request.collegeId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          fiscalYear: action === "APPROVE" ? fiscalYear.trim() : undefined,
          remarks: effectiveRemarks.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? "Action failed");
      }
      toast({
        variant: "success",
        title: action === "APPROVE" ? "Budget created from request" : action === "REJECT" ? "Request rejected" : "Request returned to HOD",
      });
      setExpandedId(null);
      resetAction();
      load();
    } catch (err) {
      toast({ variant: "destructive", title: "Action failed", description: err instanceof Error ? err.message : undefined });
    } finally {
      setActingId(null);
    }
  }

  const refreshButton = (
    <div className="flex justify-end">
      <Button variant="outline" size="sm" onClick={load} loading={isLoading}>
        <RefreshCw className="h-3.5 w-3.5 mr-1" />
        Refresh
      </Button>
    </div>
  );

  if (isLoading) {
    return (
      <div className="space-y-3">
        {refreshButton}
        {[1, 2].map((i) => <CardSkeleton key={i} />)}
      </div>
    );
  }

  if (requests.length === 0) {
    return (
      <div className="space-y-3">
        {refreshButton}
        <EmptyState
          title="No requests awaiting Finance"
          description="Budget requests verified by a Principal (Level 1 freeze) will appear here."
          icon={<Building2 className="h-8 w-8" />}
        />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {refreshButton}
      {requests.map((item) => {
        const isExpanded = expandedId === item.id;
        const isActingThis = actingId === item.id;

        return (
          <Card key={item.id}>
            <CardHeader
              className="pb-3 cursor-pointer"
              onClick={() => {
                resetAction();
                setExpandedId(isExpanded ? null : item.id);
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex-1 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="font-semibold text-sm">{item.department}</span>
                    <Badge variant="secondary" className="text-xs">{formatCurrency(budgetRequestTotal(item))}</Badge>
                    {item.isEmergency && (
                      <Badge variant="destructive" className="text-xs gap-1">
                        <AlertTriangle className="h-3 w-3" />
                        Emergency · {item.emergencyType === "GOODS" ? "Goods" : "Non-Goods"}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">{item.title} · {item.collegeName}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant="outline" className="text-xs bg-blue-100 text-blue-800 border-blue-200">
                    Level 1 Freeze
                  </Badge>
                  {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                </div>
              </div>
            </CardHeader>

            {isExpanded && (
              <CardContent className="pt-0 space-y-3">
                <p className="text-xs text-muted-foreground">
                  Requested by {item.hodName}, verified by Principal on {formatDate(item.updatedAt)}
                </p>
                <BudgetCategorySection
                  label="Non Recurring"
                  categories={NON_RECURRING_CATEGORIES}
                  groups={item.nonRecurring}
                  readOnly
                  selectable
                  selectedIds={new Set(Object.keys(flaggedItems))}
                  onToggleItem={toggleFlag}
                  itemReasons={itemReasons}
                  onReasonChange={setItemReason}
                />
                <BudgetCategorySection
                  label="Recurring"
                  categories={RECURRING_CATEGORIES}
                  groups={item.recurring}
                  readOnly
                  selectable
                  selectedIds={new Set(Object.keys(flaggedItems))}
                  onToggleItem={toggleFlag}
                  itemReasons={itemReasons}
                  onReasonChange={setItemReason}
                />

                {mode === "idle" && (
                  <div className="flex flex-wrap gap-2 pt-2 border-t">
                    <Button
                      size="sm"
                      className="bg-green-600 hover:bg-green-700 text-white"
                      disabled={actingId !== null}
                      onClick={() => setMode("approve")}
                    >
                      <CheckCircle className="h-3.5 w-3.5 mr-1" />
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="border-orange-300 text-orange-700 hover:bg-orange-50"
                      disabled={actingId !== null}
                      onClick={() => setMode("return")}
                    >
                      <RotateCcw className="h-3.5 w-3.5 mr-1" />
                      Return for Correction
                    </Button>
                    {Object.keys(flaggedItems).length > 0 && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-red-400 text-red-700 hover:bg-red-50"
                        disabled={actingId !== null}
                        onClick={() => setMode("reconsider")}
                      >
                        <Flag className="h-3.5 w-3.5 mr-1" />
                        Return Items Not Approved ({Object.keys(flaggedItems).length})
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={actingId !== null}
                      onClick={() => setMode("reject")}
                    >
                      <XCircle className="h-3.5 w-3.5 mr-1" />
                      Reject
                    </Button>
                  </div>
                )}

                {mode === "approve" && (
                  <div className="space-y-2 rounded-md border border-green-300/60 bg-green-50 p-3 pt-2 border-t">
                    <Label className="text-sm font-medium">Financial Year</Label>
                    <Input
                      value={fiscalYear}
                      onChange={(e) => setFiscalYear(e.target.value)}
                      placeholder="e.g. 2026-27"
                      disabled={isActingThis}
                      className="bg-background"
                    />
                    <div className="flex gap-2">
                      <Button size="sm" className="bg-green-600 hover:bg-green-700 text-white" loading={isActingThis} onClick={() => void act(item, "APPROVE")}>
                        Confirm Approve
                      </Button>
                      <Button size="sm" variant="ghost" onClick={resetAction} disabled={isActingThis}>Cancel</Button>
                    </div>
                  </div>
                )}

                {mode === "reconsider" && (
                  <div className="space-y-3 rounded-md border border-red-300/60 bg-red-50 p-3 pt-2 border-t">
                    <div className="space-y-1.5">
                      <Label className="text-sm font-medium text-red-800">Items not approved</Label>
                      <div className="space-y-1.5 rounded-md border bg-background p-2">
                        {Object.keys(flaggedItems).length === 0 ? (
                          <p className="text-xs text-muted-foreground">No items unticked — untick items above first.</p>
                        ) : (
                          Object.entries(flaggedItems).map(([itemId, label]) => (
                            <div key={itemId} className="text-sm space-y-0.5">
                              <p className="font-medium">{label}</p>
                              <p className={`text-xs ${itemReasons[itemId]?.trim() ? "text-muted-foreground" : "text-destructive"}`}>
                                {itemReasons[itemId]?.trim() || "No reason added yet — click \"Add Reason\" on this item above."}
                              </p>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        className="bg-red-600 hover:bg-red-700 text-white"
                        loading={isActingThis}
                        disabled={Object.keys(flaggedItems).length === 0 || !allFlaggedItemsHaveReasons}
                        onClick={() => void act(item, "RETURN", reconsiderRemarks())}
                      >
                        Send Back to HOD
                      </Button>
                      <Button size="sm" variant="ghost" onClick={resetAction} disabled={isActingThis}>Cancel</Button>
                    </div>
                  </div>
                )}

                {(mode === "reject" || mode === "return") && (
                  <div className={`space-y-2 rounded-md border p-3 pt-2 border-t ${mode === "reject" ? "border-red-300/60 bg-red-50" : "border-orange-300/60 bg-orange-50"}`}>
                    <Label className="text-sm font-medium">Remarks</Label>
                    <Textarea
                      value={remarks}
                      onChange={(e) => setRemarks(e.target.value)}
                      placeholder="What needs to change, or why is this rejected?"
                      rows={2}
                      disabled={isActingThis}
                      className="resize-none text-sm bg-background"
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        className={mode === "reject" ? "bg-red-600 hover:bg-red-700 text-white" : "bg-orange-600 hover:bg-orange-700 text-white"}
                        loading={isActingThis}
                        onClick={() => void act(item, mode === "reject" ? "REJECT" : "RETURN")}
                      >
                        Confirm {mode === "reject" ? "Reject" : "Return"}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={resetAction} disabled={isActingThis}>Cancel</Button>
                    </div>
                  </div>
                )}
              </CardContent>
            )}
          </Card>
        );
      })}
    </div>
  );
}
