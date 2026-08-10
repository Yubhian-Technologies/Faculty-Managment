"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { toast } from "@/hooks/useToast";
import type { Candidate, CandidateApplication, CandidateStatus } from "@/types";

// This page only ever shows DECISION-stage applications ("sent to Accounts"),
// so it's a join view: person fields from Candidate, pipeline fields
// (department, position, status) from the CandidateApplication.
type OfficeCandidateRow = {
  id: string;
  name: string;
  email: string;
  department: string;
  position: string;
  status: CandidateStatus;
};

export default function CollegeOfficeCandidatesPage() {
  const [candidates, setCandidates] = useState<OfficeCandidateRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  function loadCandidates() {
    setIsLoading(true);
    Promise.all([
      fetch("/api/college/candidate-applications?stage=DECISION").then((r) => r.json() as Promise<{ applications: CandidateApplication[] }>),
      fetch("/api/college/candidates").then((r) => r.json() as Promise<{ candidates: Candidate[] }>),
    ])
      .then(([appsRes, candsRes]) => {
        const personMap = new Map((candsRes.candidates ?? []).map((c) => [c.id, c]));
        const rows: OfficeCandidateRow[] = (appsRes.applications ?? []).map((a) => {
          const person = personMap.get(a.candidateId);
          return {
            id: a.id,
            name: person?.name ?? "Unknown",
            email: person?.email ?? "",
            department: a.department,
            position: a.position,
            status: a.status,
          };
        });
        setCandidates(rows);
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

  const columns: Column<OfficeCandidateRow>[] = [
    {
      key: "name",
      header: "Candidate",
      render: (row) => (
        <div>
          <p className="font-medium">{row.name}</p>
          <p className="text-xs text-muted-foreground">{row.email}</p>
        </div>
      ),
    },
    {
      key: "department",
      header: "Department",
      hideOnMobile: true,
      render: (row) => row.department,
    },
    {
      key: "position",
      header: "Position",
      hideOnMobile: true,
      render: (row) => row.position,
    },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <div className="flex flex-col gap-1">
          <StatusBadge status={row.status} />
          <Badge variant="outline" className="text-blue-700 border-blue-300 bg-blue-50 text-xs">Sent to Accounts</Badge>
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
        keyExtractor={(r) => r.id}
        searchPlaceholder="Search candidates..."
        searchKeys={["name", "email", "department", "position"] as (keyof OfficeCandidateRow)[]}
        emptyTitle="No candidates yet"
        emptyDescription="Shortlisted and approved candidates will appear here"
        csvFilename="candidates"
      />
    </div>
  );
}
