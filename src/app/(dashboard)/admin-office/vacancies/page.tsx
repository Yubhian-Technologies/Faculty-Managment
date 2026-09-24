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

interface DeptVacancyRequest {
  id: string;
  department: string;
  position: string;
  qualification?: string;
  requiredCount: number;
  status: string;
  deptHeadName?: string;
  createdAt: unknown;
}

export default function AdminOfficeVacanciesPage() {
  const isMobile = useMobile();
  const [vacancies, setVacancies] = useState<DeptVacancyRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch("/api/location/vacancy-requests")
      .then((r) => r.json() as Promise<{ vacancyRequests: DeptVacancyRequest[] }>)
      .then((d) => setVacancies(d.vacancyRequests ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load" }))
      .finally(() => setIsLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Hiring Requests"
        description="Faculty vacancy requests for location departments"
        actions={
          <Button asChild>
            <Link href="/admin-office/vacancies/new">+ New Request</Link>
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
                { label: "Qualification", value: v.qualification ?? "-" },
                { label: "Submitted By", value: v.deptHeadName ?? "-" },
                { label: "Date", value: formatDate(v.createdAt as Parameters<typeof formatDate>[0]) },
              ]}
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
          searchPlaceholder="Search..."
          searchKeys={["department", "qualification", "deptHeadName"]}
          csvFilename="admin-office-vacancy-requests"
          columns={[
            { key: "position", header: "Position" },
            { key: "department", header: "Department" },
            { key: "qualification", header: "Qualification", render: (r) => (r as unknown as DeptVacancyRequest).qualification ?? "-" },
            { key: "requiredCount", header: "Count", render: (r) => (r as unknown as DeptVacancyRequest).requiredCount },
            { key: "deptHeadName", header: "Submitted By", render: (r) => (r as unknown as DeptVacancyRequest).deptHeadName ?? "-" },
            {
              key: "status",
              header: "Status",
              render: (r) => {
                const v = r as unknown as DeptVacancyRequest;
                return <StatusBadge status={v.status} />;
              },
            },
            { key: "createdAt", header: "Date", render: (r) => formatDate((r as unknown as DeptVacancyRequest).createdAt as Parameters<typeof formatDate>[0]) },
          ]}
        />
      )}
    </div>
  );
}
