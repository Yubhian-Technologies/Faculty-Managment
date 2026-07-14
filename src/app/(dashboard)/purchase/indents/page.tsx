"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Building2, ShoppingCart } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { Card, CardContent } from "@/components/ui/card";
import { IndentStatusBadge } from "@/components/shared/indent/IndentStatusBadge";
import { toast } from "@/hooks/useToast";
import { formatCurrency, formatDate } from "@/lib/utils";
import { indentItemsTotal, type IndentRequest } from "@/types";

export default function PurchaseIndentsPage() {
  const [requests, setRequests] = useState<IndentRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setIsLoading(true);
    fetch("/api/college/indent-requests")
      .then((r) => r.json() as Promise<{ requests: IndentRequest[] }>)
      .then((d) => setRequests(d.requests ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load indent requests" }))
      .finally(() => setIsLoading(false));
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
