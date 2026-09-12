"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, X } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { toast } from "@/hooks/useToast";
import { ROLE_LABELS } from "@/types";
import type { CitationMetricsRequest } from "@/types";

type CitationMetricsRow = CitationMetricsRequest & Record<string, unknown>;

export default function RAndDCitationMetricsPage() {
  const [requests, setRequests] = useState<CitationMetricsRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [tab, setTab] = useState<"verified" | "pending">("pending");
  const [approving, setApproving] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<CitationMetricsRow | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rejecting, setRejecting] = useState(false);

  async function load() {
    setIsLoading(true);
    try {
      const res = await fetch("/api/college/citation-metrics");
      const data = await res.json() as { requests: CitationMetricsRow[] };
      setRequests(data.requests ?? []);
    } catch {
      toast({ variant: "destructive", title: "Failed to load citation metrics" });
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/set-state-in-effect

  const pending = useMemo(() => requests.filter((r) => r.status === "PENDING"), [requests]);
  const verified = useMemo(() => requests.filter((r) => r.status !== "PENDING"), [requests]);

  async function handleApprove(req: CitationMetricsRow) {
    setApproving(req.uid);
    try {
      const res = await fetch(`/api/college/citation-metrics/${req.uid}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "APPROVED" }),
      });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "Citation metrics approved" });
      await load();
    } catch {
      toast({ variant: "destructive", title: "Failed to approve" });
    } finally {
      setApproving(null);
    }
  }

  async function handleReject() {
    if (!rejectTarget) return;
    setRejecting(true);
    try {
      const res = await fetch(`/api/college/citation-metrics/${rejectTarget.uid}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "REJECTED", rejectionReason: rejectReason.trim() }),
      });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "Citation metrics rejected" });
      setRejectTarget(null);
      setRejectReason("");
      await load();
    } catch {
      toast({ variant: "destructive", title: "Failed to reject" });
    } finally {
      setRejecting(false);
    }
  }

  function ownerBadge(row: CitationMetricsRow) {
    return row.ownerDesignation ?? ROLE_LABELS[row.ownerRole] ?? row.ownerRole;
  }

  const ownerColumn: Column<CitationMetricsRow> = {
    key: "ownerName",
    header: "Owner",
    render: (row) => (
      <div>
        <p className="font-medium">{row.ownerName}</p>
        <Badge variant="outline" className="text-xs font-normal">{ownerBadge(row)}</Badge>
      </div>
    ),
  };

  const metricColumns: Column<CitationMetricsRow>[] = [
    { key: "totalCitations", header: "Total Citations" },
    { key: "hIndex", header: "H-Index" },
    { key: "citationsExcludingSelf", header: "Citations (Excl. Self)", hideOnMobile: true },
    { key: "hIndexExcludingSelf", header: "H-Index (Excl. Self)", hideOnMobile: true },
  ];

  const verifiedColumns: Column<CitationMetricsRow>[] = [
    ownerColumn,
    ...metricColumns,
    {
      key: "status",
      header: "Status",
      render: (row) => <Badge variant={row.status === "APPROVED" ? "approved" : "rejected"} className="text-xs">{row.status === "APPROVED" ? "Verified" : "Rejected"}</Badge>,
    },
  ];

  const pendingColumns: Column<CitationMetricsRow>[] = [
    { ...ownerColumn, header: "Submitted By" },
    ...metricColumns,
    {
      key: "actions",
      header: "",
      render: (row) => (
        <div className="flex items-center gap-1">
          <Button
            variant="ghost" size="sm" className="text-green-700 hover:text-green-700"
            loading={approving === row.uid}
            onClick={(e) => { e.stopPropagation(); void handleApprove(row); }}
          >
            <Check className="h-4 w-4 mr-1" />Approve
          </Button>
          <Button
            variant="ghost" size="sm" className="text-destructive hover:text-destructive"
            onClick={(e) => { e.stopPropagation(); setRejectTarget(row); setRejectReason(""); }}
          >
            <X className="h-4 w-4 mr-1" />Reject
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Citations & H-Index Growth"
        description="Verify staff-submitted citation counts and H-Index metrics"
      />

      <div className="flex gap-2 border-b">
        <button
          type="button"
          onClick={() => setTab("verified")}
          className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${tab === "verified" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
        >
          Verified
        </button>
        <button
          type="button"
          onClick={() => setTab("pending")}
          className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px flex items-center gap-1.5 ${tab === "pending" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
        >
          Pending Verification
          {pending.length > 0 && <Badge variant="destructive" className="text-xs">{pending.length}</Badge>}
        </button>
      </div>

      {tab === "verified" ? (
        <DataTable
          data={verified}
          columns={verifiedColumns}
          isLoading={isLoading}
          keyExtractor={(r) => r.id}
          searchPlaceholder="Search citation metrics..."
          searchKeys={["ownerName"] as (keyof CitationMetricsRow)[]}
          emptyTitle="Nothing verified yet"
          emptyDescription="Approved and rejected citation-metrics submissions show up here"
          csvFilename="citation-metrics"
        />
      ) : (
        <DataTable
          data={pending}
          columns={pendingColumns}
          isLoading={isLoading}
          keyExtractor={(r) => r.id}
          searchPlaceholder="Search pending submissions..."
          searchKeys={["ownerName"] as (keyof CitationMetricsRow)[]}
          emptyTitle="Nothing pending"
          emptyDescription="Self-submitted citation metrics awaiting verification will show up here"
        />
      )}

      <ConfirmDialog
        open={!!rejectTarget}
        onOpenChange={(open) => { if (!open) { setRejectTarget(null); setRejectReason(""); } }}
        title="Reject Citation Metrics?"
        description={`${rejectTarget?.ownerName} will be notified and can correct and resubmit.`}
        confirmLabel="Reject"
        variant="destructive"
        loading={rejecting}
        confirmDisabled={!rejectReason.trim()}
        onConfirm={() => void handleReject()}
      >
        <Textarea
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
          placeholder="Reason for rejection (required)..."
          rows={3}
        />
      </ConfirmDialog>
    </div>
  );
}
