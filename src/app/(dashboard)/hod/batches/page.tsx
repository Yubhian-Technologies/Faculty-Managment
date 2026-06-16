"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { toast } from "@/hooks/useToast";
import { formatDate } from "@/lib/utils";
import type { HiringBatch } from "@/types";

type BatchRow = Record<string, unknown> & HiringBatch;

export default function HODBatchesPage() {
  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch("/api/college/hiring-batches")
      .then((r) => r.json() as Promise<{ batches: BatchRow[] }>)
      .then((d) => setBatches(d.batches ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load batches" }))
      .finally(() => setIsLoading(false));
  }, []);

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
      header: "Interview Date",
      render: (row) => formatDate(row.interviewDate as Parameters<typeof formatDate>[0]),
    },
    {
      key: "candidateIds",
      header: "Candidates",
      render: (row) => (row.candidateIds as string[]).length,
    },
    {
      key: "panelMemberUids",
      header: "Panel Size",
      hideOnMobile: true,
      render: (row) => `${(row.panelMemberUids as string[]).length} members`,
    },
    {
      key: "setupComplete",
      header: "Setup",
      hideOnMobile: true,
      render: (row) => (
        <span className={`text-xs font-medium ${(row.setupComplete as boolean) ? "text-green-600" : "text-orange-600"}`}>
          {(row.setupComplete as boolean) ? "Complete" : "Pending"}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <StatusBadge status={(row as unknown as HiringBatch).status} />,
    },
    {
      key: "actions",
      header: "",
      render: (row) => (
        <Button size="sm" variant="outline" asChild>
          <Link href={`/hod/batches/${row.id as string}`}>View</Link>
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Hiring Batches"
        description="Interview panel proposals and progress"
        actions={
          <Button asChild>
            <Link href="/hod/batches/new">
              <Plus className="h-4 w-4 mr-2" />
              New Batch
            </Link>
          </Button>
        }
      />

      <DataTable
        data={batches}
        columns={columns}
        isLoading={isLoading}
        keyExtractor={(r) => r.id as string}
        searchPlaceholder="Search batches..."
        searchKeys={["position", "department"] as (keyof BatchRow)[]}
        emptyTitle="No hiring batches yet"
        emptyDescription="Create an interview panel proposal after shortlisting candidates"
        emptyAction={
          <Button asChild>
            <Link href="/hod/batches/new">
              <Plus className="h-4 w-4 mr-2" />
              New Batch
            </Link>
          </Button>
        }
        csvFilename="hiring-batches"
      />
    </div>
  );
}
