"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, XCircle } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { toast } from "@/hooks/useToast";
import { formatDate } from "@/lib/utils";
import type { EmailCreationRequest, EmailRequestStatus } from "@/types";
import { EMAIL_REQUEST_STATUS_LABELS } from "@/types";

type Row = Record<string, unknown> & EmailCreationRequest;

const BADGE_VARIANT: Record<EmailRequestStatus, "pending" | "completed" | "rejected"> = {
  PENDING: "pending",
  COMPLETED: "completed",
  CANCELLED: "rejected",
};

export default function EmailRequestsPage() {
  const router = useRouter();
  const [requests, setRequests] = useState<Row[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [cancelTarget, setCancelTarget] = useState<Row | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);

  function load() {
    setIsLoading(true);
    fetch("/api/college/email-requests")
      .then((r) => r.json() as Promise<{ requests: Row[] }>)
      .then((d) => setRequests(d.requests ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load email requests" }))
      .finally(() => setIsLoading(false));
  }

  // Awaited in a wrapper so load()'s setState calls aren't reachable
  // synchronously from the effect body (react-hooks/set-state-in-effect).
  useEffect(() => { void (async () => { await load(); })(); }, []);

  async function confirmCancel() {
    if (!cancelTarget) return;
    setIsCancelling(true);
    try {
      const res = await fetch(`/api/college/email-requests/${cancelTarget.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "CANCEL" }),
      });
      if (!res.ok) {
        const err = (await res.json()) as { error?: string };
        throw new Error(err.error ?? "Failed to cancel");
      }
      toast({ variant: "success", title: "Request cancelled" });
      setCancelTarget(null);
      load();
    } catch (err) {
      toast({ variant: "destructive", title: "Failed to cancel", description: err instanceof Error ? err.message : undefined });
    } finally {
      setIsCancelling(false);
    }
  }

  const columns: Column<Row>[] = [
    {
      key: "candidateName",
      header: "Candidate",
      render: (row) => (
        <div>
          <p className="font-medium">{row.candidateName}</p>
          <p className="text-xs text-muted-foreground">{row.designation} · {row.department}</p>
        </div>
      ),
    },
    {
      key: "preferred",
      header: "Preferred Emails",
      hideOnMobile: true,
      render: (row) => (
        <div className="text-xs text-muted-foreground space-y-0.5">
          {row.preferredEmail1 && <p>{row.preferredEmail1}</p>}
          {row.preferredEmail2 && <p>{row.preferredEmail2}</p>}
          {!row.preferredEmail1 && !row.preferredEmail2 && <p>—</p>}
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <div className="space-y-1">
          <Badge variant={BADGE_VARIANT[row.status]}>{EMAIL_REQUEST_STATUS_LABELS[row.status]}</Badge>
          {row.status === "COMPLETED" && row.assignedEmail && (
            <p className="text-xs font-medium text-green-700">{row.assignedEmail}</p>
          )}
        </div>
      ),
    },
    {
      key: "requestedAt",
      header: "Requested",
      hideOnMobile: true,
      render: (row) => <span className="text-xs text-muted-foreground">{formatDate(row.requestedAt)}</span>,
    },
    {
      key: "actions",
      header: "",
      render: (row) =>
        row.status === "PENDING" ? (
          <Button
            size="sm"
            variant="outline"
            className="text-red-700 border-red-300 hover:bg-red-50"
            onClick={(e) => { e.stopPropagation(); setCancelTarget(row); }}
          >
            <XCircle className="h-3.5 w-3.5 mr-1" />
            Cancel
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Official Emails"
        description="Request the Webmaster create an official institutional email for a hired candidate"
        actions={
          <Button onClick={() => router.push("/college-office/email-requests/new")}>
            <Plus className="h-4 w-4 mr-1" />
            New Request
          </Button>
        }
      />

      <DataTable
        data={requests}
        columns={columns}
        isLoading={isLoading}
        keyExtractor={(r) => r.id}
        searchPlaceholder="Search by candidate..."
        searchKeys={["candidateName", "department"] as (keyof Row)[]}
        emptyTitle="No email requests yet"
        emptyDescription="Once a candidate joins, request an official institutional email from the Webmaster here."
        csvFilename="email-requests"
      />

      <ConfirmDialog
        open={cancelTarget !== null}
        onOpenChange={(open) => { if (!open) setCancelTarget(null); }}
        title="Cancel this request?"
        description={`The Webmaster will no longer see the request for ${cancelTarget?.candidateName ?? ""}.`}
        confirmLabel="Cancel Request"
        onConfirm={confirmCancel}
        loading={isCancelling}
        variant="destructive"
      />
    </div>
  );
}
