"use client";

import { ClipboardList } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/EmptyState";

export function BudgetRequestsTable() {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">My Budget Requests</CardTitle>
      </CardHeader>
      <CardContent>
        <EmptyState
          title="No budget requests yet."
          description="Requests you submit will appear here with their approval status."
          icon={<ClipboardList className="h-8 w-8" />}
        />
      </CardContent>
    </Card>
  );
}
