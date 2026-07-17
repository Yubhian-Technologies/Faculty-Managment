"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Tags, ShoppingCart, X } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/EmptyState";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { IndentStatusBadge } from "@/components/shared/indent/IndentStatusBadge";
import { toast } from "@/hooks/useToast";
import { formatCurrency, formatDate } from "@/lib/utils";
import { indentItemsTotal, type IndentRequest } from "@/types";

const UNCATEGORIZED = "Uncategorized";

type OverviewIndent = IndentRequest & { collegeName: string; locationId: string; locationName: string };

export default function PurchaseByCategoryPage() {
  const searchParams = useSearchParams();
  const categoryFilter = searchParams.get("category");
  const locationId = searchParams.get("locationId");
  const collegeId = searchParams.get("collegeId");
  const [requests, setRequests] = useState<OverviewIndent[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setIsLoading(true);
    const params = new URLSearchParams();
    if (locationId) params.set("locationId", locationId);
    if (collegeId) params.set("collegeId", collegeId);
    fetch(`/api/purchase/indents/overview?${params.toString()}`)
      .then((r) => r.json() as Promise<{ indents: OverviewIndent[] }>)
      .then((d) => setRequests(d.indents ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load indent requests" }))
      .finally(() => setIsLoading(false));
  }, [locationId, collegeId]);

  const filteredRequests = categoryFilter
    ? requests.filter((r) => (r.category || UNCATEGORIZED) === categoryFilter)
    : requests;

  const grouped: Record<string, OverviewIndent[]> = {};
  for (const r of filteredRequests) {
    (grouped[r.category || UNCATEGORIZED] ??= []).push(r);
  }
  const categories = Object.keys(grouped).sort((a, b) => a.localeCompare(b));

  const scopeLabel = collegeId
    ? filteredRequests[0]?.collegeName
    : locationId
      ? filteredRequests[0]?.locationName
      : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Indents by Category"
        description={
          collegeId || locationId
            ? "Indent requests grouped by the budget category they were raised against"
            : "Org-wide — indent requests across every location and college, grouped by budget category"
        }
      />

      {(categoryFilter || collegeId || locationId) && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {scopeLabel && (
            <>
              <span className="text-muted-foreground">Scope:</span>
              <Badge variant="outline">{scopeLabel}</Badge>
            </>
          )}
          {categoryFilter && (
            <>
              <span className="text-muted-foreground">Category:</span>
              <Badge variant="outline">{categoryFilter}</Badge>
            </>
          )}
          <Button variant="ghost" size="sm" asChild className="h-7 px-2">
            <Link href="/purchase/by-category"><X className="h-3 w-3 mr-1" />Clear</Link>
          </Button>
        </div>
      )}

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
          description="Indents raised by HODs against their department budgets will appear here, grouped by category."
          icon={<ShoppingCart className="h-8 w-8" />}
        />
      )}

      {!isLoading && categories.length > 0 && (
        <div className="space-y-8">
          {categories.map((category) => {
            const list = grouped[category];
            return (
              <div key={category} className="space-y-3">
                <div className="flex items-center gap-2">
                  <Tags className="h-4 w-4 text-muted-foreground" />
                  <h2 className="text-base font-semibold">{category}</h2>
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
                          <p className="text-xs text-muted-foreground">{item.department} · {item.collegeName}</p>
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
