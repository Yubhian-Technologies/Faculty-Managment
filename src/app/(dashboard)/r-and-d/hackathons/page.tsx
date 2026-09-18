"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, Trash2, Check, X } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { researchRecordHref } from "@/lib/research/modules";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { toast } from "@/hooks/useToast";
import { ROLE_LABELS } from "@/types";
import type { HackathonEventType, HackathonLevel, HackathonRequest } from "@/types";

type HackathonRow = HackathonRequest & Record<string, unknown>;

const EVENT_TYPE_LABELS: Record<HackathonEventType, string> = {
  HACKATHON: "Hackathon", IDEATHON: "Ideathon", INNOVATION_CHALLENGE: "Innovation Challenge",
  BUSINESS_PLAN_COMPETITION: "Business Plan Competition",
};
const LEVEL_LABELS: Record<HackathonLevel, string> = {
  INSTITUTION: "Institution", INTER_COLLEGE: "Inter-college", STATE: "State", NATIONAL: "National",
};

export default function RAndDHackathonsPage() {
  const router = useRouter();
  const [records, setRecords] = useState<HackathonRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<HackathonRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [tab, setTab] = useState<"official" | "pending">("pending");
  const [approving, setApproving] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<HackathonRow | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rejecting, setRejecting] = useState(false);

  async function load() {
    setIsLoading(true);
    try {
      const res = await fetch("/api/college/hackathons");
      const data = await res.json() as { records: HackathonRow[] };
      setRecords(data.records ?? []);
    } catch {
      toast({ variant: "destructive", title: "Failed to load records" });
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const pending = useMemo(() => records.filter((r) => r.status === "PENDING"), [records]);
  const official = useMemo(() => records.filter((r) => r.status !== "PENDING"), [records]);

  async function handleDelete(record: HackathonRow) {
    setDeleting(true);
    try {
      const res = await fetch(`/api/college/hackathons/${record.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "Record deleted" });
      setDeleteTarget(null);
      await load();
    } catch {
      toast({ variant: "destructive", title: "Failed to delete record" });
    } finally {
      setDeleting(false);
    }
  }

  async function handleApprove(record: HackathonRow) {
    setApproving(record.id);
    try {
      const res = await fetch(`/api/college/hackathons/${record.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "APPROVED" }),
      });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "Record approved" });
      await load();
    } catch {
      toast({ variant: "destructive", title: "Failed to approve record" });
    } finally {
      setApproving(null);
    }
  }

  async function handleReject() {
    if (!rejectTarget) return;
    setRejecting(true);
    try {
      const res = await fetch(`/api/college/hackathons/${rejectTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "REJECTED", rejectionReason: rejectReason.trim() }),
      });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "Record rejected" });
      setRejectTarget(null);
      setRejectReason("");
      await load();
    } catch {
      toast({ variant: "destructive", title: "Failed to reject record" });
    } finally {
      setRejecting(false);
    }
  }

  function ownerBadge(row: HackathonRow) {
    return row.ownerDesignation ?? ROLE_LABELS[row.ownerRole] ?? row.ownerRole;
  }

  const ownerColumn: Column<HackathonRow> = {
    key: "ownerName",
    header: "Owner",
    render: (row) => (
      <div>
        <p className="font-medium">{row.ownerName}</p>
        <Badge variant="outline" className="text-xs font-normal">{ownerBadge(row)}</Badge>
      </div>
    ),
  };

  const sharedColumns: Column<HackathonRow>[] = [
    { key: "eventTitle", header: "Event Title" },
    { key: "academicYear", header: "A.Y.", hideOnMobile: true },
    { key: "eventType", header: "Type", hideOnMobile: true, render: (row) => <span className="text-sm text-muted-foreground">{EVENT_TYPE_LABELS[row.eventType]}</span> },
    { key: "levelOfEvent", header: "Level", hideOnMobile: true, render: (row) => <span className="text-sm text-muted-foreground">{LEVEL_LABELS[row.levelOfEvent]}</span> },
  ];

  const officialColumns: Column<HackathonRow>[] = [
    ownerColumn,
    ...sharedColumns,
    {
      key: "actions",
      header: "",
      render: (row) => (
        <div className="flex items-center gap-1">
          <Button
            variant="ghost" size="sm"
            onClick={(e) => { e.stopPropagation(); router.push(researchRecordHref("hackathons", row.id)); }}
          >
            <Eye className="h-4 w-4 mr-1" />View
          </Button>
          <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={(e) => { e.stopPropagation(); setDeleteTarget(row); }}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ];

  const pendingColumns: Column<HackathonRow>[] = [
    { ...ownerColumn, header: "Submitted By" },
    ...sharedColumns,
    {
      key: "actions",
      header: "",
      render: (row) => (
        <div className="flex items-center gap-1">
          <Button
            variant="ghost" size="sm"
            onClick={(e) => { e.stopPropagation(); router.push(researchRecordHref("hackathons", row.id)); }}
          >
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
        title="Organizing Hackathons / Competitions"
        description="Verify staff-submitted hackathon/competition records"
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
          onRowClick={(r) => router.push(researchRecordHref("hackathons", r.id))}
          searchPlaceholder="Search events..."
          searchKeys={["eventTitle", "ownerName", "academicYear"] as (keyof HackathonRow)[]}
          emptyTitle="No records yet"
          emptyDescription="Approved hackathon/competition records show up here"
          csvFilename="hackathons"
        />
      ) : (
        <DataTable
          data={pending}
          columns={pendingColumns}
          isLoading={isLoading}
          keyExtractor={(r) => r.id}
          onRowClick={(r) => router.push(researchRecordHref("hackathons", r.id))}
          searchPlaceholder="Search pending submissions..."
          searchKeys={["eventTitle", "ownerName", "academicYear"] as (keyof HackathonRow)[]}
          emptyTitle="Nothing pending"
          emptyDescription="Self-submitted hackathon/competition records awaiting verification will show up here"
        />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete Record?"
        description={`This will permanently remove "${deleteTarget?.eventTitle}" from ${deleteTarget?.ownerName}'s record.`}
        confirmLabel="Delete"
        variant="destructive"
        loading={deleting}
        onConfirm={() => { if (deleteTarget) void handleDelete(deleteTarget); }}
      />

      <ConfirmDialog
        open={!!rejectTarget}
        onOpenChange={(open) => { if (!open) { setRejectTarget(null); setRejectReason(""); } }}
        title="Reject Record?"
        description={`${rejectTarget?.ownerName} will be notified and can correct and resubmit "${rejectTarget?.eventTitle}".`}
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
