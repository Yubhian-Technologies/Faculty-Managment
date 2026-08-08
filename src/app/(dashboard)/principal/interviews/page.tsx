"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { toast } from "@/hooks/useToast";
import { formatDate } from "@/lib/utils";
import { Users, ChevronRight, CheckCircle2 } from "lucide-react";
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
      .catch(() => toast({ variant: "destructive", title: "Failed to load hiring batches" }))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => { loadBatches(); }, []);

  const decisionBatches = batches.filter(
    (b) =>
      b.currentPhase === "PANEL_INTERVIEW" ||
      b.currentPhase === "PRINCIPAL_FINAL_REVIEW" ||
      b.currentPhase === "COMPLETED"
  );

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
        title="Interviews & Decisions"
        description="Review HOD interview panel proposals and make final hiring decisions"
      />

      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Interview Plans</h2>
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

      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Hiring Decisions</h2>
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => <div key={i} className="h-24 bg-muted animate-pulse rounded-lg" />)}
          </div>
        ) : decisionBatches.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-16 gap-3 text-center">
              <CheckCircle2 className="h-10 w-10 text-muted-foreground/30" />
              <p className="font-medium text-muted-foreground">No batches awaiting decision</p>
              <p className="text-sm text-muted-foreground">
                Once the HOD submits interview evaluations, batches will appear here.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {decisionBatches.map((b) => {
              const isDone = b.currentPhase === "COMPLETED";
              const isScoring = b.currentPhase === "PANEL_INTERVIEW";
              return (
                <Card key={b.id} className={isDone ? "border-green-200 bg-green-50/30" : ""}>
                  <CardContent className="p-4 flex items-center justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="font-semibold">{b.position}</p>
                        {isDone ? (
                          <Badge variant="outline" className="text-green-700 border-green-300 bg-green-50 text-xs">Decisions Made</Badge>
                        ) : isScoring ? (
                          <Badge variant="outline" className="text-blue-700 border-blue-300 bg-blue-50 text-xs">Scoring in Progress</Badge>
                        ) : (
                          <Badge variant="outline" className="text-amber-700 border-amber-300 bg-amber-50 text-xs">Awaiting Decision</Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground">{b.department}</p>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                        <span><Users className="h-3 w-3 inline mr-1" />{b.candidateIds.length} candidate{b.candidateIds.length !== 1 ? "s" : ""}</span>
                        <span>{formatDate(b.interviewDate)}</span>
                      </div>
                    </div>
                    <Button asChild variant={isDone || isScoring ? "outline" : "default"} size="sm">
                      <Link href={`/principal/decisions/${b.id}`}>
                        {isDone ? "Review" : isScoring ? "Monitor" : "Decide"}
                        <ChevronRight className="h-4 w-4 ml-1" />
                      </Link>
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
