"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { toast } from "@/hooks/useToast";
import type { Candidate, CandidateApplication, CandidateStatus, OfferLetter, FacultyAccountRequestStatus } from "@/types";

// Same join view as college-office/candidates/page.tsx: person fields from
// Candidate, pipeline fields (department, position, status) from the
// CandidateApplication. `closed` mirrors isHiringClosed()'s single-candidate
// case (hiringPipeline.ts) - true only once the faculty account's credentials
// have actually been created, not merely once the offer/decision stage is done.
type AccountsCandidateRow = {
  id: string;
  candidateId: string;
  name: string;
  email: string;
  department: string;
  position: string;
  status: CandidateStatus;
  closed: boolean;
};

export default function CollegeAccountsCandidatesPage() {
  const router = useRouter();
  const [candidates, setCandidates] = useState<AccountsCandidateRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [scope, setScope] = useState<"active" | "past">("active");

  function loadCandidates() {
    setIsLoading(true);
    Promise.all([
      fetch("/api/college/candidate-applications?stage=DECISION").then((r) => r.json() as Promise<{ applications: CandidateApplication[] }>),
      fetch("/api/college/candidates").then((r) => r.json() as Promise<{ candidates: Candidate[] }>),
      fetch("/api/college/offer-letters").then((r) => r.json() as Promise<{ letters: OfferLetter[] }>).catch(() => ({ letters: [] })),
      fetch("/api/college/faculty-account-requests").then((r) => r.json() as Promise<{ requests: { offerId: string; status: FacultyAccountRequestStatus }[] }>).catch(() => ({ requests: [] })),
    ])
      .then(([appsRes, candsRes, offersRes, accountRequestsRes]) => {
        const personMap = new Map((candsRes.candidates ?? []).map((c) => [c.id, c]));

        // Prefer a non-rejected offer per (candidate, batch) - same rule used
        // across the rest of the hiring pipeline.
        const offerByKey = new Map<string, OfferLetter>();
        for (const letter of offersRes.letters ?? []) {
          if (letter.status === "REJECTED") continue;
          const key = `${letter.candidateId}::${letter.batchId}`;
          if (!offerByKey.has(key)) offerByKey.set(key, letter);
        }
        const accountStatusByOfferId = new Map((accountRequestsRes.requests ?? []).map((r) => [r.offerId, r.status]));

        const rows: AccountsCandidateRow[] = (appsRes.applications ?? []).map((a) => {
          const person = personMap.get(a.candidateId);
          const offer = offerByKey.get(`${a.candidateId}::${a.batchId ?? ""}`);
          const accountStatus = offer ? accountStatusByOfferId.get(offer.id) : undefined;
          return {
            id: a.id,
            candidateId: a.candidateId,
            name: person?.name ?? "Unknown",
            email: person?.email ?? "",
            department: a.department,
            position: a.position,
            status: a.status,
            closed: accountStatus === "CREDENTIALS_CREATED" || accountStatus === "COMPLETED",
          };
        });
        setCandidates(rows);
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load candidates" }))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => {
    loadCandidates();
    function onFocus() { loadCandidates(); }
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, []);

  const columns: Column<AccountsCandidateRow>[] = [
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
          {row.closed ? (
            <Badge variant="outline" className="text-green-700 border-green-300 bg-green-50 text-xs">Hiring Complete</Badge>
          ) : (
            <Badge variant="outline" className="text-blue-700 border-blue-300 bg-blue-50 text-xs">Sent to Accounts</Badge>
          )}
        </div>
      ),
    },
  ];

  const visibleCandidates = candidates.filter((c) => c.closed === (scope === "past"));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Candidates"
        description={
          scope === "active"
            ? "Principal-approved candidates that have been sent to Accounts for offer letters, grouped by department"
            : "Candidates whose hiring is complete — faculty account credentials have been created"
        }
      />

      <div className="flex gap-2">
        <Button size="sm" variant={scope === "active" ? "default" : "outline"} onClick={() => setScope("active")}>
          Active
        </Button>
        <Button size="sm" variant={scope === "past" ? "default" : "outline"} onClick={() => setScope("past")}>
          Past
        </Button>
      </div>

      <DataTable
        data={visibleCandidates}
        columns={columns}
        isLoading={isLoading}
        groupBy={(row) => row.department || "Unassigned"}
        onRowClick={(r) => router.push(`/candidate-profile/${r.candidateId}`)}
        keyExtractor={(r) => r.id}
        searchPlaceholder="Search candidates..."
        searchKeys={["name", "email", "department", "position"] as (keyof AccountsCandidateRow)[]}
        emptyTitle={scope === "active" ? "No active candidates" : "No completed hirings yet"}
        emptyDescription={
          scope === "active"
            ? "Shortlisted and approved candidates will appear here"
            : "Candidates appear here once their faculty account credentials have been created"
        }
        csvFilename="candidates"
      />
    </div>
  );
}
