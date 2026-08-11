"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Building2, ChevronRight } from "lucide-react";
import { toast } from "@/hooks/useToast";
import { isHiringClosed } from "@/lib/hiringPipeline";
import type { VacancyRequest, CandidateApplication, HiringBatch, FacultyAccountRequestStatus } from "@/types";

type DepartmentSummary = {
  department: string;
  activeCount: number;
  closedCount: number;
};

export default function CollegeOfficeDocumentsPage() {
  const [departments, setDepartments] = useState<DepartmentSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  function load() {
    Promise.all([
      fetch("/api/college/vacancy-requests").then((r) => r.json() as Promise<{ vacancyRequests: VacancyRequest[] }>).then((d) => d.vacancyRequests ?? []),
      fetch("/api/college/candidate-applications").then((r) => r.json() as Promise<{ applications: CandidateApplication[] }>).then((d) => d.applications ?? []),
      fetch("/api/college/hiring-batches").then((r) => r.json() as Promise<{ batches: HiringBatch[] }>).then((d) => d.batches ?? []),
      fetch("/api/college/faculty-account-requests").then((r) => r.json() as Promise<{ requests: { candidateId: string; status: FacultyAccountRequestStatus }[] }>).then((d) => d.requests ?? []).catch(() => []),
    ])
      .then(([vacancies, applications, batches, accountRequests]) => {
        const accountRequestStatusByCandidate = Object.fromEntries(accountRequests.map((r) => [r.candidateId, r.status]));

        const applicationsByVacancy = new Map<string, CandidateApplication[]>();
        for (const a of applications) {
          const list = applicationsByVacancy.get(a.vacancyRequestId);
          if (list) list.push(a);
          else applicationsByVacancy.set(a.vacancyRequestId, [a]);
        }

        const summaryByDept = new Map<string, DepartmentSummary>();
        for (const v of vacancies) {
          const batch = batches.find((b) => b.vacancyId === v.id && b.status !== "REJECTED") ?? null;
          const approvedCandidateIds = (applicationsByVacancy.get(v.id) ?? [])
            .filter((a) => a.status === "APPROVED" && a.currentStage === "DECISION")
            .map((a) => a.candidateId);
          const closed = isHiringClosed(v.status, batch?.currentPhase, approvedCandidateIds, accountRequestStatusByCandidate);

          const existing = summaryByDept.get(v.department) ?? { department: v.department, activeCount: 0, closedCount: 0 };
          if (closed) existing.closedCount++;
          else existing.activeCount++;
          summaryByDept.set(v.department, existing);
        }

        setDepartments(Array.from(summaryByDept.values()).sort((a, b) => a.department.localeCompare(b.department)));
      })
      .catch(() => toast({ variant: "destructive", title: "Failed to load hiring pipeline" }))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => {
    load();
    function onFocus() { load(); }
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, []);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader title="Hiring Pipeline" description="Loading..." />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-28 rounded-xl bg-muted animate-pulse" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Hiring Pipeline"
        description="Offer letter → document verification & joining letter → appointment letter → credentials & official email setup"
      />

      {departments.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">No hiring requests yet</div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {departments.map((dept) => (
            <Link key={dept.department} href={`/college-office/documents/${encodeURIComponent(dept.department)}`}>
              <Card className="h-full transition-colors hover:border-primary/50">
                <CardHeader className="flex flex-row items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Building2 className="h-4 w-4 text-muted-foreground shrink-0" />
                    <CardTitle className="text-base truncate">{dept.department}</CardTitle>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                </CardHeader>
                <CardContent className="flex items-center gap-2">
                  {dept.activeCount > 0 && <Badge>{dept.activeCount} active</Badge>}
                  {dept.closedCount > 0 && <Badge variant="secondary">{dept.closedCount} completed</Badge>}
                  {dept.activeCount === 0 && dept.closedCount === 0 && (
                    <span className="text-sm text-muted-foreground">No requests</span>
                  )}
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
