"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/useToast";
import { collegeFetch } from "@/lib/api/collegeFetch";
import { formatCurrency } from "@/lib/utils";
import type { FinancePayment, FinancePaymentType } from "@/types";

type Row = FinancePayment & Record<string, unknown>;

const TYPE_LABELS: Record<FinancePaymentType, string> = {
  VENDOR: "Vendor",
  STAFF_REIMBURSEMENT: "Staff Reimbursement",
  STUDENT_REFUND: "Student Refund",
};

const STATUS_COLOR: Record<string, string> = {
  PENDING: "bg-yellow-100 text-yellow-800 border-yellow-200",
  PROCESSED: "bg-blue-100 text-blue-800 border-blue-200",
  VERIFIED: "bg-green-100 text-green-800 border-green-200",
};

export default function FinancePaymentsPage() {
  const router = useRouter();
  const [payments, setPayments] = useState<Row[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  function load() {
    setIsLoading(true);
    collegeFetch("/api/college/finance-payments")
      .then((r) => r.json() as Promise<{ payments: Row[] }>)
      .then((d) => setPayments(d.payments ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load payments" }))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => { load(); }, []);

  const columns: Column<Row>[] = [
    { key: "payeeName", header: "Payee" },
    { key: "type", header: "Type", render: (row) => <Badge variant="secondary">{TYPE_LABELS[row.type]}</Badge> },
    { key: "purpose", header: "Purpose", hideOnMobile: true },
    { key: "amount", header: "Amount", render: (row) => formatCurrency(row.amount) },
    { key: "paymentReference", header: "Reference", hideOnMobile: true, render: (row) => row.paymentReference ?? "—" },
    { key: "status", header: "Status", render: (row) => <Badge variant="outline" className={STATUS_COLOR[row.status]}>{row.status}</Badge> },
    {
      key: "actions", header: "", className: "text-right",
      render: (row) => (
        <div className="flex justify-end gap-1">
          {row.status === "PENDING" && (
            <Button size="sm" onClick={() => router.push(`/finance/payments/${row.id}/process?status=PROCESSED`)}>Process</Button>
          )}
          {row.status === "PROCESSED" && (
            <Button size="sm" variant="outline" onClick={() => router.push(`/finance/payments/${row.id}/process?status=VERIFIED`)}>Verify</Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payments"
        description="Process vendor payments, staff reimbursements, and student refunds"
        actions={
          <Button onClick={() => router.push("/finance/payments/new")}>
            <Plus className="h-4 w-4 mr-1" />
            New Payment
          </Button>
        }
      />

      <DataTable
        data={payments}
        columns={columns}
        isLoading={isLoading}
        searchPlaceholder="Search by payee..."
        searchKeys={["payeeName", "purpose"]}
        csvFilename="finance-payments"
        emptyTitle="No payments yet"
        emptyDescription="Create a payment for a vendor, staff reimbursement, or student refund."
        keyExtractor={(row) => row.id}
      />
    </div>
  );
}
