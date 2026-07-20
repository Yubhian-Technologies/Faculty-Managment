"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/useToast";
import { formatDate } from "@/lib/utils";
import { Plus } from "lucide-react";
import type { HiringSalaryAgreement } from "@/types";

type RecordRow = Record<string, unknown> & HiringSalaryAgreement;

function rupees(n: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}

export default function AccountsSalaryPage() {
  const router = useRouter();
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  function loadRecords() {
    return fetch("/api/college/salary-records")
      .then((r) => r.json() as Promise<{ records: RecordRow[] }>)
      .then((d) => setRecords(d.records ?? []));
  }

  useEffect(() => {
    setIsLoading(true);
    loadRecords()
      .catch(() => toast({ variant: "destructive", title: "Failed to load" }))
      .finally(() => setIsLoading(false));
  }, []);

  const totalMonthly = records.reduce((s, r) => s + ((r.agreedMonthly as number) ?? 0), 0);
  const totalAnnual = records.reduce((s, r) => s + ((r.agreedAnnual as number) ?? 0), 0);

  const columns: Column<RecordRow>[] = [
    {
      key: "candidateName",
      header: "Candidate",
      render: (row) => (
        <div>
          <p className="font-medium">{(row.candidateName as string) || "—"}</p>
          <p className="text-xs text-muted-foreground">{row.candidateId as string}</p>
        </div>
      ),
    },
    { key: "agreedMonthly", header: "Monthly CTC", render: (row) => <span className="font-medium">{rupees(row.agreedMonthly as number)}</span> },
    { key: "agreedAnnual", header: "Annual CTC", render: (row) => rupees(row.agreedAnnual as number) },
    {
      key: "breakdown",
      header: "Basic",
      hideOnMobile: true,
      render: (row) => {
        const b = row.breakdown as HiringSalaryAgreement["breakdown"];
        return b?.basic ? rupees(b.basic) : "—";
      },
    },
    { key: "negotiatedBy", header: "By", hideOnMobile: true, render: (row) => (row.negotiatedBy as string) || "—" },
    { key: "agreedAt", header: "Date", render: (row) => formatDate(row.agreedAt as Parameters<typeof formatDate>[0]) },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Salary Records"
        description="Hiring salary agreements negotiated during recruitment"
        actions={
          <Button onClick={() => router.push("/accounts/salary/new")}>
            <Plus className="h-4 w-4 mr-1" />
            Add Agreement
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Total Agreements</p>
            <p className="text-2xl font-bold">{records.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Total Monthly Payout</p>
            <p className="text-2xl font-bold">{isLoading ? "—" : rupees(totalMonthly)}</p>
          </CardContent>
        </Card>
        <Card className="col-span-2 sm:col-span-1">
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Total Annual Commitment</p>
            <p className="text-2xl font-bold">{isLoading ? "—" : rupees(totalAnnual)}</p>
          </CardContent>
        </Card>
      </div>

      <DataTable
        data={records}
        columns={columns}
        isLoading={isLoading}
        keyExtractor={(r) => r.id as string}
        searchPlaceholder="Search by candidate or negotiator..."
        searchKeys={["candidateName", "negotiatedBy"] as (keyof RecordRow)[]}
        emptyTitle="No salary records yet"
        emptyDescription="Add salary agreements for candidates after interviews are complete"
        csvFilename="salary-records"
      />
    </div>
  );
}
