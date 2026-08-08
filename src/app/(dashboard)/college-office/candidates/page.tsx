"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { toast } from "@/hooks/useToast";
import type { Candidate } from "@/types";

type CandidateRow = Record<string, unknown> & Candidate;

function stageBadge(c: CandidateRow) {
  const s = (c as unknown as { currentStage?: string }).currentStage;
  if (s === "DECISION") return <Badge variant="outline" className="text-blue-700 border-blue-300 bg-blue-50 text-xs">Sent to Accounts</Badge>;
  return null;
}

export default function CollegeOfficeCandidatesPage() {
  const [candidates, setCandidates] = useState<CandidateRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  function loadCandidates() {
    setIsLoading(true);
    fetch("/api/college/candidates")
      .then((r) => r.json() as Promise<{ candidates: CandidateRow[] }>)
      .then((d) => {
        // Only show Principal-approved candidates that have been sent to Accounts
        const relevant = (d.candidates ?? []).filter((c) => {
          const stage = (c as unknown as { currentStage?: string }).currentStage;
          return stage === "DECISION";
        });
        setCandidates(relevant);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load candidates" }))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => {
    loadCandidates();
    // Principal's decision (which moves a candidate into this list) happens
    // server-side in a different session — refetch on refocus so office staff
    // don't sit behind a stale snapshot from before the decision was made.
    function onFocus() { loadCandidates(); }
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, []);

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
      key: "status",
      header: "Status",
      render: (row) => (
        <div className="flex flex-col gap-1">
          <StatusBadge status={(row as unknown as Candidate).status} />
          {stageBadge(row)}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Candidates"
        description="Principal-approved candidates that have been sent to Accounts for offer letters"
      />

      <DataTable
        data={candidates}
        columns={columns}
        isLoading={isLoading}
        keyExtractor={(r) => r.id as string}
        searchPlaceholder="Search candidates..."
        searchKeys={["name", "email", "department", "position"] as (keyof CandidateRow)[]}
        emptyTitle="No candidates yet"
        emptyDescription="Shortlisted and approved candidates will appear here"
        csvFilename="candidates"
      />
    </div>
  );
}
