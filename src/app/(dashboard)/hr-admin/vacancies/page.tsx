"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable } from "@/components/shared/DataTable";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { MobileCard } from "@/components/shared/MobileCard";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/useToast";
import { formatDate } from "@/lib/utils";
import { useMobile } from "@/hooks/useMobile";

interface DeptVacancyRequest {
  id: string;
  department: string;
  position: string;
  qualification?: string;
  deptHeadName: string;
  requiredCount: number;
  justification?: string;
  status: string;
  createdAt: unknown;
}

export default function HRAdminVacanciesPage() {
  const router = useRouter();
  const isMobile = useMobile();
  const [vacancies, setVacancies] = useState<DeptVacancyRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selected, setSelected] = useState<DeptVacancyRequest | null>(null);
  const [forwardOpen, setForwardOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  function load() {
    setIsLoading(true);
    fetch("/api/location/vacancy-requests")
      .then((r) => r.json() as Promise<{ vacancyRequests: DeptVacancyRequest[] }>)
      .then((d) => setVacancies(d.vacancyRequests ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load" }))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => { load(); }, []);

  async function action(actionType: "FORWARD") {
    if (!selected) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/location/vacancy-requests/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: actionType }),
      });
      if (!res.ok) {
        const json = await res.json() as { error?: string };
        throw new Error(json.error ?? "Failed");
      }
      toast({
        variant: "success",
        title: "Forwarded to Administration",
        description: "Administration will review and approve.",
      });
      setForwardOpen(false);
      setSelected(null);
      load();
    } catch (err) {
      toast({ variant: "destructive", title: "Action failed", description: err instanceof Error ? err.message : undefined });
    } finally {
      setLoading(false);
    }
  }

  const pendingCount = vacancies.filter((v) => v.status === "PENDING_HR").length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Hiring Requests"
        description={pendingCount > 0 ? `${pendingCount} request${pendingCount > 1 ? "s" : ""} pending your review` : "Review and forward dept head requests to Administration"}
      />

      {isMobile ? (
        <div className="space-y-3">
          {vacancies.map((v) => (
            <MobileCard
              key={v.id}
              title={`${v.position} — ${v.department}`}
              subtitle={`Requested by ${v.deptHeadName}`}
              badge={<StatusBadge status={v.status} />}
              fields={[
                { label: "Count", value: v.requiredCount },
                { label: "Qualification", value: v.qualification ?? "—" },
              ]}
              actions={v.status === "PENDING_HR" ? (
                <>
                  <Button size="sm" className="flex-1" onClick={() => { setSelected(v); setForwardOpen(true); }}>
                    Forward to Admin
                  </Button>
                  <Button size="sm" variant="destructive" className="flex-1" onClick={() => router.push(`/hr-admin/vacancies/${v.id}/reject`)}>
                    Reject
                  </Button>
                </>
              ) : undefined}
            />
          ))}
          {!isLoading && vacancies.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">No hiring requests yet.</p>
          )}
        </div>
      ) : (
        <DataTable<Record<string, unknown>>
          data={vacancies as unknown as Record<string, unknown>[]}
          keyExtractor={(r) => r.id as string}
          isLoading={isLoading}
          searchPlaceholder="Search vacancies..."
          searchKeys={["department", "deptHeadName"]}
          csvFilename="hr-vacancy-requests"
          columns={[
            { key: "position", header: "Position" },
            { key: "department", header: "Department" },
            { key: "deptHeadName", header: "Requested By" },
            { key: "qualification", header: "Qualification", render: (r) => (r as unknown as DeptVacancyRequest).qualification ?? "—" },
            { key: "requiredCount", header: "Count", render: (r) => (r as unknown as DeptVacancyRequest).requiredCount },
            {
              key: "status",
              header: "Status",
              render: (r) => {
                const v = r as unknown as DeptVacancyRequest;
                return <StatusBadge status={v.status} />;
              },
            },
            { key: "createdAt", header: "Date", render: (r) => formatDate((r as unknown as DeptVacancyRequest).createdAt as Parameters<typeof formatDate>[0]) },
            {
              key: "actions",
              header: "Actions",
              render: (r) => {
                const v = r as unknown as DeptVacancyRequest;
                return v.status === "PENDING_HR" ? (
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => { setSelected(v); setForwardOpen(true); }}>
                      Forward to Admin
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => router.push(`/hr-admin/vacancies/${v.id}/reject`)}>
                      Reject
                    </Button>
                  </div>
                ) : null;
              },
            },
          ]}
        />
      )}

      <ConfirmDialog
        open={forwardOpen}
        onOpenChange={setForwardOpen}
        title="Forward to Administration?"
        description={`Forward the faculty hiring request for ${selected?.department} (${selected?.requiredCount} position(s)) to Administration for approval.`}
        confirmLabel="Forward"
        onConfirm={() => void action("FORWARD")}
        loading={loading}
      />
    </div>
  );
}
