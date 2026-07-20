"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, CheckCircle2, ExternalLink } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/useToast";
import { collegeFetch } from "@/lib/api/collegeFetch";
import { formatCurrency } from "@/lib/utils";
import type { FinanceReceipt } from "@/types";

type Row = FinanceReceipt & Record<string, unknown>;

export default function FinanceReceiptsPage() {
  const router = useRouter();
  const [receipts, setReceipts] = useState<Row[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);

  function load() {
    setIsLoading(true);
    collegeFetch("/api/college/finance-receipts")
      .then((r) => r.json() as Promise<{ receipts: Row[] }>)
      .then((d) => setReceipts(d.receipts ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load receipts" }))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => { load(); }, []);

  async function handleVerify(row: Row) {
    setVerifyingId(row.id);
    try {
      const res = await collegeFetch(`/api/college/finance-receipts/${row.id}`, { method: "PATCH" });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "Receipt verified" });
      load();
    } catch {
      toast({ variant: "destructive", title: "Failed to verify receipt" });
    } finally {
      setVerifyingId(null);
    }
  }

  const columns: Column<Row>[] = [
    { key: "description", header: "Description" },
    { key: "relatedType", header: "Related To", render: (row) => <Badge variant="secondary">{row.relatedType}</Badge> },
    { key: "amount", header: "Amount", render: (row) => formatCurrency(row.amount) },
    {
      key: "fileUrl", header: "File", hideOnMobile: true,
      render: (row) => row.fileUrl ? (
        <a href={row.fileUrl} target="_blank" rel="noopener noreferrer" className="text-primary inline-flex items-center gap-1 text-xs">
          View <ExternalLink className="h-3 w-3" />
        </a>
      ) : "—",
    },
    {
      key: "verified", header: "Status",
      render: (row) => row.verified
        ? <Badge variant="outline" className="bg-green-100 text-green-800 border-green-200">Verified</Badge>
        : <Badge variant="outline" className="bg-yellow-100 text-yellow-800 border-yellow-200">Unverified</Badge>,
    },
    {
      key: "actions", header: "", className: "text-right",
      render: (row) => !row.verified && (
        <Button size="sm" variant="outline" loading={verifyingId === row.id} onClick={() => void handleVerify(row)}>
          <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
          Verify
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Receipts"
        description="Record and verify receipts for budgets, expenses, payments, and allocations"
        actions={
          <Button onClick={() => router.push("/finance/receipts/new")}>
            <Plus className="h-4 w-4 mr-1" />
            New Receipt
          </Button>
        }
      />

      <DataTable
        data={receipts}
        columns={columns}
        isLoading={isLoading}
        searchPlaceholder="Search receipts..."
        searchKeys={["description", "relatedId"]}
        csvFilename="finance-receipts"
        emptyTitle="No receipts recorded"
        emptyDescription="Record a receipt for a budget, expense, payment, or allocation for audit documentation."
        keyExtractor={(row) => row.id}
      />
    </div>
  );
}
