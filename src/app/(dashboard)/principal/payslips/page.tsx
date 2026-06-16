"use client";

import { Wallet } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";

export default function PrincipalPayrollPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Payroll"
        description="College payroll overview — all staff salary records"
      />
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 gap-4 text-center">
          <Wallet className="h-12 w-12 text-muted-foreground/40" />
          <p className="text-muted-foreground">Payroll overview coming soon</p>
          <p className="text-xs text-muted-foreground">Connects to Accounts module — view salary disbursements across all departments</p>
        </CardContent>
      </Card>
    </div>
  );
}
