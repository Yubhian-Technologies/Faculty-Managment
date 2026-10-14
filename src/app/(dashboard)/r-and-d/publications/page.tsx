"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, FlaskConical, Plus, Pencil, Trash2, Upload, Check, X } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { researchRecordHref } from "@/lib/research/modules";
import { ChangedFieldsButton } from "@/components/research/PendingChangesPanel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { toast } from "@/hooks/useToast";
import { ROLE_LABELS } from "@/types";
import type { ResearchPublication } from "@/types";

type PublicationRow = ResearchPublication & Record<string, unknown>;

// `createdAt` as sent over JSON - an admin Timestamp serializes to _seconds,
// and a record stored before it existed sorts last rather than first.
function submittedAt(row: PublicationRow): number {
  const ts = row.createdAt as { _seconds?: number; seconds?: number } | undefined;
  return (ts?._seconds ?? ts?.seconds ?? 0) * 1000;
}

// What the route actually refused with, so a refusal is readable rather than a
// bare "Failed to ..." with the reason thrown away.
async function serverError(res: Response): Promise<string> {
  try {
    const { error } = (await res.json()) as { error?: string };
    return error || `Request failed (${res.status})`;
  } catch {
    return `Request failed (${res.status})`;
  }
}

export default function RAndDPublicationsPage() {
  const router = useRouter();
  const [publications, setPublications] = useState<PublicationRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<PublicationRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [tab, setTab] = useState<"verified" | "pending">("verified");
  const [approving, setApproving] = useState<string | null>(null);
  const [rejectTarget, setRejectTarget] = useState<PublicationRow | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rejecting, setRejecting] = useState(false);

  async function load() {
    setIsLoading(true);
    try {
      const res = await fetch("/api/college/publications?scope=all");
      const data = await res.json() as { publications: PublicationRow[] };
      setPublications(data.publications ?? []);
    } catch {
      toast({ variant: "destructive", title: "Failed to load publications" });
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  // Newest submission first. The API orders publications by the YEAR OF
  // PUBLICATION, which is right for a record list but wrong for a review
  // queue: a paper from 2010 submitted a minute ago landed halfway down a long
  // list and looked as though it had never arrived.
  const pending = useMemo(
    () => publications
      .filter((p) => p.status === "PENDING")
      .sort((a, b) => submittedAt(b) - submittedAt(a)),
    [publications],
  );
  // A publication is either waiting for R&D or verified by them - every record
  // goes through verification now, whoever entered it (see
  // resolveSubmissionRoute). A record with no status predates that and was
  // R&D-entered, so it counts as verified.
  const verified = useMemo(
    () => publications.filter((p) => !p.status || p.status === "APPROVED"),
    [publications],
  );

  async function handleDelete(pub: PublicationRow) {
    setDeleting(true);
    try {
      const res = await fetch(`/api/college/publications/${pub.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "Publication deleted" });
      setDeleteTarget(null);
      await load();
    } catch {
      toast({ variant: "destructive", title: "Failed to delete publication" });
    } finally {
      setDeleting(false);
    }
  }

  async function handleApprove(pub: PublicationRow) {
    setApproving(pub.id);
    try {
      const res = await fetch(`/api/college/publications/${pub.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "APPROVED" }),
      });
      if (!res.ok) throw new Error(await serverError(res));
      toast({ variant: "success", title: "Publication approved" });
      await load();
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Failed to approve publication",
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setApproving(null);
    }
  }

  async function handleReject() {
    if (!rejectTarget) return;
    setRejecting(true);
    try {
      const res = await fetch(`/api/college/publications/${rejectTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "REJECTED", rejectionReason: rejectReason.trim() }),
      });
      if (!res.ok) throw new Error(await serverError(res));
      toast({ variant: "success", title: "Publication rejected" });
      setRejectTarget(null);
      setRejectReason("");
      await load();
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Failed to reject publication",
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setRejecting(false);
    }
  }

  function ownerBadge(row: PublicationRow) {
    return row.ownerDesignation ?? ROLE_LABELS[row.ownerRole] ?? row.ownerRole;
  }

  const verifiedColumns: Column<PublicationRow>[] = [
    {
      key: "ownerName",
      header: "Owner",
      render: (row) => (
        <div>
          <p className="font-medium">{row.ownerName}</p>
          <Badge variant="outline" className="text-xs font-normal">{ownerBadge(row)}</Badge>
        </div>
      ),
    },
    { key: "title", header: "Title" },
    { key: "journalOrConference", header: "Journal / Conference", hideOnMobile: true },
    { key: "publicationYear", header: "Year" },
    {
      key: "indexing",
      header: "Indexing",
      hideOnMobile: true,
      render: (row) => <span className="text-sm text-muted-foreground">{row.indexing || "-"}</span>,
    },
    {
      key: "venueType",
      header: "Type",
      hideOnMobile: true,
      render: (row) => <span className="text-sm text-muted-foreground">{row.venueType || "-"}</span>,
    },
    {
      key: "actions",
      header: "",
      render: (row) => (
        <div className="flex items-center gap-1">
          <Button
            variant="ghost" size="sm"
            onClick={(e) => { e.stopPropagation(); router.push(researchRecordHref("publications", row.id)); }}
          >
            <Eye className="h-4 w-4 mr-1" />View
          </Button>
          <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); router.push(`/r-and-d/publications/${row.id}/edit`); }}>
            <Pencil className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" onClick={(e) => { e.stopPropagation(); setDeleteTarget(row); }}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ];

  const pendingColumns: Column<PublicationRow>[] = [
    {
      key: "ownerName",
      header: "Submitted By",
      render: (row) => (
        <div>
          <p className="font-medium">{row.ownerName}</p>
          <Badge variant="outline" className="text-xs font-normal">{ownerBadge(row)}</Badge>
        </div>
      ),
    },
    { key: "title", header: "Title" },
    { key: "journalOrConference", header: "Journal / Conference", hideOnMobile: true },
    { key: "publicationYear", header: "Year" },
    {
      key: "actions",
      header: "",
      render: (row) => (
        <div className="flex items-center gap-1">
          <ChangedFieldsButton record={row} />
          <Button
            variant="ghost" size="sm"
            onClick={(e) => { e.stopPropagation(); router.push(researchRecordHref("publications", row.id)); }}
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
        title="Research Publications"
        description="Verify and manage publication records for every staff member"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => router.push("/r-and-d/publications/import")}>
              <Upload className="h-4 w-4 mr-2" />Import
            </Button>
            <Button onClick={() => router.push("/r-and-d/publications/new")}>
              <Plus className="h-4 w-4 mr-2" />Add Publication
            </Button>
          </div>
        }
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
          onRowClick={(r) => router.push(researchRecordHref("publications", r.id))}
          searchPlaceholder="Search publications..."
          searchKeys={["title", "ownerName", "journalOrConference"] as (keyof PublicationRow)[]}
          emptyTitle="No verified publications yet"
          emptyDescription="Records appear here once they have been verified"
          emptyAction={
            <Button onClick={() => router.push("/r-and-d/publications/new")}>
              <FlaskConical className="h-4 w-4 mr-2" />Add Publication
            </Button>
          }
          csvFilename="research-publications"
        />
      ) : (
        <DataTable
          data={pending}
          columns={pendingColumns}
          isLoading={isLoading}
          keyExtractor={(r) => r.id}
          onRowClick={(r) => router.push(researchRecordHref("publications", r.id))}
          searchPlaceholder="Search pending submissions..."
          searchKeys={["title", "ownerName", "journalOrConference"] as (keyof PublicationRow)[]}
          emptyTitle="Nothing pending"
          emptyDescription="Self-submitted publications awaiting verification will show up here"
        />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Delete Publication?"
        description={`This will permanently remove "${deleteTarget?.title}" from ${deleteTarget?.ownerName}'s record.`}
        confirmLabel="Delete"
        variant="destructive"
        loading={deleting}
        onConfirm={() => { if (deleteTarget) void handleDelete(deleteTarget); }}
      />

      <ConfirmDialog
        open={!!rejectTarget}
        onOpenChange={(open) => { if (!open) { setRejectTarget(null); setRejectReason(""); } }}
        title="Reject Publication?"
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
