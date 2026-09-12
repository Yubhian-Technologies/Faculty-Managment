"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Check, X, Eye } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { researchRecordHref } from "@/lib/research/modules";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { toast } from "@/hooks/useToast";
import { ROLE_LABELS } from "@/types";
import type { DiscoveryInnovationRequest, IprStatus, IprType } from "@/types";

type DiscoveryInnovationRow = DiscoveryInnovationRequest & Record<string, unknown>;

const IPR_TYPE_LABELS: Record<IprType, string> = {
  UTILITY_PATENT: "Utility Patent", DESIGN_PATENT: "Design Patent", COPYRIGHT: "Copy Right",
};
const IPR_STATUS_LABELS: Record<IprStatus, string> = { PUBLISHED: "Published", GRANTED: "Granted" };

export default function RAndDDiscoveryInnovationPage() {
  const [records, setRecords] = useState<DiscoveryInnovationRow[]>([]);
  const router = useRouter();

  const [isLoading, setIsLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<DiscoveryInnovationRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [tab, setTab] = useState<"official" | "pending">("pending");
  const [approving, setApproving] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<DiscoveryInnovationRow | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rejecting, setRejecting] = useState(false);

  async function load() {
    setIsLoading(true);
    try {
      const res = await fetch("/api/college/discovery-innovation");
      const data = await res.json() as { records: DiscoveryInnovationRow[] };
      setRecords(data.records ?? []);
    } catch {
      toast({ variant: "destructive", title: "Failed to load IPR records" });
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const pending = useMemo(() => records.filter((r) => r.status === "PENDING"), [records]);
  const official = useMemo(() => records.filter((r) => r.status !== "PENDING"), [records]);

  async function handleDelete(record: DiscoveryInnovationRow) {
    setDeleting(true);
    try {
      const res = await fetch(`/api/college/discovery-innovation/${record.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "IPR record deleted" });
      setDeleteTarget(null);
      await load();
    } catch {
      toast({ variant: "destructive", title: "Failed to delete IPR record" });
    } finally {
      setDeleting(false);
    }
  }

  async function handleApprove(record: DiscoveryInnovationRow) {
    setApproving(record.id);
    try {
      const res = await fetch(`/api/college/discovery-innovation/${record.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "APPROVED" }),
      });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "IPR record approved" });
      await load();
    } catch {
      toast({ variant: "destructive", title: "Failed to approve IPR record" });
    } finally {
      setApproving(null);
    }
  }

  async function handleReject() {
    if (!rejectTarget) return;
    setRejecting(true);
    try {
      const res = await fetch(`/api/college/discovery-innovation/${rejectTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "REJECTED", rejectionReason: rejectReason.trim() }),
      });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "IPR record rejected" });
      setRejectTarget(null);
      setRejectReason("");
      await load();
    } catch {
      toast({ variant: "destructive", title: "Failed to reject IPR record" });
    } finally {
      setRejecting(false);
    }
  }

  function ownerBadge(row: DiscoveryInnovationRow) {
    return row.ownerDesignation ?? ROLE_LABELS[row.ownerRole] ?? row.ownerRole;
  }

  const ownerColumn: Column<DiscoveryInnovationRow> = {
    key: "ownerName",
    header: "Owner",
    render: (row) => (
      <div>
        <p className="font-medium">{row.ownerName}</p>
        <Badge variant="outline" className="text-xs font-normal">{ownerBadge(row)}</Badge>
      </div>
    ),
  };

  const sharedColumns: Column<DiscoveryInnovationRow>[] = [
    { key: "title", header: "Title" },
    { key: "applicationNumber", header: "Application No.", hideOnMobile: true },
    { key: "iprType", header: "Type", hideOnMobile: true, render: (row) => <span className="text-sm text-muted-foreground">{IPR_TYPE_LABELS[row.iprType]}</span> },
    { key: "iprStatus", header: "Status", hideOnMobile: true, render: (row) => <span className="text-sm text-muted-foreground">{IPR_STATUS_LABELS[row.iprStatus]}</span> },
  ];

  const officialColumns: Column<DiscoveryInnovationRow>[] = [
    ownerColumn,
    ...sharedColumns,
    {
      key: "actions",
      header: "",
      render: (row) => (
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); router.push(researchRecordHref("discovery-innovation", row.id)); }}>
            <Eye className="h-4 w-4 mr-1" />View
          </Button>
          <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={(e) => { e.stopPropagation(); setDeleteTarget(row); }}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ];

  const pendingColumns: Column<DiscoveryInnovationRow>[] = [
    { ...ownerColumn, header: "Submitted By" },
    ...sharedColumns,
    {
      key: "actions",
      header: "",
      render: (row) => (
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); router.push(researchRecordHref("discovery-innovation", row.id)); }}>
            <Eye className="h-4 w-4 mr-1" />View
          </Button>
          <Button
            variant="ghost" size="sm" className="text-green-700 hover:text-green-700"
            loading={approving === row.id}
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
        title="Discovery & Innovation (IPR)"
        description="Verify staff-submitted IPR records"
      />

      <div className="flex gap-2 border-b">
        <button
          type="button"
          onClick={() => setTab("official")}
          className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${tab === "official" ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}
        >
          Official Records
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

      {tab === "official" ? (
        <DataTable
          data={official}
          columns={officialColumns}
          isLoading={isLoading}
          keyExtractor={(r) => r.id}
          onRowClick={(r) => router.push(researchRecordHref("discovery-innovation", r.id))}
          searchPlaceholder="Search IPR records..."
          searchKeys={["title", "ownerName", "applicationNumber"] as (keyof DiscoveryInnovationRow)[]}
          emptyTitle="No IPR records yet"
          emptyDescription="Approved IPR records show up here"
          csvFilename="discovery-innovation"
        />
      ) : (
        <DataTable
          data={pending}
          columns={pendingColumns}
          isLoading={isLoading}
          keyExtractor={(r) => r.id}
          onRowClick={(r) => router.push(researchRecordHref("discovery-innovation", r.id))}
          searchPlaceholder="Search pending submissions..."
          searchKeys={["title", "ownerName", "applicationNumber"] as (keyof DiscoveryInnovationRow)[]}
          emptyTitle="Nothing pending"
          emptyDescription="Self-submitted IPR records awaiting verification will show up here"
        />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete IPR Record?"
        description={`This will permanently remove "${deleteTarget?.title}" from ${deleteTarget?.ownerName}'s record.`}
        confirmLabel="Delete"
        variant="destructive"
        loading={deleting}
        onConfirm={() => { if (deleteTarget) void handleDelete(deleteTarget); }}
      />

      <ConfirmDialog
        open={!!rejectTarget}
        onOpenChange={(open) => { if (!open) { setRejectTarget(null); setRejectReason(""); } }}
        title="Reject IPR Record?"
        description={`${rejectTarget?.ownerName} will be notified and can correct and resubmit "${rejectTarget?.title}".`}
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
