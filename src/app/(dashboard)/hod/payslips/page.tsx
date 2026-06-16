"use client";

import { Wallet } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";

import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/EmptyState";

export default function HODPayslipsPage() {
  return (
    <div className="space-y-6">
      <PageHeader title="My Payslips" description="View and download your monthly payslips" />
      <Card><CardContent className="p-8"><EmptyState title="Payslips module coming soon" description="Monthly payslips with detailed salary breakdown will be available here." icon={<Wallet className="h-8 w-8" />} /></CardContent></Card>
    </div>
  );
}
