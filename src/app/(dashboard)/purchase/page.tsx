"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ShoppingCart, Clock, CheckCircle2, XCircle } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuthStore } from "@/store/authStore";
import type { IndentRequest } from "@/types";

export default function PurchaseDashboard() {
  const user = useAuthStore((s) => s.user);
  const [stats, setStats] = useState({
    total: null as number | null,
    pendingReview: null as number | null,
    awaitingFinance: null as number | null,
    approved: null as number | null,
  });

  useEffect(() => {
    fetch("/api/college/indent-requests")
      .then((r) => r.json() as Promise<{ requests: IndentRequest[] }>)
      .then((d) => d.requests ?? [])
      .then((requests) => {
        setStats({
          total: requests.length,
          pendingReview: requests.filter((r) => r.status === "PENDING_PURCHASE_REVIEW" || r.status === "RETURNED_TO_PURCHASE").length,
          awaitingFinance: requests.filter((r) => r.status === "PENDING_FINANCE_REVIEW").length,
          approved: requests.filter((r) => r.status === "APPROVED").length,
        });
      })
      .catch(() => {});
  }, []);

  const fmt = (n: number | null) => (n === null ? "…" : String(n));

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Hello, ${user?.name?.split(" ")[0] ?? "Purchase"}`}
        description="Source quotations for department indents and track their clearance with Finance"
      />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {[
          { label: "Total Indents", value: fmt(stats.total), icon: ShoppingCart, color: "text-blue-600 bg-blue-50" },
          { label: "Needs Quotations", value: fmt(stats.pendingReview), icon: Clock, color: "text-yellow-600 bg-yellow-50" },
          { label: "With Finance", value: fmt(stats.awaitingFinance), icon: XCircle, color: "text-purple-600 bg-purple-50" },
          { label: "Approved", value: fmt(stats.approved), icon: CheckCircle2, color: "text-green-600 bg-green-50" },
        ].map((stat) => (
          <Link key={stat.label} href="/purchase/indents">
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
              <Link href="/purchase/indents">
                <ShoppingCart className="h-4 w-4 mr-2" />
                Review Indent Requests
              </Link>
            </Button>
            <Button variant="outline" asChild className="w-full justify-start">
              <Link href="/purchase/requests">
                <ShoppingCart className="h-4 w-4 mr-2" />
                Log a Purchase Request
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
              HOD raises an indent against their department budget
            </p>
            <p className="flex items-center gap-2">
              <span className="h-5 w-5 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary shrink-0">2</span>
              Source at least 3 vendor quotations and recommend one
            </p>
            <p className="flex items-center gap-2">
              <span className="h-5 w-5 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary shrink-0">3</span>
              Finance reviews, disburses, and sends the green flag back
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
