"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, ClipboardList } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/shared/DataTable";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { MobileCard } from "@/components/shared/MobileCard";
import { FacultyRequirementPanel } from "@/components/shared/FacultyRequirementPanel";
import { formatDate } from "@/lib/utils";
import { useMobile } from "@/hooks/useMobile";
import type { VacancyRequest } from "@/types";
import { EmptyState } from "@/components/shared/EmptyState";
import { toast } from "@/hooks/useToast";
import type { FacultyRequirementResult } from "@/app/api/college/faculty-requirement/route";

export default function HODVacancyPage() {
  const isMobile = useMobile();
  const [vacancies, setVacancies] = useState<VacancyRequest[]>([]);
  const [requirement, setRequirement] = useState<FacultyRequirementResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    void Promise.all([
      fetch("/api/college/vacancy-requests")
        .then((r) => r.json() as Promise<{ vacancyRequests: VacancyRequest[] }>)
        .then((d) => setVacancies(d.vacancyRequests ?? []))
        .catch(() => toast({ variant: "destructive", title: "Failed to load vacancies" })),
      fetch("/api/college/faculty-requirement")
        .then((r) => r.json() as Promise<FacultyRequirementResult>)
        .then((d) => setRequirement(d))
        .catch(() => {}),
    ]).finally(() => setIsLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Hiring Requests"
        description="Track all your faculty hiring requests"
        actions={
          <Button asChild>
            <Link href="/hod/vacancy/new">
              <Plus className="h-4 w-4 mr-1" />
              New Request
            </Link>
          </Button>
        }
      />

      {requirement && <FacultyRequirementPanel data={requirement} />}

      {isMobile ? (
        <div className="space-y-3">
          {isLoading ? (
            <p className="text-sm text-muted-foreground text-center py-8">Loading...</p>
          ) : !vacancies.length ? (
            <EmptyState
              icon={<ClipboardList className="h-8 w-8" />}
              title="No hiring requests"
              description="Create your first hiring request to begin the hiring process."
              action={<Button asChild><Link href="/hod/vacancy/new">Create Request</Link></Button>}
            />
          ) : (
            vacancies.map((v) => (
              <MobileCard
                key={v.id}
                title={v.position}
                subtitle={v.department}
                badge={<StatusBadge status={v.status} />}
                fields={[
                  { label: "Required", value: v.requiredCount },
                  { label: "Submitted", value: formatDate(v.createdAt) },
                ]}
              />
            ))
          )}
        </div>
      ) : (
        <DataTable<Record<string, unknown>>
          data={vacancies as unknown as Record<string, unknown>[]}
          keyExtractor={(row) => row.id as string}
          isLoading={isLoading}
          searchPlaceholder="Search vacancies..."
          searchKeys={["position", "department"]}
          emptyTitle="No hiring requests"
          emptyDescription="Create your first hiring request to begin the hiring process."
          emptyAction={<Button asChild><Link href="/hod/vacancy/new">Create Request</Link></Button>}
          csvFilename="vacancy-requests"
          columns={[
            { key: "position", header: "Position" },
            { key: "department", header: "Department" },
            { key: "requiredCount", header: "Required", render: (row) => (row as unknown as VacancyRequest).requiredCount },
            { key: "status", header: "Status", render: (row) => <StatusBadge status={(row as unknown as VacancyRequest).status} /> },
            { key: "createdAt", header: "Submitted", render: (row) => formatDate((row as unknown as VacancyRequest).createdAt) },
            {
              key: "principalResponse",
              header: "Response",
              hideOnMobile: true,
              render: (row) => {
                const v = row as unknown as VacancyRequest;
                if (!v.principalResponse) return <span className="text-muted-foreground text-xs">—</span>;
                return (
                  <span className="text-xs text-muted-foreground">
                    {v.principalResponse.reason || "No notes"}
                  </span>
                );
              },
            },
          ]}
        />
      )}
    </div>
  );
}
