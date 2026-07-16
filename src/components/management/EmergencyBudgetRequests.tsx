"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, CheckCircle, XCircle, RotateCcw, Building2, RefreshCw, AlertTriangle, Eye } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { EmptyState } from "@/components/shared/EmptyState";
import { CardSkeleton } from "@/components/shared/SkeletonLoader";
import { BudgetCategorySection } from "@/components/shared/budget/BudgetCategorySection";
import { toast } from "@/hooks/useToast";
import { formatCurrency, formatDate } from "@/lib/utils";
import { budgetRequestTotal, NON_RECURRING_CATEGORIES, RECURRING_CATEGORIES, type BudgetRequest } from "@/types";

type Row = BudgetRequest & { collegeName: string };

// Emergency budget requests (Principal/VP -> Management -> Finance), reviewed here as
// a section of the Management Budget tab. Cross-college by nature (Management has no
// collegeId), so this pulls from the collectionGroup-backed
// /api/management/emergency-budget-requests endpoint rather than any single college's
// budget view.
export function EmergencyBudgetRequests() {
  const [requests, setRequests] = useState<Row[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  const [mode, setMode] = useState<"idle" | "reject" | "return">("idle");
  const [remarks, setRemarks] = useState("");

  function load() {
    setIsLoading(true);
    fetch("/api/management/emergency-budget-requests")
      .then((r) => r.json() as Promise<{ requests: Row[] }>)
      .then((d) => setRequests(d.requests ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load emergency budget requests" }))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => { load(); }, []);

  function resetAction() {
    setMode("idle");
    setRemarks("");
  }

  async function act(item: Row, action: "APPROVE" | "REJECT" | "RETURN") {
    if ((action === "REJECT" || action === "RETURN") && !remarks.trim()) {
      toast({ variant: "destructive", title: "Remarks are required" });
      return;
    }
    setActingId(item.id);
    try {
      const res = await fetch(`/api/management/emergency-budget-requests/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ collegeId: item.collegeId, action, remarks: remarks.trim() || undefined }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? "Action failed");
      }
      toast({
        variant: "success",
        title: action === "APPROVE" ? "Approved — sent to Finance" : action === "REJECT" ? "Request rejected" : "Request returned to requester",
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

  return (
    <div className="space-y-3">
      <Card>
        <CardContent className="p-4">
          <p className="text-xs text-muted-foreground">Pending Requests</p>
          <p className="text-2xl font-bold text-yellow-600">{isLoading ? "…" : requests.length}</p>
        </CardContent>
      </Card>

      {refreshButton}

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2].map((i) => <CardSkeleton key={i} />)}
        </div>
      ) : requests.length === 0 ? (
        <EmptyState
          title="No emergency requests pending"
          description="Emergency budget requests raised by a Principal or Vice Principal will appear here."
          icon={<AlertTriangle className="h-8 w-8" />}
        />
      ) : (
        <div className="space-y-3">
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
                        <span className="font-semibold text-sm">{item.collegeName}</span>
                        <Badge variant="secondary" className="text-xs">{formatCurrency(budgetRequestTotal(item))}</Badge>
                        <Badge variant="destructive" className="text-xs gap-1">
                          <AlertTriangle className="h-3 w-3" />
                          Emergency · {item.emergencyType === "GOODS" ? "Goods" : "Non-Goods"}
                        </Badge>
                        <StatusBadge status={item.status} />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {item.title} — {item.department} — AY {item.academicYear} — requested by {item.hodName}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={(e) => {
                          e.stopPropagation();
                          resetAction();
                          setExpandedId(isExpanded ? null : item.id);
                        }}
                      >
                        <Eye className="h-3.5 w-3.5 mr-1" />
                        View Details
                      </Button>
                      {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />}
                    </div>
                  </div>
                </CardHeader>

                {isExpanded && (
                  <CardContent className="pt-0 space-y-3">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                      <div>
                        <Label className="text-xs text-muted-foreground font-normal">Academic Year</Label>
                        <p className="font-medium">{item.academicYear}</p>
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground font-normal">Raised Date</Label>
                        <p className="font-medium">{formatDate(item.createdAt)}</p>
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground font-normal">Grand Total</Label>
                        <p className="font-medium">{formatCurrency(budgetRequestTotal(item))}</p>
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground font-normal">Status</Label>
                        <div className="font-medium"><StatusBadge status={item.status} /></div>
                      </div>
                    </div>
                    <div className="rounded-md border bg-muted/40 p-3 text-sm">
                      <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Emergency Reason</p>
                      <p>{item.emergencyReason}</p>
                    </div>
                    <BudgetCategorySection label="Non Recurring" categories={NON_RECURRING_CATEGORIES} groups={item.nonRecurring} readOnly />
                    <BudgetCategorySection label="Recurring" categories={RECURRING_CATEGORIES} groups={item.recurring} readOnly />

                    {item.history?.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">History</p>
                        {item.history.map((h, i) => (
                          <div key={i} className="rounded-md border p-2 text-xs space-y-0.5">
                            <div className="flex justify-between font-medium">
                              <span>{h.action}</span>
                              <span className="text-muted-foreground">{formatDate(h.at)}</span>
                            </div>
                            <p className="text-muted-foreground">by {h.byName} ({h.byRole})</p>
                            {h.remarks && <p className="text-muted-foreground">{h.remarks}</p>}
                          </div>
                        ))}
                      </div>
                    )}

                    {mode === "idle" && (
                      <div className="flex flex-wrap gap-2 pt-2 border-t">
                        <Button
                          size="sm"
                          className="bg-green-600 hover:bg-green-700 text-white"
                          disabled={actingId !== null}
                          loading={isActingThis}
                          onClick={() => void act(item, "APPROVE")}
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
      )}
    </div>
  );
}
