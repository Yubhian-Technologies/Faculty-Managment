"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable } from "@/components/shared/DataTable";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { MobileCard } from "@/components/shared/MobileCard";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/useToast";
import { formatDate } from "@/lib/utils";
import { useMobile } from "@/hooks/useMobile";

interface LocationOffer {
  id: string;
  candidateName: string;
  candidateEmail: string;
  department: string;
  position: string;
  joiningDate: unknown;
  salary: number;
  status: string;
  createdAt: unknown;
  remarks?: string;
}

interface LocationCandidate {
  id: string;
  name: string;
  email?: string;
  department: string;
  status: string;
}

export default function HROffersPage() {
  const router = useRouter();
  const isMobile = useMobile();
  const [offers, setOffers] = useState<LocationOffer[]>([]);
  const [selectedCandidates, setSelectedCandidates] = useState<LocationCandidate[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  function load() {
    setIsLoading(true);
    fetch("/api/location/offers")
      .then((r) => r.json() as Promise<{ offers: LocationOffer[] }>)
      .then((d) => setOffers(d.offers ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load offers" }))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => {
    load();
    // Load candidates eligible for offer letters: SELECTED or SHORTLISTED (post-interview)
    fetch("/api/location/candidates")
      .then((r) => r.json() as Promise<{ candidates: LocationCandidate[] }>)
      .then((d) => setSelectedCandidates(
        (d.candidates ?? []).filter((c) => c.status === "SELECTED" || c.status === "SHORTLISTED")
      ))
      .catch(() => {});
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Offer Letters"
        description="Prepare offer letters for selected candidates — Administration approval required"
        actions={
          <Button onClick={() => router.push("/hr-admin/offers/new")} disabled={selectedCandidates.length === 0}>
            + Create Offer Letter
          </Button>
        }
      />

      {selectedCandidates.length === 0 && offers.length === 0 && !isLoading && (
        <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No candidates available yet. Complete an interview and use <strong>Finalize Decisions</strong> to mark candidates, then create an offer letter here.
        </div>
      )}

      {isMobile ? (
        <div className="space-y-3">
          {offers.map((o) => (
            <MobileCard
              key={o.id}
              title={o.candidateName}
              subtitle={`${o.department} · ${o.position}`}
              badge={<StatusBadge status={o.status} />}
              fields={[
                { label: "Email", value: o.candidateEmail },
                { label: "Joining Date", value: formatDate(o.joiningDate as Parameters<typeof formatDate>[0]) },
                { label: "Salary", value: `₹${o.salary.toLocaleString()}/month` },
              ]}
            />
          ))}
          {!isLoading && offers.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">No offer letters created yet.</p>
          )}
        </div>
      ) : (
        <DataTable<Record<string, unknown>>
          data={offers as unknown as Record<string, unknown>[]}
          keyExtractor={(r) => r.id as string}
          isLoading={isLoading}
          searchPlaceholder="Search by name, department..."
          searchKeys={["candidateName", "department"]}
          csvFilename="hr-offers"
          columns={[
            { key: "candidateName", header: "Candidate" },
            { key: "department", header: "Department" },
            { key: "position", header: "Position" },
            { key: "joiningDate", header: "Joining Date", render: (r) => formatDate((r as unknown as LocationOffer).joiningDate as Parameters<typeof formatDate>[0]) },
            { key: "salary", header: "Salary (₹/mo)", render: (r) => `₹${(r as unknown as LocationOffer).salary.toLocaleString()}` },
            { key: "status", header: "Status", render: (r) => <StatusBadge status={(r as unknown as LocationOffer).status} /> },
            { key: "createdAt", header: "Created", render: (r) => formatDate((r as unknown as LocationOffer).createdAt as Parameters<typeof formatDate>[0]) },
          ]}
        />
      )}
    </div>
  );
}
