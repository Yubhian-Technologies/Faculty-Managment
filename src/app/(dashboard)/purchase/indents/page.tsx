"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Building2, ShoppingCart, X } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/EmptyState";
import { CardSkeleton } from "@/components/shared/SkeletonLoader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { IndentStatusBadge } from "@/components/shared/indent/IndentStatusBadge";
import { toast } from "@/hooks/useToast";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import {
  PURCHASE_CLEARANCE_STATUS_LABELS,
  indentItemsTotal,
  type FinancePurchaseClearance,
  type IndentRequest,
} from "@/types";

type OverviewIndent = IndentRequest & { collegeName: string; locationId: string; locationName: string };
type ClearanceRow = FinancePurchaseClearance & { id: string; status: string; collegeName: string; locationId: string; locationName: string };

// Purchase Dept reviews and acts on every stage of these requests here —
// from initial quotation-sourcing through to purchase — instead of on a
// separate Purchase Requests page.
const CLEARANCE_STATUS_STYLES: Record<string, string> = {
  PENDING_PURCHASE_REVIEW: "bg-yellow-100 text-yellow-800 border-yellow-200",
  REJECTED_BY_PURCHASE: "bg-red-100 text-red-800 border-red-200",
  RETURNED_TO_HOD: "bg-orange-100 text-orange-800 border-orange-200",
  PENDING_FINANCE_REVIEW: "bg-yellow-100 text-yellow-800 border-yellow-200",
  RETURNED_TO_PURCHASE: "bg-orange-100 text-orange-800 border-orange-200",
  REJECTED: "bg-red-100 text-red-800 border-red-200",
  APPROVED: "bg-green-100 text-green-800 border-green-200",
  GOODS_PURCHASED: "bg-blue-100 text-blue-800 border-blue-200",
  COMPLETED: "bg-emerald-100 text-emerald-800 border-emerald-200",
};

export default function PurchaseIndentsPage() {
  const searchParams = useSearchParams();
  const departmentFilter = searchParams.get("department");
  const locationId = searchParams.get("locationId");
  const collegeId = searchParams.get("collegeId");
  const requestType = searchParams.get("requestType");
  const [requests, setRequests] = useState<OverviewIndent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [clearanceRequests, setClearanceRequests] = useState<ClearanceRow[]>([]);
  const [isLoadingClearance, setIsLoadingClearance] = useState(true);

  useEffect(() => {
    const params = new URLSearchParams();
    if (locationId) params.set("locationId", locationId);
    if (collegeId) params.set("collegeId", collegeId);
    if (requestType) params.set("requestType", requestType);
    const query = params.toString();

    setIsLoading(true);
    setIsLoadingClearance(true);
    fetch(`/api/purchase/indents/overview?${query}`)
      .then((r) => r.json() as Promise<{ indents: OverviewIndent[]; clearances: ClearanceRow[] }>)
      .then((d) => {
        setRequests(d.indents ?? []);
        setClearanceRequests(d.clearances ?? []);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load indent requests" }))
      .finally(() => {
        setIsLoading(false);
        setIsLoadingClearance(false);
      });
  }, [locationId, collegeId, requestType]);

  const filteredRequests = departmentFilter ? requests.filter((r) => r.department === departmentFilter) : requests;
  const filteredClearanceRequests = departmentFilter ? clearanceRequests.filter((r) => r.department === departmentFilter) : clearanceRequests;

  const grouped: Record<string, OverviewIndent[]> = {};
  for (const r of filteredRequests) {
    (grouped[r.department] ??= []).push(r);
  }
  const departments = Object.keys(grouped).sort((a, b) => a.localeCompare(b));

  const hasScope = !!(departmentFilter || locationId || collegeId || requestType);
  const scopeLabel = collegeId
    ? filteredRequests[0]?.collegeName ?? filteredClearanceRequests[0]?.collegeName
    : locationId
      ? filteredRequests[0]?.locationName ?? filteredClearanceRequests[0]?.locationName
      : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Indent Requests"
        description={
          hasScope
            ? "Indents raised by departments, grouped for sourcing quotations"
            : "Org-wide — indents across every location and college, grouped by department"
        }
      />

      {hasScope && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {scopeLabel && (
            <>
              <span className="text-muted-foreground">Scope:</span>
              <Badge variant="outline">{scopeLabel}</Badge>
            </>
          )}
          {departmentFilter && (
            <>
              <span className="text-muted-foreground">Department:</span>
              <Badge variant="outline">{departmentFilter}</Badge>
            </>
          )}
          <Button variant="ghost" size="sm" asChild className="h-7 px-2">
            <Link href="/purchase/indents"><X className="h-3 w-3 mr-1" />Clear</Link>
          </Button>
        </div>
      )}

      <div className="space-y-3">
        <h2 className="text-base font-semibold">Purchase Clearance Requests</h2>
        {isLoadingClearance ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => <CardSkeleton key={i} />)}
          </div>
        ) : filteredClearanceRequests.length === 0 ? (
          <EmptyState
            title="No purchase clearance requests"
            description="Requests raised by HODs will appear here for quotation sourcing and purchase."
            icon={<ShoppingCart className="h-8 w-8" />}
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filteredClearanceRequests.map((item) => (
              <Link key={item.id} href={`/purchase/clearance/${item.id}`}>
                <Card className="hover:shadow-md transition-shadow cursor-pointer h-full">
                  <CardContent className="p-4 space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-semibold text-sm">{item.department}</span>
                      <Badge variant="outline" className={cn("text-xs", CLEARANCE_STATUS_STYLES[item.status])}>
                        {PURCHASE_CLEARANCE_STATUS_LABELS[item.status as keyof typeof PURCHASE_CLEARANCE_STATUS_LABELS] ?? item.status}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">{item.items}</p>
                    <p className="text-xs text-muted-foreground">{item.collegeName} · Raised by {item.hodName} on {formatDate(item.createdAt)}</p>
                    <p className="text-sm font-medium">{formatCurrency(item.estimatedAmount)}</p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>

      {isLoading && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-32 rounded-xl border bg-muted/30 animate-pulse" />
          ))}
        </div>
      )}

      {!isLoading && filteredRequests.length === 0 && (
        <EmptyState
          title="No indent requests"
          description="Indents raised by HODs against their department budgets will appear here."
          icon={<ShoppingCart className="h-8 w-8" />}
        />
      )}

      {!isLoading && departments.length > 0 && (
        <div className="space-y-8">
          {departments.map((dept) => {
            const list = grouped[dept];
            return (
              <div key={dept} className="space-y-3">
                <div className="flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-muted-foreground" />
                  <h2 className="text-base font-semibold">{dept}</h2>
                  <span className="text-xs text-muted-foreground">({list.length})</span>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {list.map((item) => (
                    <Link key={item.id} href={`/purchase/indents/${item.id}`}>
                      <Card className="hover:shadow-md transition-shadow cursor-pointer h-full">
                        <CardContent className="p-4 space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            <span className="font-semibold text-sm">{item.title}</span>
                            <IndentStatusBadge status={item.status} />
                          </div>
                          {!collegeId && <p className="text-xs text-muted-foreground">{item.collegeName}</p>}
                          <p className="text-xs text-muted-foreground">Raised by {item.hodName} on {formatDate(item.createdAt)}</p>
                          <p className="text-sm font-medium">{formatCurrency(indentItemsTotal(item.items))}</p>
                        </CardContent>
                      </Card>
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
