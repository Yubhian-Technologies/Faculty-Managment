"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Building2, ShoppingCart } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
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

type ClearanceRow = FinancePurchaseClearance & { id: string; status: string };

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
  const [requests, setRequests] = useState<IndentRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [clearanceRequests, setClearanceRequests] = useState<ClearanceRow[]>([]);
  const [isLoadingClearance, setIsLoadingClearance] = useState(true);

  useEffect(() => {
    setIsLoading(true);
    fetch("/api/college/indent-requests")
      .then((r) => r.json() as Promise<{ requests: IndentRequest[] }>)
      .then((d) => setRequests(d.requests ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load indent requests" }))
      .finally(() => setIsLoading(false));

    setIsLoadingClearance(true);
    fetch("/api/college/finance-purchase-clearance")
      .then((r) => r.json() as Promise<{ requests: ClearanceRow[] }>)
      .then((d) => setClearanceRequests(d.requests ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load purchase clearance requests" }))
      .finally(() => setIsLoadingClearance(false));
  }, []);

  const grouped: Record<string, IndentRequest[]> = {};
  for (const r of requests) {
    (grouped[r.department] ??= []).push(r);
  }
  const departments = Object.keys(grouped).sort((a, b) => a.localeCompare(b));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Indent Requests"
        description="Indents raised by departments, grouped for sourcing quotations"
      />

      <div className="space-y-3">
        <h2 className="text-base font-semibold">Purchase Clearance Requests</h2>
        {isLoadingClearance ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => <CardSkeleton key={i} />)}
          </div>
        ) : clearanceRequests.length === 0 ? (
          <EmptyState
            title="No purchase clearance requests"
            description="Requests raised by HODs will appear here for quotation sourcing and purchase."
            icon={<ShoppingCart className="h-8 w-8" />}
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {clearanceRequests.map((item) => (
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
                    <p className="text-xs text-muted-foreground">Raised by {item.hodName} on {formatDate(item.createdAt)}</p>
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

      {!isLoading && requests.length === 0 && (
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
