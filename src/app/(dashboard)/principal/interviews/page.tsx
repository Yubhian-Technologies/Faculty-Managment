"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { toast } from "@/hooks/useToast";
import { formatDate } from "@/lib/utils";
import type { HiringBatch } from "@/types";

type BatchRow = Record<string, unknown> & HiringBatch;

export default function PrincipalInterviewsPage() {
  const router = useRouter();
  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  function loadBatches() {
    setIsLoading(true);
    fetch("/api/college/hiring-batches")
      .then((r) => r.json() as Promise<{ batches: BatchRow[] }>)
      .then((d) => setBatches(d.batches ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load interview plans" }))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => { loadBatches(); }, []);

  const columns: Column<BatchRow>[] = [
    {
      key: "position",
      header: "Position",
      render: (row) => (
        <div>
          <p className="font-medium">{row.position as string}</p>
          <p className="text-xs text-muted-foreground">{row.department as string}</p>
        </div>
      ),
    },
    {
      key: "interviewDate",
      header: "Proposed Date",
      render: (row) => formatDate(row.interviewDate as Parameters<typeof formatDate>[0]),
    },
    {
      key: "panelMemberUids",
      header: "Panel",
      hideOnMobile: true,
      render: (row) => `${(row.panelMemberUids as string[]).length} members`,
    },
    {
      key: "candidateIds",
      header: "Candidates",
      render: (row) => (row.candidateIds as string[]).length,
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <StatusBadge status={(row as unknown as HiringBatch).status} />,
    },
    {
      key: "actions",
      header: "Actions",
      render: (row) => (
        <div className="flex gap-1 flex-wrap">
          <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); router.push(`/principal/interviews/${row.id}`); }}>
            View
          </Button>
          {(row.status as string) === "PENDING" && (
            <>
              <Button size="sm" onClick={(e) => { e.stopPropagation(); router.push(`/principal/interviews/${row.id}?action=approve`); }}>
                Approve
              </Button>
              <Button size="sm" variant="destructive" onClick={(e) => { e.stopPropagation(); router.push(`/principal/interviews/${row.id}?action=reject`); }}>
                Reject
              </Button>
            </>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Interview Plans"
        description="Review HOD interview panel proposals"
      />

      <DataTable
        data={batches}
        columns={columns}
        isLoading={isLoading}
        keyExtractor={(r) => r.id as string}
        searchPlaceholder="Search interview plans..."
        searchKeys={["position", "department"] as (keyof BatchRow)[]}
        emptyTitle="No interview plans submitted"
        emptyDescription="HODs will submit interview plans after vacancies are approved"
        csvFilename="interview-plans"
        onRowClick={(row) => router.push(`/principal/interviews/${row.id}`)}
      />
    </div>
  );
}
