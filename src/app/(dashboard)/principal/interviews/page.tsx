"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/useToast";
import { formatDate } from "@/lib/utils";
import type { HiringBatch } from "@/types";

type BatchRow = Record<string, unknown> & HiringBatch;

export default function PrincipalInterviewsPage() {
  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selected, setSelected] = useState<BatchRow | null>(null);
  const [action, setAction] = useState<"approve" | "reject" | "modify" | null>(null);
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);

  function loadBatches() {
    setIsLoading(true);
    fetch("/api/college/hiring-batches")
      .then((r) => r.json() as Promise<{ batches: BatchRow[] }>)
      .then((d) => setBatches(d.batches ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load interview plans" }))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => { loadBatches(); }, []);

  async function handleAction() {
    if (!selected || !action) return;
    setLoading(true);
    try {
      const statusMap = { approve: "APPROVED", reject: "REJECTED", modify: "MODIFIED" } as const;
      const res = await fetch(`/api/college/hiring-batches/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: statusMap[action], principalNotes: notes }),
      });
      if (!res.ok) throw new Error();
      toast({
        variant: "success",
        title: action === "approve" ? "Plan approved" : action === "reject" ? "Plan rejected" : "Modifications sent",
        description: "HOD has been notified.",
      });
      setSelected(null);
      setAction(null);
      setNotes("");
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
      render: (row) =>
        (row.status as string) === "PENDING" ? (
          <div className="flex gap-1 flex-wrap">
            <Button size="sm" onClick={(e) => { e.stopPropagation(); setSelected(row); setAction("approve"); }}>
              Approve
            </Button>
            <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); setSelected(row); setAction("modify"); }}>
              Modify
            </Button>
            <Button size="sm" variant="destructive" onClick={(e) => { e.stopPropagation(); setSelected(row); setAction("reject"); }}>
              Reject
            </Button>
          </div>
        ) : null,
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
      />

      {/* Approve Confirm */}
      <ConfirmDialog
        open={action === "approve" && !!selected}
        onOpenChange={(open) => { if (!open) { setAction(null); setSelected(null); } }}
        title="Approve Interview Plan?"
        description={`Approve the interview plan for ${selected?.position as string} in ${selected?.department as string}? The College Office will be notified to set up logistics.`}
        confirmLabel="Approve"
        onConfirm={handleAction}
        loading={loading}
      />

      {/* Reject / Modify Dialog */}
      <Dialog
        open={(action === "reject" || action === "modify") && !!selected}
        onOpenChange={(open) => { if (!open) { setAction(null); setSelected(null); setNotes(""); } }}
      >
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>
              {action === "reject" ? "Reject Interview Plan" : "Request Modifications"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {action === "reject" ? "Rejecting" : "Modifying"}{" "}
              <strong>{selected?.position as string}</strong> in {selected?.department as string}.
            </p>
            <div className="space-y-2">
              <Label>Notes {action === "reject" ? "(optional)" : "*"}</Label>
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={
                  action === "reject"
                    ? "Provide reason for rejection..."
                    : "Describe the modifications needed..."
                }
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setAction(null); setSelected(null); setNotes(""); }} disabled={loading}>
              Cancel
            </Button>
            <Button
              variant={action === "reject" ? "destructive" : "default"}
              onClick={handleAction}
              loading={loading}
            >
              {action === "reject" ? "Reject" : "Send Modifications"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
