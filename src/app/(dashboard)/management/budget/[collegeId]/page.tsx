"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Building, ArrowLeft, PiggyBank, PackageCheck, AlertTriangle } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { CardSkeleton } from "@/components/shared/SkeletonLoader";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/useToast";
import type { BudgetRequest, College, Department, FinancePurchaseClearance, IndentRequest } from "@/types";

const BUDGET_PENDING = "L1_FROZEN";
const INDENT_PENDING = "PENDING_FINANCE_REVIEW";

interface DeptRow extends Department {
  budgetCount: number;
  indentCount: number;
  clearanceCount: number;
  pendingCount: number;
}

export default function ManagementBudgetDetailPage() {
  const router = useRouter();
  const { collegeId } = useParams<{ collegeId: string }>();
  const [college, setCollege] = useState<College | null>(null);
  const [rows, setRows] = useState<DeptRow[]>([]);
  const [budgetRequests, setBudgetRequests] = useState<BudgetRequest[]>([]);
  const [indents, setIndents] = useState<IndentRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    setIsLoading(true);
    Promise.all([
      fetch(`/api/management/colleges/${collegeId}`).then((r) => r.json() as Promise<{ college?: College }>).then((d) => d.college ?? null),
      fetch(`/api/management/colleges/${collegeId}/departments`).then((r) => r.json() as Promise<{ departments: Department[] }>).then((d) => d.departments ?? []),
      fetch(`/api/college/budget-requests?collegeId=${collegeId}`).then((r) => r.json() as Promise<{ requests: BudgetRequest[] }>).then((d) => d.requests ?? []),
      fetch(`/api/college/indent-requests?collegeId=${collegeId}`).then((r) => r.json() as Promise<{ requests: IndentRequest[] }>).then((d) => d.requests ?? []),
      fetch(`/api/college/finance-purchase-clearance?collegeId=${collegeId}`).then((r) => r.json() as Promise<{ requests: FinancePurchaseClearance[] }>).then((d) => d.requests ?? []),
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
      .catch(() => toast({ variant: "destructive", title: "Failed to load college budget activity" }))
      .finally(() => setIsLoading(false));
  }, [collegeId]);

  const regularBudgetCount = budgetRequests.filter((r) => !r.isEmergency).length;
  const emergencyBudgetCount = budgetRequests.filter((r) => r.isEmergency).length;
  const goodsIndentCount = indents.filter((r) => r.requestType === "GOODS").length;
  const nonGoodsIndentCount = indents.filter((r) => r.requestType === "NON_GOODS").length;

  return (
    <div className="space-y-6">
      <PageHeader
        title={college?.name ?? "College"}
        description="Budget, indent, and purchase clearance activity for this college"
        actions={
          <Button variant="outline" onClick={() => router.push("/management/budget")}>
            <ArrowLeft className="h-4 w-4 mr-2" />All Colleges
          </Button>
        }
      />

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => <CardSkeleton key={i} />)}
        </div>
      ) : (
        <>
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

          {rows.length === 0 ? (
            <EmptyState title="No departments found" icon={<Building className="h-8 w-8" />} />
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {rows.map((dept) => (
                <Card key={dept.id}>
                  <CardContent className="p-5 flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <PiggyBank className="h-5 w-5 text-primary" />
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
