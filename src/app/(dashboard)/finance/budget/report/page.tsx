"use client";

import { useEffect, useState } from "react";
import { RefreshCw, Building2 } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { EmptyState } from "@/components/shared/EmptyState";
import { CardSkeleton } from "@/components/shared/SkeletonLoader";
import { BudgetDepartmentReport } from "@/components/shared/budget/BudgetDepartmentReport";
import { toast } from "@/hooks/useToast";
import { collegeFetch } from "@/lib/api/collegeFetch";
import { useAuthStore } from "@/store/authStore";
import type { BudgetRequest, College } from "@/types";

type OverviewRequest = BudgetRequest & { collegeId: string; collegeName: string; locationId: string; locationName: string };

const SCOPES = ["COLLEGE", "LOCATION", "ALL"] as const;
type ReportScope = (typeof SCOPES)[number];
const SCOPE_LABELS: Record<ReportScope, string> = {
  COLLEGE: "This College",
  LOCATION: "This Location",
  ALL: "All Locations",
};

export default function FinanceBudgetReportPage() {
  const selectedCollegeId = useAuthStore((s) => s.selectedCollegeId);
  const [scope, setScope] = useState<ReportScope>("COLLEGE");
  const [requests, setRequests] = useState<BudgetRequest[]>([]);
  const [overviewRequests, setOverviewRequests] = useState<OverviewRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  function loadCollegeScope() {
    setIsLoading(true);
    collegeFetch("/api/college/budget-requests")
      .then((r) => r.json() as Promise<{ requests: BudgetRequest[] }>)
      .then((d) => setRequests(d.requests ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load budget requests" }))
      .finally(() => setIsLoading(false));
  }

  async function loadOverviewScope(targetScope: "LOCATION" | "ALL") {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      if (targetScope === "LOCATION") {
        if (!selectedCollegeId) {
          setOverviewRequests([]);
          return;
        }
        const colleges = await fetch("/api/admin/colleges")
          .then((r) => r.json() as Promise<{ colleges: College[] }>)
          .then((d) => d.colleges ?? []);
        const current = colleges.find((c) => c.id === selectedCollegeId);
        if (!current?.locationId) {
          setOverviewRequests([]);
          return;
        }
        params.set("locationId", current.locationId);
      }
      const data = await fetch(`/api/finance/budget-requests/overview?${params.toString()}`)
        .then((r) => r.json() as Promise<{ requests: OverviewRequest[] }>);
      setOverviewRequests(data.requests ?? []);
    } catch {
      toast({ variant: "destructive", title: "Failed to load budget requests" });
    } finally {
      setIsLoading(false);
    }
  }

  function load() {
    if (scope === "COLLEGE") loadCollegeScope();
    else void loadOverviewScope(scope);
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps -- load() intentionally re-reads current scope/selectedCollegeId; only they should re-trigger the fetch
  useEffect(() => { load(); }, [scope, selectedCollegeId]);

  const groupedByCollege: Record<string, OverviewRequest[]> = {};
  for (const r of overviewRequests) {
    (groupedByCollege[r.collegeName] ??= []).push(r);
  }
  const collegeNames = Object.keys(groupedByCollege).sort((a, b) => a.localeCompare(b));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Budget Report"
        description="Department-wise breakdown of Non Recurring and Recurring budget items"
        actions={
          <div className="flex items-center gap-2">
            <Select value={scope} onValueChange={(v) => setScope(v as ReportScope)}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SCOPES.map((s) => (
                  <SelectItem key={s} value={s}>{SCOPE_LABELS[s]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={load} loading={isLoading}>
              <RefreshCw className="h-4 w-4 mr-1" />
              Refresh
            </Button>
          </div>
        }
      />

      {scope === "COLLEGE" ? (
        <BudgetDepartmentReport requests={requests} isLoading={isLoading} />
      ) : isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <CardSkeleton key={i} />)}
        </div>
      ) : collegeNames.length === 0 ? (
        <EmptyState
          title="No budget requests found"
          description="Requests submitted by HODs across this scope will appear here, grouped by college and department."
          icon={<Building2 className="h-8 w-8" />}
        />
      ) : (
        <div className="space-y-8">
          {collegeNames.map((name) => (
            <div key={name} className="space-y-3">
              <div className="flex items-center gap-2">
                <Building2 className="h-4 w-4 text-muted-foreground" />
                <h2 className="text-base font-semibold">{name}</h2>
              </div>
              <BudgetDepartmentReport requests={groupedByCollege[name] ?? []} isLoading={false} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
