"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { toast } from "@/hooks/useToast";
import { formatDate } from "@/lib/utils";
import type { HiringBatch } from "@/types";

type BatchRow = Record<string, unknown> & HiringBatch;

export default function PrincipalDecisionsPage() {
  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selected, setSelected] = useState<BatchRow | null>(null);
  const [decisionAction, setDecisionAction] = useState<"SELECTED" | "REJECTED" | null>(null);
  const [loading, setLoading] = useState(false);

  function loadBatches() {
    setIsLoading(true);
    fetch("/api/college/hiring-batches")
      .then((r) => r.json() as Promise<{ batches: BatchRow[] }>)
      .then((d) => {
        // Show batches where demo is complete (all feedback stages finished)
        const done = (d.batches ?? []).filter(
          (b) => b.demoComplete && !["COMPLETED", "REJECTED"].includes(b.status as string)
        );
        setBatches(done);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load" }))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => { loadBatches(); }, []);

  async function handleDecision() {
    if (!selected || !decisionAction) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/college/hiring-batches/${selected.id as string}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: decisionAction === "SELECTED" ? "COMPLETED" : "REJECTED" }),
      });
      if (!res.ok) throw new Error();
      toast({
        variant: "success",
        title: decisionAction === "SELECTED" ? "Batch finalized" : "Batch rejected",
        description: "HOD has been notified.",
      });
      setSelected(null);
      setDecisionAction(null);
      loadBatches();
    } catch {
      toast({ variant: "destructive", title: "Action failed" });
    } finally {
      setLoading(false);
    }
  }

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
      key: "status",
      header: "Status",
      render: (row) => <StatusBadge status={(row as unknown as HiringBatch).status} />,
    },
    {
      key: "actions",
      header: "Actions",
      render: (row) =>
        (row.status as string) !== "COMPLETED" && (row.status as string) !== "REJECTED" ? (
          <div className="flex gap-1">
            <Button
              size="sm"
              onClick={(e) => { e.stopPropagation(); setSelected(row); setDecisionAction("SELECTED"); }}
            >
              Finalize
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={(e) => { e.stopPropagation(); setSelected(row); setDecisionAction("REJECTED"); }}
            >
              Reject
            </Button>
          </div>
        ) : null,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Hiring Decisions"
        description="Make final hiring decisions after interviews are complete"
      />

      <DataTable
        data={batches}
        columns={columns}
        isLoading={isLoading}
        keyExtractor={(r) => r.id as string}
        searchPlaceholder="Search..."
        searchKeys={["position", "department"] as (keyof BatchRow)[]}
        emptyTitle="No pending decisions"
        emptyDescription="Batches will appear here after interviews are completed"
        csvFilename="hiring-decisions"
      />

      <ConfirmDialog
        open={!!selected && !!decisionAction}
        onOpenChange={(open) => { if (!open) { setSelected(null); setDecisionAction(null); } }}
        title={decisionAction === "SELECTED" ? "Finalize Hiring?" : "Reject Batch?"}
        description={`${decisionAction === "SELECTED" ? "Finalize" : "Reject"} the hiring batch for ${selected?.position as string} in ${selected?.department as string}?`}
        confirmLabel={decisionAction === "SELECTED" ? "Yes, Finalize" : "Yes, Reject"}
        variant={decisionAction === "REJECTED" ? "destructive" : "default"}
        onConfirm={handleDecision}
        loading={loading}
      />
    </div>
  );
}
