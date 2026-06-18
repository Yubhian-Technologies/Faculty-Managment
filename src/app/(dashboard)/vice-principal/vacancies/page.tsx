"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable } from "@/components/shared/DataTable";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { MobileCard } from "@/components/shared/MobileCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/useToast";
import { formatDate } from "@/lib/utils";
import { useMobile } from "@/hooks/useMobile";
import type { VacancyRequest } from "@/types";

export default function VicePrincipalVacanciesPage() {
  const isMobile = useMobile();
  const [vacancies, setVacancies] = useState<VacancyRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch("/api/college/vacancy-requests")
      .then((r) => r.json() as Promise<{ vacancyRequests: VacancyRequest[] }>)
      .then((d) => setVacancies((d.vacancyRequests ?? []).filter((v) => v.positionCategory === "GENERAL_ADMIN")))
      .catch(() => toast({ variant: "destructive", title: "Failed to load" }))
      .finally(() => setIsLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="General Admin Vacancy Requests"
        description="Submit General Admin hiring requests — reviewed by the Principal"
        actions={
          <Button asChild>
            <Link href="/vice-principal/vacancies/new">+ New Request</Link>
          </Button>
        }
      />

      {isMobile ? (
        <div className="space-y-3">
          {vacancies.map((v) => (
            <MobileCard
              key={v.id}
              title={v.position}
              subtitle={v.department}
              badge={<StatusBadge status={v.status} />}
              fields={[
                { label: "Required", value: v.requiredCount },
                { label: "Qualification", value: v.qualification ?? "—" },
              ]}
            />
          ))}
        </div>
      ) : (
        <DataTable<Record<string, unknown>>
          data={vacancies as unknown as Record<string, unknown>[]}
          keyExtractor={(r) => r.id as string}
          isLoading={isLoading}
          searchPlaceholder="Search..."
          searchKeys={["position", "department"]}
          csvFilename="general-admin-vacancies"
          columns={[
            { key: "position", header: "Position" },
            { key: "department", header: "Department" },
            { key: "qualification", header: "Qualification", render: (r) => (r as unknown as VacancyRequest).qualification ?? "—" },
            { key: "requiredCount", header: "Count", render: (r) => (r as unknown as VacancyRequest).requiredCount },
            {
              key: "positionCategory", header: "Category",
              render: () => <Badge variant="secondary" className="text-xs">General Admin</Badge>,
            },
            { key: "status", header: "Status", render: (r) => <StatusBadge status={(r as unknown as VacancyRequest).status} /> },
            { key: "createdAt", header: "Date", render: (r) => formatDate((r as unknown as VacancyRequest).createdAt) },
          ]}
        />
      )}
    </div>
  );
}
