"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { toast } from "@/hooks/useToast";
import type { Candidate } from "@/types";

type CandidateRow = Record<string, unknown> & Candidate;

function stageBadge(c: CandidateRow) {
  const s = (c as unknown as { currentStage?: string }).currentStage;
  if (s === "DOCUMENT_VERIFICATION") return <Badge variant="outline" className="text-amber-700 border-amber-300 bg-amber-50 text-xs">Docs Pending</Badge>;
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
        // Only show post-Principal-decision candidates needing doc verification or sent to accounts
        const relevant = (d.candidates ?? []).filter((c) => {
          const stage = (c as unknown as { currentStage?: string }).currentStage;
          return stage === "DOCUMENT_VERIFICATION" || stage === "DECISION";
        });
        setCandidates(relevant);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load candidates" }))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => { loadCandidates(); }, []);

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
    {
      key: "actions",
      header: "",
      render: (row) => {
        const stage = (row as unknown as { currentStage?: string }).currentStage;
        if (stage === "DOCUMENT_VERIFICATION") {
          return (
            <Button asChild size="sm" variant="outline" className="text-blue-700 border-blue-300">
              <Link href="/college-office/documents" onClick={(e) => e.stopPropagation()}>
                Verify in Documents →
              </Link>
            </Button>
          );
        }
        return null;
      },
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Candidates"
        description="Status overview of Principal-approved candidates — verify documents from the Documents tab"
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
