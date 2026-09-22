"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable } from "@/components/shared/DataTable";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { MobileCard } from "@/components/shared/MobileCard";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/useToast";
import { formatDate } from "@/lib/utils";
import { useMobile } from "@/hooks/useMobile";

interface LocationVacancy {
  id: string;
  department: string;
  position: string;
  qualification?: string;
  deptHeadName: string;
  forwardedByName?: string;
  requiredCount: number;
  justification?: string;
  status: string;
  createdAt: unknown;
  collegeName?: string;
}

export default function AdministrationVacanciesPage() {
  const router = useRouter();
  const isMobile = useMobile();
  const searchParams = useSearchParams();
  const collegeId = searchParams.get("collegeId");
  const collegeName = searchParams.get("collegeName");
  const [vacancies, setVacancies] = useState<LocationVacancy[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selected, setSelected] = useState<LocationVacancy | null>(null);
  const [approveOpen, setApproveOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  function load() {
    setIsLoading(true);
    const url = collegeId ? `/api/location/vacancy-requests?collegeId=${collegeId}` : "/api/location/vacancy-requests";
    fetch(url)
      .then((r) => r.json() as Promise<{ vacancyRequests: LocationVacancy[] }>)
      .then((d) => setVacancies(d.vacancyRequests ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load" }))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => { load(); }, [collegeId]);

  async function action(status: string) {
    if (!selected) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/location/vacancy-requests/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error();
      toast({
        variant: "success",
        title: "Vacancy Approved",
        description: "HR Admin and Dept Head have been notified.",
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
        title="Hiring Requests"
        description="Approve or reject faculty hiring requests forwarded by HR Admin"
      />

      {collegeId && (
        <div className="flex items-center justify-between rounded-lg border bg-muted/40 px-3 py-2 text-sm">
          <span>
            Filtered to <strong>{collegeName || "this college"}</strong>
          </span>
          <Button asChild size="sm" variant="ghost" className="h-7 gap-1 text-xs">
            <Link href="/administration/vacancies"><X className="h-3 w-3" /> Clear filter</Link>
          </Button>
        </div>
      )}

      {isMobile ? (
        <div className="space-y-3">
          {vacancies.map((v) => (
            <MobileCard
              key={v.id}
              title={`${v.position} - ${v.department}`}
              subtitle={`Requested by ${v.deptHeadName}${v.forwardedByName ? ` · Forwarded by ${v.forwardedByName}` : ""}`}
              badge={<StatusBadge status={v.status} />}
              fields={[
                { label: "College", value: v.collegeName || "-" },
                { label: "Count", value: v.requiredCount },
                { label: "Qualification", value: v.qualification ?? "-" },
              ]}
              actions={
                <>
                  <Button size="sm" className="flex-1" onClick={() => { setSelected(v); setApproveOpen(true); }}>Approve</Button>
                  <Button size="sm" variant="destructive" className="flex-1" onClick={() => router.push(`/administration/vacancies/${v.id}/reject`)}>Reject</Button>
                </>
              }
            />
          ))}
          {!isLoading && vacancies.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">No pending hiring requests.</p>
          )}
        </div>
      ) : (
        <DataTable<Record<string, unknown>>
          data={vacancies as unknown as Record<string, unknown>[]}
          keyExtractor={(r) => r.id as string}
          isLoading={isLoading}
          searchPlaceholder="Search vacancies..."
          searchKeys={["department", "deptHeadName", "forwardedByName"]}
          csvFilename="admin-vacancy-requests"
          columns={[
            { key: "position", header: "Position" },
            { key: "collegeName", header: "College", render: (r) => (r as unknown as LocationVacancy).collegeName || "-" },
            { key: "department", header: "Department" },
            { key: "deptHeadName", header: "Requested By" },
            { key: "forwardedByName", header: "Forwarded By", render: (r) => (r as unknown as LocationVacancy).forwardedByName ?? "-" },
            { key: "qualification", header: "Qualification", render: (r) => (r as unknown as LocationVacancy).qualification ?? "-" },
            { key: "requiredCount", header: "Count", render: (r) => (r as unknown as LocationVacancy).requiredCount },
            { key: "status", header: "Status", render: (r) => <StatusBadge status={(r as unknown as LocationVacancy).status} /> },
            { key: "createdAt", header: "Date", render: (r) => formatDate((r as unknown as LocationVacancy).createdAt as Parameters<typeof formatDate>[0]) },
            {
              key: "actions",
              header: "Actions",
              render: (r) => {
                const v = r as unknown as LocationVacancy;
                return (
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => { setSelected(v); setApproveOpen(true); }}>Approve</Button>
                    <Button size="sm" variant="destructive" onClick={() => router.push(`/administration/vacancies/${v.id}/reject`)}>Reject</Button>
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
        title="Approve Hiring Request?"
        description={`Approve faculty vacancy for ${selected?.department} (${selected?.requiredCount} position(s)) requested by ${selected?.deptHeadName}. HR Admin will be notified.`}
        confirmLabel="Approve"
        onConfirm={() => void action("APPROVED")}
        loading={loading}
      />
    </div>
  );
}
