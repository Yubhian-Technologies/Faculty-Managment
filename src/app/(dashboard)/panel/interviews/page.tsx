"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { QrCode } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { toast } from "@/hooks/useToast";
import { formatDate } from "@/lib/utils";
import { useAuthStore } from "@/store/authStore";
import type { HiringBatch } from "@/types";

type BatchRow = Record<string, unknown> & HiringBatch;

export default function PanelInterviewsPage() {
  const user = useAuthStore((s) => s.user);
  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const url =
      user?.role === "HOD"
        ? "/api/college/hiring-batches?asPanelMember=true"
        : "/api/college/hiring-batches";
    fetch(url)
      .then((r) => r.json() as Promise<{ batches: BatchRow[] }>)
      .then((d) => setBatches(d.batches ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load interviews" }))
      .finally(() => setIsLoading(false));
  }, [user?.role]);

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
      header: "Date",
      render: (row) => formatDate(row.interviewDate as Parameters<typeof formatDate>[0]),
    },
    {
      key: "interviewVenue",
      header: "Venue",
      hideOnMobile: true,
      render: (row) => (row.interviewVenue as string) || <span className="text-muted-foreground text-xs">TBA</span>,
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
      header: "",
      render: (row) => {
        const isCoordinator = (row as unknown as HiringBatch).coordinatorUid === user?.uid;
        return (
          <div className="flex items-center gap-2">
            {isCoordinator && (
              <Badge variant="secondary" className="text-xs shrink-0">Coordinator</Badge>
            )}
            {isCoordinator && (row as unknown as HiringBatch).setupComplete && (
              <Button size="sm" variant="outline" asChild>
                <Link href={`/coordinator/${row.id as string}`}>
                  <QrCode className="h-3.5 w-3.5 mr-1" />
                  QR Display
                </Link>
              </Button>
            )}
            <Button size="sm" variant="outline" asChild>
              <Link href={`/panel/interviews/${row.id as string}`}>
                View
              </Link>
            </Button>
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Interviews"
        description="Assigned interview batches and feedback submissions"
      />

      <DataTable
        data={batches}
        columns={columns}
        isLoading={isLoading}
        keyExtractor={(r) => r.id as string}
        searchPlaceholder="Search interviews..."
        searchKeys={["position", "department"] as (keyof BatchRow)[]}
        emptyTitle="No interviews assigned"
        emptyDescription="You will be added to interview panels by the HOD"
        csvFilename="panel-interviews"
      />
    </div>
  );
}
