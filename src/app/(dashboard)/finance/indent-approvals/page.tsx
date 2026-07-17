"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, CheckCircle, XCircle, RotateCcw, Building2, RefreshCw, ArrowRightLeft } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/shared/EmptyState";
import { CardSkeleton } from "@/components/shared/SkeletonLoader";
import { IndentItemsTable } from "@/components/shared/indent/IndentItemsTable";
import { QuotationsForm } from "@/components/shared/indent/QuotationsForm";
import { toast } from "@/hooks/useToast";
import { collegeFetch } from "@/lib/api/collegeFetch";
import { useAuthStore } from "@/store/authStore";
import { formatCurrency, formatDate } from "@/lib/utils";
import { indentItemsTotal, INDENT_REQUEST_TYPE_LABELS, type College, type IndentRequest } from "@/types";

type OverviewIndent = IndentRequest & { collegeId: string; collegeName: string; locationId: string; locationName: string };

const SCOPES = ["COLLEGE", "LOCATION", "ALL"] as const;
type ApprovalScope = (typeof SCOPES)[number];
const SCOPE_LABELS: Record<ApprovalScope, string> = {
  COLLEGE: "This College",
  LOCATION: "This Location",
  ALL: "All Locations",
};

export default function FinanceIndentApprovalsPage() {
  const selectedCollegeId = useAuthStore((s) => s.selectedCollegeId);
  const setSelectedCollegeId = useAuthStore((s) => s.setSelectedCollegeId);
  const [scope, setScope] = useState<ApprovalScope>("COLLEGE");
  const [requests, setRequests] = useState<OverviewIndent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  const [mode, setMode] = useState<"idle" | "approve" | "reject" | "return">("idle");
  const [remarks, setRemarks] = useState("");

  // Actions mutate whichever college collegeFetch() currently targets
  // (selectedCollegeId), so only the "This College" scope is safe to act on
  // inline — an aggregated Location/All list must stay read-only to avoid
  // ever approving/rejecting an item against the wrong college.
  const actionable = scope === "COLLEGE";

  async function load() {
    setIsLoading(true);
    try {
      if (scope === "COLLEGE") {
        const d = await collegeFetch("/api/college/indent-requests?status=PENDING_FINANCE_REVIEW")
          .then((r) => r.json() as Promise<{ requests: OverviewIndent[] }>);
        setRequests(d.requests ?? []);
      } else {
        const params = new URLSearchParams({ status: "PENDING_FINANCE_REVIEW" });
        if (scope === "LOCATION") {
          if (!selectedCollegeId) { setRequests([]); return; }
          const colleges = await fetch("/api/admin/colleges").then((r) => r.json() as Promise<{ colleges: College[] }>).then((d) => d.colleges ?? []);
          const current = colleges.find((c) => c.id === selectedCollegeId);
          if (!current?.locationId) { setRequests([]); return; }
          params.set("locationId", current.locationId);
        }
        const d = await fetch(`/api/purchase/indents/overview?${params.toString()}`)
          .then((r) => r.json() as Promise<{ indents: OverviewIndent[] }>);
        setRequests(d.indents ?? []);
      }
    } catch {
      toast({ variant: "destructive", title: "Failed to load incoming indents" });
    } finally {
      setIsLoading(false);
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps -- load() intentionally re-reads current scope/selectedCollegeId; only they should re-trigger the fetch
  useEffect(() => { void load(); }, [scope, selectedCollegeId]);

  function switchToCollege(item: OverviewIndent) {
    setSelectedCollegeId(item.collegeId);
    setScope("COLLEGE");
    setExpandedId(item.id);
  }

  function resetAction() {
    setMode("idle");
    setRemarks("");
  }

  async function act(request: IndentRequest, action: "APPROVE" | "REJECT" | "RETURN") {
    if ((action === "REJECT" || action === "RETURN") && !remarks.trim()) {
      toast({ variant: "destructive", title: "Remarks are required" });
      return;
    }
    setActingId(request.id);
    try {
      const res = await collegeFetch(`/api/college/indent-requests/${request.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, remarks: remarks.trim() || undefined }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? "Action failed");
      }
      toast({
        variant: "success",
        title:
          action === "APPROVE" ? "Indent approved & payment created"
          : action === "REJECT" ? "Indent rejected"
          : request.requestType === "NON_GOODS" ? "Indent returned to HOD"
          : "Indent returned to Purchase Dept",
      });
      setExpandedId(null);
      resetAction();
      void load();
    } catch (err) {
      toast({ variant: "destructive", title: "Action failed", description: err instanceof Error ? err.message : undefined });
    } finally {
      setActingId(null);
    }
  }

  const refreshButton = (
    <div className="flex items-center justify-end gap-2">
      <Select value={scope} onValueChange={(v) => setScope(v as ApprovalScope)}>
        <SelectTrigger className="w-40">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SCOPES.map((s) => (
            <SelectItem key={s} value={s}>{SCOPE_LABELS[s]}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button variant="outline" size="sm" onClick={() => void load()} loading={isLoading}>
        <RefreshCw className="h-3.5 w-3.5 mr-1" />
        Refresh
      </Button>
    </div>
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Indent Approvals"
        description={
          actionable
            ? "Review quotations sourced by Purchase Dept and disburse approved indents"
            : "Read-only view across the selected scope — switch to a specific college to act on an indent"
        }
      />

      {isLoading ? (
        <div className="space-y-3">
          {refreshButton}
          {[1, 2].map((i) => <CardSkeleton key={i} />)}
        </div>
      ) : requests.length === 0 ? (
        <div className="space-y-3">
          {refreshButton}
          <EmptyState
            title="No indents awaiting Finance"
            description="Indents forwarded by Purchase Dept with vendor quotations will appear here."
            icon={<Building2 className="h-8 w-8" />}
          />
        </div>
      ) : (
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
                      <div className="flex items-center gap-2">
                        <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                        <span className="font-semibold text-sm">{item.department}</span>
                        <Badge variant="secondary" className="text-xs">{formatCurrency(indentItemsTotal(item.items))}</Badge>
                        {item.requestType && (
                          <Badge variant="outline" className="text-xs">{INDENT_REQUEST_TYPE_LABELS[item.requestType]}</Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">{item.title}{!actionable ? ` · ${item.collegeName}` : ""}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant="outline" className="text-xs bg-blue-100 text-blue-800 border-blue-200">
                        Pending Finance
                      </Badge>
                      {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                    </div>
                  </div>
                </CardHeader>

                {isExpanded && (
                  <CardContent className="pt-0 space-y-4">
                    <p className="text-xs text-muted-foreground">
                      {item.requestType === "NON_GOODS"
                        ? `Raised directly by ${item.hodName} on ${formatDate(item.createdAt)}`
                        : `Raised by ${item.hodName}, forwarded by Purchase Dept on ${formatDate(item.updatedAt)}`}
                    </p>
                    <IndentItemsTable items={item.items} readOnly />
                    {item.requestType !== "NON_GOODS" && (
                      <QuotationsForm quotations={item.quotations} selectedQuotationId={item.selectedQuotationId} readOnly />
                    )}

                    {!actionable && (
                      <div className="pt-2 border-t">
                        <Button size="sm" variant="outline" onClick={() => switchToCollege(item)}>
                          <ArrowRightLeft className="h-3.5 w-3.5 mr-1" />
                          Switch to {item.collegeName} to act
                        </Button>
                      </div>
                    )}

                    {actionable && mode === "idle" && (
                      <div className="flex flex-wrap gap-2 pt-2 border-t">
                        <Button
                          size="sm"
                          className="bg-green-600 hover:bg-green-700 text-white"
                          disabled={actingId !== null}
                          loading={isActingThis}
                          onClick={() => void act(item, "APPROVE")}
                        >
                          <CheckCircle className="h-3.5 w-3.5 mr-1" />
                          Approve & Disburse
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
