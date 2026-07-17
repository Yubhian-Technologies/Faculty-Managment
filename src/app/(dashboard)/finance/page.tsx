"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Wallet, ClipboardCheck, IndianRupee, ShoppingCart } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/store/authStore";
import { collegeFetch } from "@/lib/api/collegeFetch";
import { formatCurrency } from "@/lib/utils";
import type { FinanceBudget, FinanceBudgetRequest, FinanceExpenseRequest, FinancePurchaseClearance } from "@/types";

export default function FinanceDashboard() {
  const user = useAuthStore((s) => s.user);
  const [stats, setStats] = useState({
    totalAllocated: null as number | null,
    totalUtilized: null as number | null,
    pendingApprovals: null as number | null,
    pendingClearances: null as number | null,
  });

  useEffect(() => {
    Promise.all([
      collegeFetch("/api/college/finance-budgets").then((r) => r.json() as Promise<{ budgets: FinanceBudget[] }>).then((d) => d.budgets ?? []),
      collegeFetch("/api/college/finance-budget-requests?status=PENDING").then((r) => r.json() as Promise<{ requests: FinanceBudgetRequest[] }>).then((d) => d.requests ?? []),
      collegeFetch("/api/college/finance-expense-requests?status=PENDING").then((r) => r.json() as Promise<{ requests: FinanceExpenseRequest[] }>).then((d) => d.requests ?? []),
      // Org-wide (every location/college Finance serves), unlike the three
      // college-scoped fetches above which have no overview route yet.
      fetch("/api/purchase/indents/overview?status=PENDING_FINANCE_REVIEW").then((r) => r.json() as Promise<{ clearances: FinancePurchaseClearance[] }>).then((d) => d.clearances ?? []),
    ]).then(([budgets, budgetRequests, expenseRequests, clearances]) => {
      setStats({
        totalAllocated: budgets.reduce((s, b) => s + (b.allocatedAmount ?? 0), 0),
        totalUtilized: budgets.reduce((s, b) => s + (b.utilizedAmount ?? 0), 0),
        pendingApprovals: budgetRequests.length + expenseRequests.length,
        pendingClearances: clearances.length,
      });
    }).catch(() => {});
  }, []);

  const fmt = (n: number | null) => (n === null ? "…" : formatCurrency(n));
  const fmtCount = (n: number | null) => (n === null ? "…" : String(n));

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Hello, ${user?.name?.split(" ")[0] ?? "Finance"}`}
        description="Budgets, approvals, payments, and financial reporting"
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {[
          { label: "Total Allocated", value: fmt(stats.totalAllocated), icon: Wallet, color: "text-blue-600 bg-blue-50", href: "/finance/budget" },
          { label: "Total Utilized", value: fmt(stats.totalUtilized), icon: IndianRupee, color: "text-green-600 bg-green-50", href: "/finance/fund-allocation" },
          { label: "Pending Approvals", value: fmtCount(stats.pendingApprovals), icon: ClipboardCheck, color: "text-orange-600 bg-orange-50", href: "/finance/budget-approvals" },
          { label: "Pending Clearances", value: fmtCount(stats.pendingClearances), icon: ShoppingCart, color: "text-purple-600 bg-purple-50", href: "/finance/purchase-clearance" },
        ].map((stat) => (
          <Link key={stat.label} href={stat.href}>
            <Card className="hover:shadow-md transition-shadow cursor-pointer">
              <CardContent className="p-4 flex items-center gap-3">
                <div className={`h-10 w-10 rounded-lg flex items-center justify-center shrink-0 ${stat.color}`}>
                  <stat.icon className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">{stat.label}</p>
                  <p className="text-xl font-bold">{stat.value}</p>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Quick Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Button variant="outline" asChild className="w-full justify-start">
              <Link href="/finance/budget">
                <Wallet className="h-4 w-4 mr-2" />
                Manage Budgets
              </Link>
            </Button>
            <Button variant="outline" asChild className="w-full justify-start">
              <Link href="/finance/budget-approvals">
                <ClipboardCheck className="h-4 w-4 mr-2" />
                Review Budget Approvals
              </Link>
            </Button>
            <Button variant="outline" asChild className="w-full justify-start">
              <Link href="/finance/payments">
                <IndianRupee className="h-4 w-4 mr-2" />
                Process Payments
              </Link>
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Workflow</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p className="flex items-center gap-2">
              <span className="h-5 w-5 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary shrink-0">1</span>
              Allocate a budget, then log budget/expense/purchase requests as they come in
            </p>
            <p className="flex items-center gap-2">
              <span className="h-5 w-5 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary shrink-0">2</span>
              Approve, reject, or return requests for correction
            </p>
            <p className="flex items-center gap-2">
              <span className="h-5 w-5 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary shrink-0">3</span>
              Allocate funds, process payments, and record receipts
            </p>
            <p className="flex items-center gap-2">
              <span className="h-5 w-5 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary shrink-0">4</span>
              Track everything in Financial Reports and Audit &amp; Compliance
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
