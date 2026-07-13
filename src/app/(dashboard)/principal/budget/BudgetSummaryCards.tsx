"use client";

import { ClipboardList, Clock, CheckCircle2, XCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

interface BudgetSummaryCardsProps {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
}

export function BudgetSummaryCards({ total, pending, approved, rejected }: BudgetSummaryCardsProps) {
  const stats = [
    { label: "Total Requests", value: total, icon: ClipboardList, color: "text-blue-600 bg-blue-50" },
    { label: "Pending Requests", value: pending, icon: Clock, color: "text-amber-600 bg-amber-50" },
    { label: "Approved Requests", value: approved, icon: CheckCircle2, color: "text-green-600 bg-green-50" },
    { label: "Rejected Requests", value: rejected, icon: XCircle, color: "text-red-600 bg-red-50" },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
      {stats.map((stat) => (
        <Card key={stat.label}>
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
      ))}
    </div>
  );
}
