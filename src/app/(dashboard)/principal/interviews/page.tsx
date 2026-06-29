"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { ExternalLink, FileText, Users, Calendar, Briefcase } from "lucide-react";
import type { HiringBatch, Candidate } from "@/types";

type BatchRow = Record<string, unknown> & HiringBatch;

export default function PrincipalInterviewsPage() {
  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Detail dialog
  const [detailBatch, setDetailBatch] = useState<BatchRow | null>(null);
  const [detailCandidates, setDetailCandidates] = useState<Candidate[]>([]);
  const [loadingCandidates, setLoadingCandidates] = useState(false);

  // Action state
  const [action, setAction] = useState<"approve" | "reject" | null>(null);
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

  function openDetail(row: BatchRow) {
    setDetailBatch(row);
    setDetailCandidates([]);
    setLoadingCandidates(true);
    fetch(`/api/college/candidates?batchId=${row.id}`)
      .then((r) => r.json() as Promise<{ candidates: Candidate[] }>)
      .then((d) => setDetailCandidates(d.candidates ?? []))
      .catch(() => {})
      .finally(() => setLoadingCandidates(false));
  }

  async function handleAction() {
    if (!detailBatch || !action) return;
    setLoading(true);
    try {
      const statusMap = { approve: "APPROVED", reject: "REJECTED" } as const;
      const res = await fetch(`/api/college/hiring-batches/${detailBatch.id}`, {
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
      setDetailBatch(null);
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
      render: (row) => (
        <div className="flex gap-1 flex-wrap">
          <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); openDetail(row); }}>
            View
          </Button>
          {(row.status as string) === "PENDING" && (
            <>
              <Button size="sm" onClick={(e) => { e.stopPropagation(); openDetail(row); setAction("approve"); }}>
                Approve
              </Button>
              <Button size="sm" variant="destructive" onClick={(e) => { e.stopPropagation(); openDetail(row); setAction("reject"); }}>
                Reject
              </Button>
            </>
          )}
        </div>
      ),
    },
  ];

  const isPending = detailBatch?.status === "PENDING";

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
        onRowClick={(row) => openDetail(row)}
      />

      {/* Batch Detail + Action Dialog */}
      <Dialog
        open={!!detailBatch}
        onOpenChange={(open) => { if (!open) { setDetailBatch(null); setAction(null); setNotes(""); } }}
      >
        <DialogContent aria-describedby={undefined} className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Briefcase className="h-4 w-4 text-muted-foreground" />
              {detailBatch?.position as string}
              <StatusBadge status={(detailBatch as unknown as HiringBatch)?.status} />
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-5">
            {/* Batch overview */}
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Briefcase className="h-4 w-4 shrink-0" />
                <span><strong className="text-foreground">Department:</strong> {detailBatch?.department as string}</span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <Calendar className="h-4 w-4 shrink-0" />
                <span><strong className="text-foreground">Date:</strong> {formatDate(detailBatch?.interviewDate as Parameters<typeof formatDate>[0])}</span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <Users className="h-4 w-4 shrink-0" />
                <span><strong className="text-foreground">Panel:</strong> {(detailBatch?.panelMemberUids as string[] | undefined)?.length ?? 0} members</span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <Users className="h-4 w-4 shrink-0" />
                <span><strong className="text-foreground">Candidates:</strong> {(detailBatch?.candidateIds as string[] | undefined)?.length ?? 0}</span>
              </div>
            </div>

            {/* Candidates */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                Candidates
              </p>
              {loadingCandidates ? (
                <p className="text-sm text-muted-foreground">Loading...</p>
              ) : detailCandidates.length === 0 ? (
                <p className="text-sm text-muted-foreground">No candidates found for this batch.</p>
              ) : (
                <div className="space-y-2">
                  {detailCandidates.map((c) => (
                    <div key={c.id} className="border rounded-lg p-3 space-y-1">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-medium text-sm">{c.name}</p>
                          <p className="text-xs text-muted-foreground">{c.email} · {c.phone}</p>
                          <p className="text-xs text-muted-foreground">{c.position} · {c.department}</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Badge variant="outline" className="text-xs">
                            {c.source === "CAREERS_PAGE" ? "Careers Page" : "Referral"}
                          </Badge>
                          <StatusBadge status={c.status} />
                        </div>
                      </div>
                      {c.resumeUrl ? (
                        <a
                          href={c.resumeUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline font-medium"
                        >
                          <FileText className="h-3.5 w-3.5" />
                          View Resume
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        <span className="text-xs text-muted-foreground/60">No resume uploaded</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Principal notes */}
            {detailBatch?.principalNotes && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">Principal Notes</p>
                <p className="text-sm bg-muted/50 rounded p-2">{detailBatch.principalNotes as string}</p>
              </div>
            )}

            {/* Action section — only for PENDING */}
            {isPending && (
              <div className="border-t pt-4 space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Action</p>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant={action === "approve" ? "default" : "outline"}
                    onClick={() => setAction("approve")}
                  >Approve</Button>
                  <Button
                    size="sm"
                    variant={action === "reject" ? "destructive" : "outline"}
                    onClick={() => setAction("reject")}
                    className={action !== "reject" ? "text-destructive border-destructive hover:bg-destructive/10" : ""}
                  >Reject</Button>
                </div>

                {action === "reject" && (
                  <div className="space-y-1.5">
                    <Label>Notes (optional)</Label>
                    <Textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder={action === "reject" ? "Reason for rejection..." : "Describe required modifications..."}
                      rows={3}
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          {isPending && action && (
            <DialogFooter>
              <Button variant="outline" onClick={() => setAction(null)} disabled={loading}>
                Cancel
              </Button>
              <Button
                variant={action === "reject" ? "destructive" : "default"}
                onClick={handleAction}
                loading={loading}
                disabled={false}
              >
                {action === "approve" ? "Approve Plan" : "Reject Plan"}
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      {/* Quick approve confirm (from table row buttons) */}
      <ConfirmDialog
        open={action === "approve" && !!detailBatch && !detailCandidates.length && !loadingCandidates}
        onOpenChange={(open) => { if (!open) { setAction(null); } }}
        title="Approve Interview Plan?"
        description={`Approve the interview plan for ${detailBatch?.position as string ?? ""} in ${detailBatch?.department as string ?? ""}?`}
        confirmLabel="Approve"
        onConfirm={handleAction}
        loading={loading}
      />
    </div>
  );
}
