"use client";

import { Wallet } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";

export default function PrincipalPayslipsPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="My Payslips" description="Salary and payslip records" />
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16 gap-4 text-center">
          <Wallet className="h-12 w-12 text-muted-foreground/40" />
          <p className="text-muted-foreground">Payslips coming soon</p>
        </CardContent>
      </Card>
    </div>
  );
}
