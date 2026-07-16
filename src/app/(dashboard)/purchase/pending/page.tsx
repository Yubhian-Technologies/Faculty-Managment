"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Clock, ShoppingCart } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { CardSkeleton } from "@/components/shared/SkeletonLoader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/useToast";
import { collegeFetch } from "@/lib/api/collegeFetch";
import { formatCurrency, formatDate } from "@/lib/utils";
import {
  INDENT_STATUS_LABELS,
  PURCHASE_CLEARANCE_STATUS_LABELS,
  indentItemsTotal,
  type FinancePurchaseClearance,
  type IndentRequest,
} from "@/types";

// Statuses that mean "sitting in Purchase Dept's own queue, waiting on them" —
// same rule for both request types since financePurchaseClearance's PATCH route
// mirrors indentRequests' state machine through this stage.
const ACTIONABLE = new Set(["PENDING_PURCHASE_REVIEW", "RETURNED_TO_PURCHASE"]);

type Row =
  | { kind: "INDENT"; id: string; title: string; department: string; hodName: string; status: string; amount: number; updatedAt: unknown; href: string }
  | { kind: "CLEARANCE"; id: string; title: string; department: string; hodName: string; status: string; amount: number; updatedAt: unknown; href: string };

function toMillis(value: unknown): number {
  if (value && typeof (value as { toMillis?: () => number }).toMillis === "function") {
    return (value as { toMillis: () => number }).toMillis();
  }
  return value ? new Date(value as string).getTime() : 0;
}

export default function PurchasePendingPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setIsLoading(true);
    Promise.all([
      collegeFetch("/api/college/indent-requests").then((r) => r.json() as Promise<{ requests: IndentRequest[] }>).then((d) => d.requests ?? []),
      collegeFetch("/api/college/finance-purchase-clearance").then((r) => r.json() as Promise<{ requests: FinancePurchaseClearance[] }>).then((d) => d.requests ?? []),
    ])
      .then(([indents, clearances]) => {
        const indentRows: Row[] = indents
          .filter((r) => ACTIONABLE.has(r.status))
          .map((r) => ({
            kind: "INDENT", id: r.id, title: r.title, department: r.department, hodName: r.hodName,
            status: r.status, amount: indentItemsTotal(r.items), updatedAt: r.updatedAt, href: `/purchase/indents/${r.id}`,
          }));
        const clearanceRows: Row[] = clearances
          .filter((r) => ACTIONABLE.has(r.status))
          .map((r) => ({
            kind: "CLEARANCE", id: r.id, title: r.items, department: r.department, hodName: r.hodName,
            status: r.status, amount: r.estimatedAmount, updatedAt: r.updatedAt, href: `/purchase/clearance/${r.id}`,
          }));
        setRows([...indentRows, ...clearanceRows].sort((a, b) => toMillis(b.updatedAt) - toMillis(a.updatedAt)));
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load pending requests" }))
      .finally(() => setIsLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pending Requests"
        description="Indents and purchase clearance requests currently waiting on Purchase Dept"
      />

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => <CardSkeleton key={i} />)}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          title="Nothing pending"
          description="You're caught up — no indent or purchase clearance requests are waiting on you right now."
          icon={<Clock className="h-8 w-8" />}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((row) => (
            <Link key={`${row.kind}-${row.id}`} href={row.href}>
              <Card className="hover:shadow-md transition-shadow cursor-pointer h-full">
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-semibold text-sm">{row.title}</span>
                    <Badge variant="outline" className="text-xs shrink-0">
                      {row.kind === "INDENT" ? "Indent" : "Clearance"}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">{row.department} · Raised by {row.hodName}</p>
                  <div className="flex items-center justify-between">
                    <Badge variant="outline" className="text-xs">
                      {row.kind === "INDENT"
                        ? INDENT_STATUS_LABELS[row.status as keyof typeof INDENT_STATUS_LABELS] ?? row.status
                        : PURCHASE_CLEARANCE_STATUS_LABELS[row.status as keyof typeof PURCHASE_CLEARANCE_STATUS_LABELS] ?? row.status}
                    </Badge>
                    <span className="text-sm font-medium">{formatCurrency(row.amount)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <ShoppingCart className="h-3 w-3" /> Updated {formatDate(row.updatedAt as Parameters<typeof formatDate>[0])}
                  </p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
