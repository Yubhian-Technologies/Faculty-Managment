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
import { Badge } from "@/components/ui/badge";
import type { VacancyRequest } from "@/types";

export default function PrincipalVacanciesPage() {
  const router = useRouter();
  const isMobile = useMobile();
  const [vacancies, setVacancies] = useState<VacancyRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  function loadVacancies() {
    setIsLoading(true);
    fetch("/api/college/vacancy-requests")
      .then((r) => r.json() as Promise<{ vacancyRequests: VacancyRequest[] }>)
      .then((data) => setVacancies(data.vacancyRequests ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load vacancies" }))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => { loadVacancies(); }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Hiring Requests"
        description="Review and approve HOD and Vice Principal hiring requests"
      />

      {isMobile ? (
        <div className="space-y-3">
          {(vacancies ?? []).map((v) => (
            <MobileCard
              key={v.id}
              title={v.position}
              subtitle={`${v.department} · ${v.hodName}`}
              badge={<StatusBadge status={v.status} />}
              fields={[
                { label: "Required", value: v.requiredCount },
                { label: "Submitted", value: formatDate(v.createdAt) },
              ]}
              actions={
                v.status === "PENDING" ? (
                  <>
                    <Button
                      size="sm"
                      className="flex-1"
                      onClick={() => router.push(`/principal/vacancies/${v.id}/approve`)}
                    >
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      className="flex-1"
                      onClick={() => router.push(`/principal/vacancies/${v.id}/reject`)}
                    >
                      Reject
                    </Button>
                  </>
                ) : undefined
              }
            />
          ))}
        </div>
      ) : (
        <DataTable<Record<string, unknown>>
          data={(vacancies ?? []) as unknown as Record<string, unknown>[]}
          keyExtractor={(row) => row.id as string}
          isLoading={isLoading}
          searchPlaceholder="Search vacancies..."
          searchKeys={["position", "department", "hodName"]}
          csvFilename="principal-vacancies"
          columns={[
            { key: "position", header: "Position" },
            {
              key: "positionCategory",
              header: "Category",
              render: (row) => {
                const cat = (row as unknown as VacancyRequest).positionCategory;
                const label = cat === "TEACHING" ? "Teaching" : cat === "SUPPORTING_STAFF" ? "Support Staff" : cat ?? "—";
                return <Badge variant="secondary" className="text-xs">{label}</Badge>;
              },
            },
            { key: "department", header: "Department" },
            { key: "hodName", header: "Requested By" },
            { key: "requiredCount", header: "Count", render: (row) => (row as unknown as VacancyRequest).requiredCount },
            { key: "status", header: "Status", render: (row) => <StatusBadge status={(row as unknown as VacancyRequest).status} /> },
            { key: "createdAt", header: "Date", render: (row) => formatDate((row as unknown as VacancyRequest).createdAt) },
            {
              key: "actions",
              header: "Actions",
              render: (row) => {
                const v = row as unknown as VacancyRequest;
                return v.status === "PENDING" ? (
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => router.push(`/principal/vacancies/${v.id}/approve`)}>Approve</Button>
                    <Button size="sm" variant="destructive" onClick={() => router.push(`/principal/vacancies/${v.id}/reject`)}>Reject</Button>
                  </div>
                ) : null;
              },
            },
          ]}
        />
      )}
    </div>
  );
}
