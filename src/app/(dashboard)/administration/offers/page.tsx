"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable } from "@/components/shared/DataTable";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { MobileCard } from "@/components/shared/MobileCard";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
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
  createdByName: string;
  remarks?: string;
  createdAt: unknown;
  collegeName?: string;
}

export default function AdminOffersPage() {
  const router = useRouter();
  const isMobile = useMobile();
  const searchParams = useSearchParams();
  const collegeId = searchParams.get("collegeId");
  const collegeName = searchParams.get("collegeName");
  const [offers, setOffers] = useState<LocationOffer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selected, setSelected] = useState<LocationOffer | null>(null);
  const [approveOpen, setApproveOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  function load() {
    setIsLoading(true);
    const url = collegeId ? `/api/location/offers?collegeId=${collegeId}` : "/api/location/offers";
    fetch(url)
      .then((r) => r.json() as Promise<{ offers: LocationOffer[] }>)
      .then((d) => setOffers(d.offers ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load" }))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => { load(); }, [collegeId]);

  async function handleAction(action: "APPROVE") {
    if (!selected) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/location/offers/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) throw new Error();
      toast({
        variant: "success",
        title: "Offer Letter Approved",
        description: `Offer letter for ${selected.candidateName} approved. HR Admin will share it.`,
      });
      setApproveOpen(false);
      setSelected(null);
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
        title="Offer Letters"
        description="Review and approve offer letters prepared by HR Admin"
      />

      {collegeId && (
        <div className="flex items-center justify-between rounded-lg border bg-muted/40 px-3 py-2 text-sm">
          <span>
            Filtered to <strong>{collegeName || "this college"}</strong>
          </span>
          <Button asChild size="sm" variant="ghost" className="h-7 gap-1 text-xs">
            <Link href="/administration/offers"><X className="h-3 w-3" /> Clear filter</Link>
          </Button>
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
                { label: "College", value: o.collegeName || "-" },
                { label: "Email", value: o.candidateEmail },
                { label: "Joining Date", value: formatDate(o.joiningDate as Parameters<typeof formatDate>[0]) },
                { label: "Salary", value: `₹${o.salary.toLocaleString()}/month` },
                { label: "Prepared By", value: o.createdByName },
              ]}
              actions={
                <>
                  <Button size="sm" className="flex-1" onClick={() => { setSelected(o); setApproveOpen(true); }}>Approve</Button>
                  <Button size="sm" variant="destructive" className="flex-1" onClick={() => router.push(`/administration/offers/${o.id}/reject`)}>Reject</Button>
                </>
              }
            />
          ))}
          {!isLoading && offers.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">No offer letters pending approval.</p>
          )}
        </div>
      ) : (
        <DataTable<Record<string, unknown>>
          data={offers as unknown as Record<string, unknown>[]}
          keyExtractor={(r) => r.id as string}
          isLoading={isLoading}
          searchPlaceholder="Search by candidate, department..."
          searchKeys={["candidateName", "department", "candidateEmail"]}
          csvFilename="admin-offers"
          columns={[
            { key: "candidateName", header: "Candidate" },
            { key: "collegeName", header: "College", render: (r) => (r as unknown as LocationOffer).collegeName || "-" },
            { key: "department", header: "Department" },
            { key: "position", header: "Position" },
            { key: "joiningDate", header: "Joining Date", render: (r) => formatDate((r as unknown as LocationOffer).joiningDate as Parameters<typeof formatDate>[0]) },
            { key: "salary", header: "Salary (₹/mo)", render: (r) => `₹${(r as unknown as LocationOffer).salary.toLocaleString()}` },
            { key: "createdByName", header: "Prepared By" },
            { key: "status", header: "Status", render: (r) => <StatusBadge status={(r as unknown as LocationOffer).status} /> },
            {
              key: "actions",
              header: "Actions",
              render: (r) => {
                const o = r as unknown as LocationOffer;
                return (
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => { setSelected(o); setApproveOpen(true); }}>Approve</Button>
                    <Button size="sm" variant="destructive" onClick={() => router.push(`/administration/offers/${o.id}/reject`)}>Reject</Button>
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
        title="Approve Offer Letter?"
        description={`Approve offer letter for ${selected?.candidateName} (${selected?.department}). Joining date: ${formatDate(selected?.joiningDate as Parameters<typeof formatDate>[0])}. Salary: ₹${selected?.salary?.toLocaleString()}/month. HR Admin will share the offer with the candidate.`}
        confirmLabel="Approve & Send"
        onConfirm={() => void handleAction("APPROVE")}
        loading={loading}
      />
    </div>
  );
}
