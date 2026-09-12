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
import type { SponsoredProjectRequest } from "@/types";

type SponsoredProjectRow = SponsoredProjectRequest & Record<string, unknown>;

export default function RAndDSponsoredProjectsPage() {
  const [projects, setProjects] = useState<SponsoredProjectRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<SponsoredProjectRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [tab, setTab] = useState<"official" | "pending">("pending");
  const [approving, setApproving] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<SponsoredProjectRow | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rejecting, setRejecting] = useState(false);

  async function load() {
    setIsLoading(true);
    try {
      const res = await fetch("/api/college/sponsored-projects");
      const data = await res.json() as { projects: SponsoredProjectRow[] };
      setProjects(data.projects ?? []);
    } catch {
      toast({ variant: "destructive", title: "Failed to load sponsored projects" });
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const pending = useMemo(() => projects.filter((p) => p.status === "PENDING"), [projects]);
  const official = useMemo(() => projects.filter((p) => p.status !== "PENDING"), [projects]);

  async function handleDelete(project: SponsoredProjectRow) {
    setDeleting(true);
    try {
      const res = await fetch(`/api/college/sponsored-projects/${project.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "Sponsored project deleted" });
      setDeleteTarget(null);
      await load();
    } catch {
      toast({ variant: "destructive", title: "Failed to delete sponsored project" });
    } finally {
      setDeleting(false);
    }
  }

  async function handleApprove(project: SponsoredProjectRow) {
    setApproving(project.id);
    try {
      const res = await fetch(`/api/college/sponsored-projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "APPROVED" }),
      });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "Sponsored project approved" });
      await load();
    } catch {
      toast({ variant: "destructive", title: "Failed to approve sponsored project" });
    } finally {
      setApproving(null);
    }
  }

  async function handleReject() {
    if (!rejectTarget) return;
    setRejecting(true);
    try {
      const res = await fetch(`/api/college/sponsored-projects/${rejectTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "REJECTED", rejectionReason: rejectReason.trim() }),
      });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "Sponsored project rejected" });
      setRejectTarget(null);
      setRejectReason("");
      await load();
    } catch {
      toast({ variant: "destructive", title: "Failed to reject sponsored project" });
    } finally {
      setRejecting(false);
    }
  }

  function ownerBadge(row: SponsoredProjectRow) {
    return row.ownerDesignation ?? ROLE_LABELS[row.ownerRole] ?? row.ownerRole;
  }

  const ownerColumn: Column<SponsoredProjectRow> = {
    key: "ownerName",
    header: "Owner",
    render: (row) => (
      <div>
        <p className="font-medium">{row.ownerName}</p>
        <Badge variant="outline" className="text-xs font-normal">{ownerBadge(row)}</Badge>
      </div>
    ),
  };

  const sharedColumns: Column<SponsoredProjectRow>[] = [
    { key: "title", header: "Title" },
    { key: "agencyName", header: "Agency", hideOnMobile: true },
    { key: "applicationNumber", header: "Application No.", hideOnMobile: true },
    {
      key: "projectStatus", header: "Status", hideOnMobile: true,
      render: (row) => (
        <span className="text-sm text-muted-foreground">
          {row.projectStatus === "APPLIED" ? "Applied" : `Sanctioned - ${row.sanctionedStatus === "COMPLETED" ? "Completed" : "Ongoing"}`}
        </span>
      ),
    },
  ];

  const officialColumns: Column<SponsoredProjectRow>[] = [
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

  const pendingColumns: Column<SponsoredProjectRow>[] = [
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
        title="Sponsored Research Projects"
        description="Verify staff-submitted sponsored research project records"
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
          searchPlaceholder="Search sponsored projects..."
          searchKeys={["title", "ownerName", "agencyName"] as (keyof SponsoredProjectRow)[]}
          emptyTitle="No sponsored projects yet"
          emptyDescription="Approved sponsored project records show up here"
          csvFilename="sponsored-research-projects"
        />
      ) : (
        <DataTable
          data={pending}
          columns={pendingColumns}
          isLoading={isLoading}
          keyExtractor={(r) => r.id}
          searchPlaceholder="Search pending submissions..."
          searchKeys={["title", "ownerName", "agencyName"] as (keyof SponsoredProjectRow)[]}
          emptyTitle="Nothing pending"
          emptyDescription="Self-submitted sponsored projects awaiting verification will show up here"
        />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete Sponsored Project?"
        description={`This will permanently remove "${deleteTarget?.title}" from ${deleteTarget?.ownerName}'s record.`}
        confirmLabel="Delete"
        variant="destructive"
        loading={deleting}
        onConfirm={() => { if (deleteTarget) void handleDelete(deleteTarget); }}
      />

      <ConfirmDialog
        open={!!rejectTarget}
        onOpenChange={(open) => { if (!open) { setRejectTarget(null); setRejectReason(""); } }}
        title="Reject Sponsored Project?"
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
