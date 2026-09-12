"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, Check, X } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { researchRecordHref } from "@/lib/research/modules";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { toast } from "@/hooks/useToast";
import { ROLE_LABELS } from "@/types";
import type { ResearchProfileRequest } from "@/types";

type ResearchProfileRow = ResearchProfileRequest & Record<string, unknown>;

export default function RAndDResearchProfilesPage() {
  const router = useRouter();
  const [requests, setRequests] = useState<ResearchProfileRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [tab, setTab] = useState<"verified" | "pending">("pending");
  const [approving, setApproving] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<ResearchProfileRow | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rejecting, setRejecting] = useState(false);

  async function load() {
    setIsLoading(true);
    try {
      const res = await fetch("/api/college/research-profile");
      const data = await res.json() as { requests: ResearchProfileRow[] };
      setRequests(data.requests ?? []);
    } catch {
      toast({ variant: "destructive", title: "Failed to load research profiles" });
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const pending = useMemo(() => requests.filter((r) => r.status === "PENDING"), [requests]);
  const verified = useMemo(() => requests.filter((r) => r.status !== "PENDING"), [requests]);

  async function handleApprove(req: ResearchProfileRow) {
    setApproving(req.uid);
    try {
      const res = await fetch(`/api/college/research-profile/${req.uid}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "APPROVED" }),
      });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "Research profile approved" });
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
      const res = await fetch(`/api/college/research-profile/${rejectTarget.uid}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "REJECTED", rejectionReason: rejectReason.trim() }),
      });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "Research profile rejected" });
      setRejectTarget(null);
      setRejectReason("");
      await load();
    } catch {
      toast({ variant: "destructive", title: "Failed to reject" });
    } finally {
      setRejecting(false);
    }
  }

  function ownerBadge(row: ResearchProfileRow) {
    return row.ownerDesignation ?? ROLE_LABELS[row.ownerRole] ?? row.ownerRole;
  }

  const ownerColumn: Column<ResearchProfileRow> = {
    key: "ownerName",
    header: "Owner",
    render: (row) => (
      <div>
        <p className="font-medium">{row.ownerName}</p>
        <Badge variant="outline" className="text-xs font-normal">{ownerBadge(row)}</Badge>
      </div>
    ),
  };

  const idColumns: Column<ResearchProfileRow>[] = [
    { key: "orcidId", header: "ORCID iD", hideOnMobile: true, render: (row) => <span className="text-sm text-muted-foreground">{row.orcidId || "-"}</span> },
    { key: "scopusAuthorId", header: "Scopus Author ID", hideOnMobile: true, render: (row) => <span className="text-sm text-muted-foreground">{row.scopusAuthorId || "-"}</span> },
    { key: "researcherId", header: "Researcher ID", hideOnMobile: true, render: (row) => <span className="text-sm text-muted-foreground">{row.researcherId || "-"}</span> },
    { key: "googleScholarId", header: "Google Scholar ID", hideOnMobile: true, render: (row) => <span className="text-sm text-muted-foreground">{row.googleScholarId || "-"}</span> },
    { key: "irinsProfile", header: "IRINS Profile", hideOnMobile: true, render: (row) => <span className="text-sm text-muted-foreground">{row.irinsProfile || "-"}</span> },
  ];

  const verifiedColumns: Column<ResearchProfileRow>[] = [
    ownerColumn,
    ...idColumns,
    {
      key: "status",
      header: "Status",
      render: (row) => <Badge variant={row.status === "APPROVED" ? "approved" : "rejected"} className="text-xs">{row.status === "APPROVED" ? "Verified" : "Rejected"}</Badge>,
    },
    {
      key: "actions",
      header: "",
      render: (row) => (
        <div className="flex items-center gap-1">
          <Button
            variant="ghost" size="sm"
            onClick={(e) => { e.stopPropagation(); router.push(researchRecordHref("research-profiles", row.id)); }}
          >
            <Eye className="h-4 w-4 mr-1" />View
          </Button>
        </div>
      ),
    },
  ];

  const pendingColumns: Column<ResearchProfileRow>[] = [
    { ...ownerColumn, header: "Submitted By" },
    ...idColumns,
    {
      key: "actions",
      header: "",
      render: (row) => (
        <div className="flex items-center gap-1">
          <Button
            variant="ghost" size="sm"
            onClick={(e) => { e.stopPropagation(); router.push(researchRecordHref("research-profiles", row.id)); }}
          >
            <Eye className="h-4 w-4 mr-1" />View
          </Button>
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
        title="Research Profiles"
        description="Verify staff-submitted researcher IDs (ORCID, Scopus, Researcher ID, Google Scholar, IRINS)"
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
          onRowClick={(r) => router.push(researchRecordHref("research-profiles", r.id))}
          searchPlaceholder="Search research profiles..."
          searchKeys={["ownerName"] as (keyof ResearchProfileRow)[]}
          emptyTitle="Nothing verified yet"
          emptyDescription="Approved and rejected researcher-ID submissions show up here"
          csvFilename="research-profiles"
        />
      ) : (
        <DataTable
          data={pending}
          columns={pendingColumns}
          isLoading={isLoading}
          keyExtractor={(r) => r.id}
          onRowClick={(r) => router.push(researchRecordHref("research-profiles", r.id))}
          searchPlaceholder="Search pending submissions..."
          searchKeys={["ownerName"] as (keyof ResearchProfileRow)[]}
          emptyTitle="Nothing pending"
          emptyDescription="Self-submitted researcher IDs awaiting verification will show up here"
        />
      )}

      <ConfirmDialog
        open={!!rejectTarget}
        onOpenChange={(open) => { if (!open) { setRejectTarget(null); setRejectReason(""); } }}
        title="Reject Research Profile?"
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
