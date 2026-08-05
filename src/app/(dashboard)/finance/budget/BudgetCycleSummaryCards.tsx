"use client";

import { CalendarClock, Building2, CheckCircle2, Clock, Hourglass } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { formatDate } from "@/lib/utils";
import { daysRemaining, type BudgetCycle } from "@/types";

interface BudgetCycleSummaryCardsProps {
  cycle: BudgetCycle | null;
  totalDepartments: number;
  submitted: number;
  pending: number;
}

export function BudgetCycleSummaryCards({ cycle, totalDepartments, submitted, pending }: BudgetCycleSummaryCardsProps) {
  if (!cycle) {
    return (
      <Card>
        <CardContent className="p-4 text-sm text-muted-foreground">
          No budget cycle released yet. Use &quot;New Budget&quot; to release one for approval.
        </CardContent>
      </Card>
    );
  }

  const remaining = daysRemaining(cycle.submissionDeadline);
  const stats = [
    { label: "Current Cycle", value: cycle.title, icon: CalendarClock, color: "text-blue-600 bg-blue-50" },
    { label: "Total Departments", value: totalDepartments, icon: Building2, color: "text-slate-600 bg-slate-50" },
    { label: "Submitted", value: submitted, icon: CheckCircle2, color: "text-green-600 bg-green-50" },
    { label: "Pending", value: pending, icon: Clock, color: "text-amber-600 bg-amber-50" },
    { label: "Deadline", value: formatDate(new Date(cycle.submissionDeadline)), icon: Hourglass, color: "text-orange-600 bg-orange-50" },
    {
      label: "Days Remaining",
      value: remaining < 0 ? "Closed" : remaining,
      icon: Hourglass,
      color: remaining < 0 ? "text-red-600 bg-red-50" : "text-purple-600 bg-purple-50",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-6">
      {stats.map((stat) => (
        <Card key={stat.label}>
          <CardContent className="p-4 flex items-center gap-3">
            <div className={`h-10 w-10 rounded-lg flex items-center justify-center shrink-0 ${stat.color}`}>
              <stat.icon className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">{stat.label}</p>
              <p className="text-lg font-bold truncate">{stat.value}</p>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
