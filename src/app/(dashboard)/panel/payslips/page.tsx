"use client";

import { Wallet } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/EmptyState";

export default function PayslipsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Payslips"
        description="Monthly salary records and payslip download"
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {[
          { label: "Gross Salary", value: "—" },
          { label: "Deductions", value: "—" },
          { label: "Net Salary", value: "—" },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className="text-2xl font-bold mt-1">{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="p-6">
          <EmptyState
            title="Payroll module coming soon"
            description="View your monthly payslips, salary breakdown, and download PDF payslips."
            icon={<Wallet className="h-8 w-8" />}
          />
        </CardContent>
      </Card>
    </div>
  );
}
