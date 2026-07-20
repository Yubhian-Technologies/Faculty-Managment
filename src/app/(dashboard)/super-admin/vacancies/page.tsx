"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable } from "@/components/shared/DataTable";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { MobileCard } from "@/components/shared/MobileCard";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/useToast";
import { formatDate } from "@/lib/utils";
import { useMobile } from "@/hooks/useMobile";

interface GeneralAdminVacancy {
  id: string;
  collegeId: string;
  collegeName: string;
  submittedByName: string;
  position: string;
  requiredCount: number;
  availableCount: number;
  justification?: string;
  status: string;
  createdAt: { seconds: number } | string | null;
}

export default function SuperAdminVacanciesPage() {
  const router = useRouter();
  const isMobile = useMobile();
  const [vacancies, setVacancies] = useState<GeneralAdminVacancy[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selected, setSelected] = useState<GeneralAdminVacancy | null>(null);
  const [approveOpen, setApproveOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  function loadVacancies() {
    setIsLoading(true);
    fetch("/api/admin/general-admin-vacancies")
      .then((r) => r.json() as Promise<{ vacancyRequests: GeneralAdminVacancy[] }>)
      .then((d) => setVacancies(d.vacancyRequests ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load vacancies" }))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => { loadVacancies(); }, []);

  async function handleApprove() {
    if (!selected) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/admin/general-admin-vacancies/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "APPROVED" }),
      });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: "Approved", description: "Vice Principal has been notified." });
      setApproveOpen(false);
      setSelected(null);
      loadVacancies();
    } catch {
      toast({ variant: "destructive", title: "Action failed" });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="General Admin Vacancies"
        description="Institution-wide General Admin hiring requests submitted by Vice Principals"
      />

      <div className="flex items-center gap-2 text-sm text-muted-foreground bg-amber-50 border border-amber-200 rounded-lg px-4 py-2">
        <span className="font-semibold text-amber-700">Note:</span>
        These requests span all colleges. Approving allows the respective college to begin recruitment.
      </div>

      {isMobile ? (
        <div className="space-y-3">
          {vacancies.map((v) => (
            <MobileCard
              key={v.id}
              title={v.position}
              subtitle={`${v.collegeName} · ${v.submittedByName}`}
              badge={<StatusBadge status={v.status} />}
              fields={[
                { label: "Required", value: v.requiredCount },
                { label: "College", value: v.collegeName },
                { label: "Submitted", value: formatDate(v.createdAt as Parameters<typeof formatDate>[0]) },
              ]}
              actions={
                v.status === "PENDING" ? (
                  <>
                    <Button size="sm" className="flex-1" onClick={() => { setSelected(v); setApproveOpen(true); }}>Approve</Button>
                    <Button size="sm" variant="destructive" className="flex-1" onClick={() => router.push(`/super-admin/vacancies/${v.id}/reject`)}>Reject</Button>
                  </>
                ) : undefined
              }
            />
          ))}
        </div>
      ) : (
        <DataTable<Record<string, unknown>>
          data={vacancies as unknown as Record<string, unknown>[]}
          keyExtractor={(row) => row.id as string}
          isLoading={isLoading}
          searchPlaceholder="Search vacancies..."
          searchKeys={["position", "collegeName", "submittedByName"]}
          csvFilename="general-admin-vacancies"
          columns={[
            { key: "position", header: "Position" },
            {
              key: "collegeName",
              header: "College",
              render: (row) => (
                <span className="font-medium">{(row as unknown as GeneralAdminVacancy).collegeName}</span>
              ),
            },
            { key: "submittedByName", header: "Submitted By" },
            { key: "requiredCount", header: "Count", render: (row) => (row as unknown as GeneralAdminVacancy).requiredCount },
            {
              key: "status",
              header: "Status",
              render: (row) => (
                <div className="flex items-center gap-2">
                  <StatusBadge status={(row as unknown as GeneralAdminVacancy).status} />
                  <Badge variant="secondary" className="text-xs">General Admin</Badge>
                </div>
              ),
            },
            {
              key: "createdAt",
              header: "Date",
              render: (row) => formatDate((row as unknown as GeneralAdminVacancy).createdAt as Parameters<typeof formatDate>[0]),
            },
            {
              key: "actions",
              header: "Actions",
              render: (row) => {
                const v = row as unknown as GeneralAdminVacancy;
                return v.status === "PENDING" ? (
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => { setSelected(v); setApproveOpen(true); }}>Approve</Button>
                    <Button size="sm" variant="destructive" onClick={() => router.push(`/super-admin/vacancies/${v.id}/reject`)}>Reject</Button>
                  </div>
                ) : null;
              },
            },
          ]}
        />
      )}

      <ConfirmDialog
        open={approveOpen}
        onOpenChange={setApproveOpen}
        title="Approve General Admin Vacancy?"
        description={`Approve the ${selected?.position} request from ${selected?.collegeName}. The Vice Principal will be notified.`}
        confirmLabel="Approve"
        onConfirm={handleApprove}
        loading={loading}
      />
    </div>
  );
}
