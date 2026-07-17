"use client";

import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Building, ArrowLeft, PiggyBank, ShoppingCart, PackageCheck, AlertTriangle } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { CardSkeleton } from "@/components/shared/SkeletonLoader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/useToast";
import { useAuthStore } from "@/store/authStore";
import type { BudgetRequest, College, Department, FinancePurchaseClearance, IndentRequest } from "@/types";

const BUDGET_PENDING = "L1_FROZEN";
const INDENT_PENDING = "PENDING_FINANCE_REVIEW";

interface DeptRow extends Department {
  budgetCount: number;
  indentCount: number;
  clearanceCount: number;
  pendingCount: number;
}

export default function FinanceBrowseDepartmentsPage() {
  const params = useParams<{ locationId: string; collegeId: string }>();
  const searchParams = useSearchParams();
  const departmentFilter = searchParams.get("department");
  const setSelectedCollegeId = useAuthStore((s) => s.setSelectedCollegeId);
  const [college, setCollege] = useState<College | null>(null);
  const [rows, setRows] = useState<DeptRow[]>([]);
  const [budgetRequests, setBudgetRequests] = useState<BudgetRequest[]>([]);
  const [indents, setIndents] = useState<IndentRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Keep every other Finance page (which reads selectedCollegeId) in sync
    // with whichever college is being browsed here.
    setSelectedCollegeId(params.collegeId);

    setIsLoading(true);
    Promise.all([
      fetch(`/api/admin/colleges?locationId=${params.locationId}`).then((r) => r.json() as Promise<{ colleges: College[] }>).then((d) => (d.colleges ?? []).find((c) => c.id === params.collegeId) ?? null),
      fetch(`/api/management/colleges/${params.collegeId}/departments`).then((r) => r.json() as Promise<{ departments: Department[] }>).then((d) => d.departments ?? []),
      fetch(`/api/college/budget-requests?collegeId=${params.collegeId}`).then((r) => r.json() as Promise<{ requests: BudgetRequest[] }>).then((d) => d.requests ?? []),
      fetch(`/api/college/indent-requests?collegeId=${params.collegeId}`).then((r) => r.json() as Promise<{ requests: IndentRequest[] }>).then((d) => d.requests ?? []),
      fetch(`/api/college/finance-purchase-clearance?collegeId=${params.collegeId}`).then((r) => r.json() as Promise<{ requests: FinancePurchaseClearance[] }>).then((d) => d.requests ?? []),
    ])
      .then(([college, departments, budgets, indents, clearances]) => {
        setCollege(college);
        setBudgetRequests(budgets);
        setIndents(indents);
        setRows(
          departments.map((dept) => ({
            ...dept,
            budgetCount: budgets.filter((r) => r.department === dept.name).length,
            indentCount: indents.filter((r) => r.department === dept.name).length,
            clearanceCount: clearances.filter((r) => r.department === dept.name).length,
            pendingCount:
              budgets.filter((r) => r.department === dept.name && r.status === BUDGET_PENDING).length +
              indents.filter((r) => r.department === dept.name && r.status === INDENT_PENDING).length +
              clearances.filter((r) => r.department === dept.name && r.status === INDENT_PENDING).length,
          }))
        );
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load college activity" }))
      .finally(() => setIsLoading(false));
  }, [params.collegeId, params.locationId, setSelectedCollegeId]);

  const regularBudgetCount = budgetRequests.filter((r) => !r.isEmergency).length;
  const emergencyBudgetCount = budgetRequests.filter((r) => r.isEmergency).length;
  const goodsIndentCount = indents.filter((r) => r.requestType === "GOODS").length;
  const nonGoodsIndentCount = indents.filter((r) => r.requestType === "NON_GOODS").length;
  const displayRows = departmentFilter ? rows.filter((d) => d.name === departmentFilter) : rows;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" asChild>
          <Link href={`/finance/browse/${params.locationId}`}><ArrowLeft className="h-4 w-4" /></Link>
        </Button>
        <PageHeader title={college?.name ?? "College Activity"} description="Budget, indent, and purchase clearance activity for this college" />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => <CardSkeleton key={i} />)}
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href="/finance/budget-approvals"><PiggyBank className="h-3.5 w-3.5 mr-1.5" />Budget Approvals</Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href="/finance/indent-approvals"><ShoppingCart className="h-3.5 w-3.5 mr-1.5" />Indent Approvals</Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href="/finance/purchase-clearance"><PackageCheck className="h-3.5 w-3.5 mr-1.5" />Purchase Clearance</Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href="/finance/budget/report"><Building className="h-3.5 w-3.5 mr-1.5" />Budget Report</Link>
            </Button>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Card>
              <CardContent className="p-5 space-y-3">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-muted-foreground" />
                  <p className="text-sm font-semibold">Budget Requests — Regular / Emergency</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline" className="text-xs">Regular ({regularBudgetCount})</Badge>
                  <Badge variant="outline" className="text-xs">Emergency ({emergencyBudgetCount})</Badge>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5 space-y-3">
                <div className="flex items-center gap-2">
                  <PackageCheck className="h-4 w-4 text-muted-foreground" />
                  <p className="text-sm font-semibold">Indents — Goods / Non-Goods</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline" className="text-xs">Goods ({goodsIndentCount})</Badge>
                  <Badge variant="outline" className="text-xs">Non-Goods ({nonGoodsIndentCount})</Badge>
                </div>
              </CardContent>
            </Card>
          </div>

          {departmentFilter && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Filtered to department:</span>
              <Badge variant="outline">{departmentFilter}</Badge>
              <Link href={`/finance/browse/${params.locationId}/${params.collegeId}`} className="text-primary hover:underline">
                Clear
              </Link>
            </div>
          )}

          {displayRows.length === 0 ? (
            <EmptyState title="No departments found" icon={<Building className="h-8 w-8" />} />
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {displayRows.map((dept) => (
                <Card key={dept.id}>
                  <CardContent className="p-5 flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <Building className="h-5 w-5 text-primary" />
                    </div>
                    <div className="space-y-1">
                      <p className="font-medium">{dept.name}</p>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className="text-xs">{dept.budgetCount} budgets</Badge>
                        <Badge variant="outline" className="text-xs">{dept.indentCount} indents</Badge>
                        <Badge variant="outline" className="text-xs">{dept.clearanceCount} clearances</Badge>
                        {dept.pendingCount > 0 && (
                          <Badge className="text-xs bg-yellow-100 text-yellow-800 border-yellow-200">{dept.pendingCount} pending</Badge>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
