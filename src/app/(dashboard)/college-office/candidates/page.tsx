"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { toast } from "@/hooks/useToast";
import { CheckCircle2 } from "lucide-react";
import type { Candidate } from "@/types";

type CandidateRow = Record<string, unknown> & Candidate;

export default function CollegeOfficeCandidatesPage() {
  const [candidates, setCandidates] = useState<CandidateRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [arriving, setArriving] = useState<CandidateRow | null>(null);
  const [loading, setLoading] = useState(false);

  function loadCandidates() {
    setIsLoading(true);
    fetch("/api/college/candidates")
      .then((r) => r.json() as Promise<{ candidates: CandidateRow[] }>)
      .then((d) => {
        // College office focuses on shortlisted candidates who haven't arrived yet or just arrived
        const relevant = (d.candidates ?? []).filter((c) => c.isShortlisted || c.hasArrived);
        setCandidates(relevant);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load candidates" }))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => { loadCandidates(); }, []);

  async function markArrived() {
    if (!arriving) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/college/candidates/${arriving.id as string}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hasArrived: true }),
      });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "Marked as arrived", description: "Panel members notified." });
      setArriving(null);
      loadCandidates();
    } catch {
      toast({ variant: "destructive", title: "Failed to update" });
    } finally {
      setLoading(false);
    }
  }

  const columns: Column<CandidateRow>[] = [
    {
      key: "name",
      header: "Candidate",
      render: (row) => (
        <div>
          <p className="font-medium">{row.name as string}</p>
          <p className="text-xs text-muted-foreground">{row.email as string}</p>
        </div>
      ),
    },
    {
      key: "department",
      header: "Department",
      hideOnMobile: true,
      render: (row) => row.department as string,
    },
    {
      key: "position",
      header: "Position",
      hideOnMobile: true,
      render: (row) => row.position as string,
    },
    {
      key: "hasArrived",
      header: "Arrival",
      render: (row) =>
        (row.hasArrived as boolean) ? (
          <span className="text-green-600 text-xs font-medium flex items-center gap-1">
            <CheckCircle2 className="h-3 w-3" />
            Arrived
          </span>
        ) : (
          <span className="text-xs text-orange-600">Expected</span>
        ),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <StatusBadge status={(row as unknown as Candidate).status} />,
    },
    {
      key: "actions",
      header: "",
      render: (row) =>
        !(row.hasArrived as boolean) ? (
          <Button
            size="sm"
            variant="outline"
            onClick={(e) => { e.stopPropagation(); setArriving(row); }}
          >
            Mark Arrived
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Candidates"
        description="Track candidate arrival for interview sessions"
      />

      <DataTable
        data={candidates}
        columns={columns}
        isLoading={isLoading}
        keyExtractor={(r) => r.id as string}
        searchPlaceholder="Search candidates..."
        searchKeys={["name", "email", "department", "position"] as (keyof CandidateRow)[]}
        emptyTitle="No candidates yet"
        emptyDescription="Shortlisted candidates for approved interview batches will appear here"
        csvFilename="candidates-arrival"
      />

      <ConfirmDialog
        open={!!arriving}
        onOpenChange={(open) => { if (!open) setArriving(null); }}
        title="Mark Candidate as Arrived?"
        description={`Confirm that ${arriving?.name as string} has arrived for the interview. Panel members and the HOD will be notified.`}
        confirmLabel="Confirm Arrival"
        onConfirm={markArrived}
        loading={loading}
      />
    </div>
  );
}
