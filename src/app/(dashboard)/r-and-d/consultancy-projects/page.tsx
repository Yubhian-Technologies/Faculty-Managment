"use client";

import { useEffect, useMemo, useState } from "react";
import { Trash2, Check, X } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { toast } from "@/hooks/useToast";
import { ROLE_LABELS } from "@/types";
import {
  CONSULTANCY_CATEGORY_LABELS, CONSULTANCY_CLIENT_TYPE_LABELS,
} from "@/lib/research/consultancyProjectOptions";
import type { ConsultancyProjectRequest } from "@/types";

type ConsultancyProjectRow = ConsultancyProjectRequest & Record<string, unknown>;

export default function RAndDConsultancyProjectsPage() {
  const [projects, setProjects] = useState<ConsultancyProjectRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<ConsultancyProjectRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [tab, setTab] = useState<"official" | "pending">("pending");
  const [approving, setApproving] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<ConsultancyProjectRow | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rejecting, setRejecting] = useState(false);

  async function load() {
    setIsLoading(true);
    try {
      const res = await fetch("/api/college/consultancy-projects");
      const data = await res.json() as { projects: ConsultancyProjectRow[] };
      setProjects(data.projects ?? []);
    } catch {
      toast({ variant: "destructive", title: "Failed to load consultancy projects" });
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const pending = useMemo(() => projects.filter((p) => p.status === "PENDING"), [projects]);
  const official = useMemo(() => projects.filter((p) => p.status !== "PENDING"), [projects]);

  async function handleDelete(project: ConsultancyProjectRow) {
    setDeleting(true);
    try {
      const res = await fetch(`/api/college/consultancy-projects/${project.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "Consultancy project deleted" });
      setDeleteTarget(null);
      await load();
    } catch {
      toast({ variant: "destructive", title: "Failed to delete consultancy project" });
    } finally {
      setDeleting(false);
    }
  }

  async function handleApprove(project: ConsultancyProjectRow) {
    setApproving(project.id);
    try {
      const res = await fetch(`/api/college/consultancy-projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "APPROVED" }),
      });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "Consultancy project approved" });
      await load();
    } catch {
      toast({ variant: "destructive", title: "Failed to approve consultancy project" });
    } finally {
      setApproving(null);
    }
  }

  async function handleReject() {
    if (!rejectTarget) return;
    setRejecting(true);
    try {
      const res = await fetch(`/api/college/consultancy-projects/${rejectTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "REJECTED", rejectionReason: rejectReason.trim() }),
      });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "Consultancy project rejected" });
      setRejectTarget(null);
      setRejectReason("");
      await load();
    } catch {
      toast({ variant: "destructive", title: "Failed to reject consultancy project" });
    } finally {
      setRejecting(false);
    }
  }

  function ownerBadge(row: ConsultancyProjectRow) {
    return row.ownerDesignation ?? ROLE_LABELS[row.ownerRole] ?? row.ownerRole;
  }

  const ownerColumn: Column<ConsultancyProjectRow> = {
    key: "ownerName",
    header: "Owner",
    render: (row) => (
      <div>
        <p className="font-medium">{row.ownerName}</p>
        <Badge variant="outline" className="text-xs font-normal">{ownerBadge(row)}</Badge>
      </div>
    ),
  };

  const sharedColumns: Column<ConsultancyProjectRow>[] = [
    { key: "title", header: "Title" },
    { key: "clientName", header: "Client", hideOnMobile: true },
    {
      key: "clientType", header: "Client Type", hideOnMobile: true,
      render: (row) => <span className="text-sm text-muted-foreground">{CONSULTANCY_CLIENT_TYPE_LABELS[row.clientType]}</span>,
    },
    {
      key: "consultancyCategory", header: "Category", hideOnMobile: true,
      render: (row) => <span className="text-sm text-muted-foreground">{CONSULTANCY_CATEGORY_LABELS[row.consultancyCategory]}</span>,
    },
    {
      key: "consultancyAmount", header: "Amount (Rs.)", hideOnMobile: true,
      render: (row) => <span className="text-sm text-muted-foreground">{row.consultancyAmount ?? "-"}</span>,
    },
  ];

  const officialColumns: Column<ConsultancyProjectRow>[] = [
    ownerColumn,
    ...sharedColumns,
    {
      key: "actions",
      header: "",
      render: (row) => (
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={(e) => { e.stopPropagation(); setDeleteTarget(row); }}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ];

  const pendingColumns: Column<ConsultancyProjectRow>[] = [
    { ...ownerColumn, header: "Submitted By" },
    ...sharedColumns,
    {
      key: "actions",
      header: "",
      render: (row) => (
        <div className="flex items-center gap-1">
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
        title="Consultancy Projects"
        description="Verify staff-submitted consultancy project records"
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
          searchPlaceholder="Search consultancy projects..."
          searchKeys={["title", "ownerName", "clientName"] as (keyof ConsultancyProjectRow)[]}
          emptyTitle="No consultancy projects yet"
          emptyDescription="Approved consultancy project records show up here"
          csvFilename="consultancy-projects"
        />
      ) : (
        <DataTable
          data={pending}
          columns={pendingColumns}
          isLoading={isLoading}
          keyExtractor={(r) => r.id}
          searchPlaceholder="Search pending submissions..."
          searchKeys={["title", "ownerName", "clientName"] as (keyof ConsultancyProjectRow)[]}
          emptyTitle="Nothing pending"
          emptyDescription="Self-submitted consultancy projects awaiting verification will show up here"
        />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete Consultancy Project?"
        description={`This will permanently remove "${deleteTarget?.title}" from ${deleteTarget?.ownerName}'s record.`}
        confirmLabel="Delete"
        variant="destructive"
        loading={deleting}
        onConfirm={() => { if (deleteTarget) void handleDelete(deleteTarget); }}
      />

      <ConfirmDialog
        open={!!rejectTarget}
        onOpenChange={(open) => { if (!open) { setRejectTarget(null); setRejectReason(""); } }}
        title="Reject Consultancy Project?"
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
