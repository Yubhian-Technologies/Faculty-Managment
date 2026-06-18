"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable } from "@/components/shared/DataTable";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { MobileCard } from "@/components/shared/MobileCard";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/useToast";
import { formatDate } from "@/lib/utils";
import { useMobile } from "@/hooks/useMobile";

interface LocationVacancy {
  id: string;
  department: string;
  position: string;
  qualification?: string;
  requiredCount: number;
  status: string;
  createdAt: unknown;
}

export default function HRAdminVacanciesPage() {
  const isMobile = useMobile();
  const [vacancies, setVacancies] = useState<LocationVacancy[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch("/api/location/vacancy-requests")
      .then((r) => r.json() as Promise<{ vacancyRequests: LocationVacancy[] }>)
      .then((d) => setVacancies(d.vacancyRequests ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load" }))
      .finally(() => setIsLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Vacancy Requests"
        description="Requests you submitted to Administration"
        actions={
          <Button asChild>
            <Link href="/hr-admin/vacancies/new">+ New Request</Link>
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
          csvFilename="hr-vacancies"
          columns={[
            { key: "position", header: "Position" },
            { key: "department", header: "Department" },
            { key: "qualification", header: "Qualification", render: (r) => (r as unknown as LocationVacancy).qualification ?? "—" },
            { key: "requiredCount", header: "Count", render: (r) => (r as unknown as LocationVacancy).requiredCount },
            { key: "status", header: "Status", render: (r) => <StatusBadge status={(r as unknown as LocationVacancy).status} /> },
            { key: "createdAt", header: "Date", render: (r) => formatDate((r as unknown as LocationVacancy).createdAt as Parameters<typeof formatDate>[0]) },
          ]}
        />
      )}
    </div>
  );
}
