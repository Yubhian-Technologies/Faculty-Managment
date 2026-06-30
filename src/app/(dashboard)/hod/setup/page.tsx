"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { toast } from "@/hooks/useToast";
import { formatDate } from "@/lib/utils";
import type { HiringBatch } from "@/types";

type BatchRow = Record<string, unknown> & HiringBatch;

export default function HODSetupPage() {
  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Show approved batches — these are the ones HOD needs to finalize after College Office sets up
    fetch("/api/college/hiring-batches?status=APPROVED")
      .then((r) => r.json() as Promise<{ batches: BatchRow[] }>)
      .then((d) => setBatches(d.batches ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load" }))
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
      key: "interviewVenue",
      header: "Venue",
      hideOnMobile: true,
      render: (row) => (row.interviewVenue as string) || <span className="text-xs text-muted-foreground">Not set</span>,
    },
    {
      key: "setupComplete",
      header: "Office Setup",
      render: (row) => (
        <span className={`text-xs font-medium ${(row.setupComplete as boolean) ? "text-green-600" : "text-orange-600"}`}>
          {(row.setupComplete as boolean) ? "Complete" : "Pending"}
        </span>
      ),
    },
    {
      key: "demoClassroom",
      header: "Demo Room / Mode",
      hideOnMobile: true,
      render: (row) => {
        const mode = row.interviewMode as string | undefined;
        if (mode === "ONLINE") return <span className="text-xs font-medium text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">Online</span>;
        return (row.demoClassroom as string) || <span className="text-xs text-muted-foreground">Not set</span>;
      },
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
          <Link href={`/hod/batches/${row.id as string}`}>
            {(row.setupComplete as boolean) ? "View / Update" : "Waiting for Office"}
          </Link>
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Interview Setup"
        description="Track College Office setup progress and add demo classroom details"
      />

      <DataTable
        data={batches}
        columns={columns}
        isLoading={isLoading}
        keyExtractor={(r) => r.id as string}
        searchPlaceholder="Search..."
        searchKeys={["position", "department"] as (keyof BatchRow)[]}
        emptyTitle="No approved batches"
        emptyDescription="Batches approved by the Principal will appear here"
        csvFilename="hod-setup"
      />
    </div>
  );
}
