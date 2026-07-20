"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable } from "@/components/shared/DataTable";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { MobileCard } from "@/components/shared/MobileCard";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { toast } from "@/hooks/useToast";
import { formatDate } from "@/lib/utils";
import { useMobile } from "@/hooks/useMobile";

interface LocationCandidate {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  appliedPosition: string;
  department: string;
  qualification?: string;
  status: string;
  addedByRole?: string;
  createdAt: unknown;
}

export default function HRCandidatesPage() {
  const router = useRouter();
  const isMobile = useMobile();
  const [candidates, setCandidates] = useState<LocationCandidate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [shortlistTarget, setShortlistTarget] = useState<LocationCandidate | null>(null);
  const [rejectTarget, setRejectTarget] = useState<LocationCandidate | null>(null);
  const [selectTarget, setSelectTarget] = useState<LocationCandidate | null>(null);
  const [postInterviewRejectTarget, setPostInterviewRejectTarget] = useState<LocationCandidate | null>(null);

  function load() {
    setIsLoading(true);
    fetch("/api/location/candidates")
      .then((r) => r.json() as Promise<{ candidates: LocationCandidate[] }>)
      .then((d) => setCandidates(d.candidates ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load candidates" }))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  async function handleAction(candidateId: string, action: "SHORTLIST" | "REJECT_CANDIDATE") {
    setActionLoading(true);
    try {
      const res = await fetch(`/api/location/candidates/${candidateId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) throw new Error();
      toast({
        variant: "success",
        title: action === "SHORTLIST" ? "Candidate shortlisted" : "Candidate rejected",
      });
      setShortlistTarget(null);
      setRejectTarget(null);
      load();
    } catch {
      toast({ variant: "destructive", title: "Action failed" });
    } finally {
      setActionLoading(false);
    }
  }

  async function handleStatusUpdate(candidateId: string, status: "SELECTED" | "REJECTED") {
    setActionLoading(true);
    try {
      const res = await fetch(`/api/location/candidates/${candidateId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error();
      toast({
        variant: "success",
        title: status === "SELECTED" ? "Candidate marked as selected" : "Candidate rejected after interview",
        description: status === "SELECTED" ? "You can now create an offer letter for this candidate." : undefined,
      });
      setSelectTarget(null);
      setPostInterviewRejectTarget(null);
      load();
    } catch {
      toast({ variant: "destructive", title: "Failed to update status" });
    } finally {
      setActionLoading(false);
    }
  }

  const renderActions = (c: LocationCandidate) => {
    if (c.status === "PENDING") {
      return (
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setShortlistTarget(c)}>Shortlist</Button>
          <Button size="sm" variant="destructive" onClick={() => setRejectTarget(c)}>Reject</Button>
        </div>
      );
    }
    if (c.status === "SHORTLISTED") {
      return (
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="text-green-700 border-green-300" onClick={() => setSelectTarget(c)}>
            Mark Selected
          </Button>
          <Button size="sm" variant="destructive" onClick={() => setPostInterviewRejectTarget(c)}>Reject</Button>
        </div>
      );
    }
    return <StatusBadge status={c.status} />;
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Faculty Candidates"
        description="Review candidates — shortlist for interview or reject"
        actions={<Button onClick={() => router.push("/hr-admin/candidates/new")}>+ Add Candidate</Button>}
      />

      {isMobile ? (
        <div className="space-y-3">
          {candidates.map((c) => (
            <MobileCard
              key={c.id}
              title={c.name}
              subtitle={`${c.department} · ${c.appliedPosition}`}
              badge={<StatusBadge status={c.status} />}
              fields={[
                { label: "Email", value: c.email ?? "—" },
                { label: "Phone", value: c.phone ?? "—" },
                { label: "Qualification", value: c.qualification ?? "—" },
              ]}
              actions={c.status === "PENDING" ? (
                <>
                  <Button size="sm" className="flex-1" onClick={() => setShortlistTarget(c)}>Shortlist</Button>
                  <Button size="sm" variant="destructive" className="flex-1" onClick={() => setRejectTarget(c)}>Reject</Button>
                </>
              ) : c.status === "SHORTLISTED" ? (
                <>
                  <Button size="sm" variant="outline" className="flex-1 text-green-700 border-green-300" onClick={() => setSelectTarget(c)}>Mark Selected</Button>
                  <Button size="sm" variant="destructive" className="flex-1" onClick={() => setPostInterviewRejectTarget(c)}>Reject</Button>
                </>
              ) : undefined}
            />
          ))}
          {!isLoading && candidates.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">No candidates yet.</p>
          )}
        </div>
      ) : (
        <DataTable<Record<string, unknown>>
          data={candidates as unknown as Record<string, unknown>[]}
          keyExtractor={(r) => r.id as string}
          isLoading={isLoading}
          searchPlaceholder="Search by name, department..."
          searchKeys={["name", "email", "department"]}
          csvFilename="hr-candidates"
          columns={[
            { key: "name", header: "Name" },
            { key: "department", header: "Department" },
            { key: "qualification", header: "Qualification", render: (r) => (r as unknown as LocationCandidate).qualification ?? "—" },
            { key: "email", header: "Email", render: (r) => (r as unknown as LocationCandidate).email ?? "—" },
            { key: "phone", header: "Phone", render: (r) => (r as unknown as LocationCandidate).phone ?? "—" },
            { key: "addedByRole", header: "Added By", render: (r) => (r as unknown as LocationCandidate).addedByRole === "LOCATION_DEPT_HEAD" ? "Dept Head" : "HR Admin" },
            { key: "createdAt", header: "Added", render: (r) => formatDate((r as unknown as LocationCandidate).createdAt as Parameters<typeof formatDate>[0]) },
            { key: "actions", header: "Action", render: (r) => renderActions(r as unknown as LocationCandidate) },
          ]}
        />
      )}

      <ConfirmDialog
        open={!!shortlistTarget}
        onOpenChange={(o) => { if (!o) setShortlistTarget(null); }}
        title="Shortlist Candidate?"
        description={`Shortlist ${shortlistTarget?.name} (${shortlistTarget?.department}) for the interview round.`}
        confirmLabel="Shortlist"
        onConfirm={() => void handleAction(shortlistTarget!.id, "SHORTLIST")}
        loading={actionLoading}
      />

      <ConfirmDialog
        open={!!rejectTarget}
        onOpenChange={(o) => { if (!o) setRejectTarget(null); }}
        title="Reject Candidate?"
        description={`Reject ${rejectTarget?.name} from the ${rejectTarget?.department} faculty vacancy process.`}
        confirmLabel="Reject"
        onConfirm={() => void handleAction(rejectTarget!.id, "REJECT_CANDIDATE")}
        loading={actionLoading}
      />

      <ConfirmDialog
        open={!!selectTarget}
        onOpenChange={(o) => { if (!o) setSelectTarget(null); }}
        title="Mark as Selected?"
        description={`Mark ${selectTarget?.name} (${selectTarget?.department}) as selected based on interview feedback. You will then be able to create an offer letter.`}
        confirmLabel="Mark Selected"
        onConfirm={() => void handleStatusUpdate(selectTarget!.id, "SELECTED")}
        loading={actionLoading}
      />

      <ConfirmDialog
        open={!!postInterviewRejectTarget}
        onOpenChange={(o) => { if (!o) setPostInterviewRejectTarget(null); }}
        title="Reject After Interview?"
        description={`Reject ${postInterviewRejectTarget?.name} (${postInterviewRejectTarget?.department}) based on interview feedback. This action cannot be undone.`}
        confirmLabel="Reject"
        onConfirm={() => void handleStatusUpdate(postInterviewRejectTarget!.id, "REJECTED")}
        loading={actionLoading}
      />
    </div>
  );
}
