"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { History } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { CardSkeleton } from "@/components/shared/SkeletonLoader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/useToast";
import { collegeFetch } from "@/lib/api/collegeFetch";
import { cn, formatCurrency, formatDateTime } from "@/lib/utils";
import {
  INDENT_STATUS_LABELS,
  PURCHASE_CLEARANCE_STATUS_LABELS,
  indentItemsTotal,
  type FinancePurchaseClearance,
  type IndentRequest,
} from "@/types";

const STATUS_STYLES: Record<string, string> = {
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

const LIMIT = 30;

type Row =
  | { kind: "INDENT"; id: string; title: string; department: string; hodName: string; status: string; amount: number; updatedAt: unknown; href: string }
  | { kind: "CLEARANCE"; id: string; title: string; department: string; hodName: string; status: string; amount: number; updatedAt: unknown; href: string };

function toMillis(value: unknown): number {
  if (value && typeof (value as { toMillis?: () => number }).toMillis === "function") {
    return (value as { toMillis: () => number }).toMillis();
  }
  return value ? new Date(value as string).getTime() : 0;
}

export default function PurchaseLatestPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setIsLoading(true);
    Promise.all([
      collegeFetch("/api/college/indent-requests").then((r) => r.json() as Promise<{ requests: IndentRequest[] }>).then((d) => d.requests ?? []),
      collegeFetch("/api/college/finance-purchase-clearance").then((r) => r.json() as Promise<{ requests: FinancePurchaseClearance[] }>).then((d) => d.requests ?? []),
    ])
      .then(([indents, clearances]) => {
        const indentRows: Row[] = indents.map((r) => ({
          kind: "INDENT", id: r.id, title: r.title, department: r.department, hodName: r.hodName,
          status: r.status, amount: indentItemsTotal(r.items), updatedAt: r.updatedAt, href: `/purchase/indents/${r.id}`,
        }));
        const clearanceRows: Row[] = clearances.map((r) => ({
          kind: "CLEARANCE", id: r.id, title: r.items, department: r.department, hodName: r.hodName,
          status: r.status, amount: r.estimatedAmount, updatedAt: r.updatedAt, href: `/purchase/clearance/${r.id}`,
        }));
        setRows(
          [...indentRows, ...clearanceRows]
            .sort((a, b) => toMillis(b.updatedAt) - toMillis(a.updatedAt))
            .slice(0, LIMIT)
        );
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load recent requests" }))
      .finally(() => setIsLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Latest Requests"
        description="Most recently updated indent and purchase clearance requests, any status"
      />

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => <CardSkeleton key={i} />)}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          title="No activity yet"
          description="Indent and purchase clearance requests will show up here as they're raised and updated."
          icon={<History className="h-8 w-8" />}
        />
      ) : (
        <div className="space-y-3">
          {rows.map((row) => (
            <Link key={`${row.kind}-${row.id}`} href={row.href}>
              <Card className="hover:shadow-md transition-shadow cursor-pointer">
                <CardContent className="p-4 flex items-center justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm truncate">{row.title}</span>
                      <Badge variant="outline" className="text-xs shrink-0">
                        {row.kind === "INDENT" ? "Indent" : "Clearance"}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">{row.department} · Raised by {row.hodName} · {formatDateTime(row.updatedAt as Parameters<typeof formatDateTime>[0])}</p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-sm font-medium">{formatCurrency(row.amount)}</span>
                    <Badge variant="outline" className={cn("text-xs", STATUS_STYLES[row.status])}>
                      {row.kind === "INDENT"
                        ? INDENT_STATUS_LABELS[row.status as keyof typeof INDENT_STATUS_LABELS] ?? row.status
                        : PURCHASE_CLEARANCE_STATUS_LABELS[row.status as keyof typeof PURCHASE_CLEARANCE_STATUS_LABELS] ?? row.status}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
