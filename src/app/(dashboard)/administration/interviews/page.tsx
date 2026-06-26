"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable } from "@/components/shared/DataTable";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { MobileCard } from "@/components/shared/MobileCard";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { toast } from "@/hooks/useToast";
import { formatDate } from "@/lib/utils";
import { useMobile } from "@/hooks/useMobile";

interface LocationInterview {
  id: string;
  title: string;
  interviewDate: unknown;
  venue: string;
  panelMembers: { uid: string; name: string; role: string }[];
  candidatesInfo: { id: string; name: string }[];
  shortlistedCandidateIds: string[];
  status: string;
  createdByName: string;
  notes?: string;
  createdAt: unknown;
}

export default function AdminInterviewsPage() {
  const isMobile = useMobile();
  const [interviews, setInterviews] = useState<LocationInterview[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selected, setSelected] = useState<LocationInterview | null>(null);
  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);

  function load() {
    setIsLoading(true);
    fetch("/api/location/interviews")
      .then((r) => r.json() as Promise<{ interviews: LocationInterview[] }>)
      .then((d) => setInterviews(d.interviews ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load" }))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => { load(); }, []);

  async function handleAction(action: "APPROVE" | "REJECT") {
    if (!selected) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/location/interviews/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reason }),
      });
      if (!res.ok) throw new Error();
      toast({
        variant: "success",
        title: action === "APPROVE" ? "Interview Plan Approved" : "Interview Plan Rejected",
        description: "HR Admin has been notified.",
      });
      setApproveOpen(false);
      setRejectOpen(false);
      setSelected(null);
      setReason("");
      load();
    } catch {
      toast({ variant: "destructive", title: "Action failed" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Interview Plans"
        description="Review and approve interview plans submitted by HR Admin"
      />

      {isMobile ? (
        <div className="space-y-3">
          {interviews.map((i) => (
            <MobileCard
              key={i.id}
              title={i.title}
              subtitle={`Created by ${i.createdByName}`}
              badge={<StatusBadge status={i.status} />}
              fields={[
                { label: "Interview Date", value: formatDate(i.interviewDate as Parameters<typeof formatDate>[0]) },
                { label: "Venue", value: i.venue },
                { label: "Candidates", value: i.shortlistedCandidateIds?.length ?? 0 },
                { label: "Panel", value: i.panelMembers?.length ?? 0 },
              ]}
              actions={
                <>
                  <Button size="sm" className="flex-1" onClick={() => { setSelected(i); setApproveOpen(true); }}>Approve</Button>
                  <Button size="sm" variant="destructive" className="flex-1" onClick={() => { setSelected(i); setRejectOpen(true); }}>Reject</Button>
                </>
              }
            />
          ))}
          {!isLoading && interviews.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">No interview plans pending approval.</p>
          )}
        </div>
      ) : (
        <DataTable<Record<string, unknown>>
          data={interviews as unknown as Record<string, unknown>[]}
          keyExtractor={(r) => r.id as string}
          isLoading={isLoading}
          searchPlaceholder="Search by title..."
          searchKeys={["title", "createdByName", "venue"]}
          csvFilename="admin-interview-plans"
          columns={[
            { key: "title", header: "Interview Title" },
            { key: "interviewDate", header: "Interview Date", render: (r) => formatDate((r as unknown as LocationInterview).interviewDate as Parameters<typeof formatDate>[0]) },
            { key: "venue", header: "Venue" },
            { key: "candidates", header: "Candidates", render: (r) => (r as unknown as LocationInterview).shortlistedCandidateIds?.length ?? 0 },
            { key: "panel", header: "Panel", render: (r) => (r as unknown as LocationInterview).panelMembers?.length ?? 0 },
            { key: "createdByName", header: "Created By" },
            { key: "status", header: "Status", render: (r) => <StatusBadge status={(r as unknown as LocationInterview).status} /> },
            {
              key: "actions",
              header: "Actions",
              render: (r) => {
                const i = r as unknown as LocationInterview;
                return (
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => { setSelected(i); setApproveOpen(true); }}>Approve</Button>
                    <Button size="sm" variant="destructive" onClick={() => { setSelected(i); setRejectOpen(true); }}>Reject</Button>
                  </div>
                );
              },
            },
          ]}
        />
      )}

      <ConfirmDialog
        open={approveOpen}
        onOpenChange={setApproveOpen}
        title="Approve Interview Plan?"
        description={`Approve "${selected?.title}" scheduled on ${formatDate(selected?.interviewDate as Parameters<typeof formatDate>[0])} at ${selected?.venue}. HR Admin will be notified and can send call letters to candidates.`}
        confirmLabel="Approve"
        onConfirm={() => void handleAction("APPROVE")}
        loading={loading}
      />

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader><DialogTitle>Reject Interview Plan</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Rejecting <strong>{selected?.title}</strong>. HR Admin will be notified.
            </p>
            <div className="space-y-2">
              <Label>Reason (optional)</Label>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Reason for rejection..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)} disabled={loading}>Cancel</Button>
            <Button variant="destructive" onClick={() => void handleAction("REJECT")} loading={loading}>Reject</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
