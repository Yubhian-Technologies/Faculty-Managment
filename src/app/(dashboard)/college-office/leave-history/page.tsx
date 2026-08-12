"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { History, ChevronRight, Users, Layers, Upload } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/EmptyState";
import { ActiveLeaveNowCard } from "@/components/leave/ActiveLeaveNowCard";
import { NON_DEPARTMENTAL_STAFF_ROLES } from "@/lib/leave/nonDepartmentalStaffRoles";
import { ROLE_LABELS } from "@/types";
import type { Department } from "@/types";

export default function CollegeOfficeLeaveHistoryDepartmentsPage() {
  const router = useRouter();

  const { data: departments = [], isLoading } = useQuery({
    queryKey: ["college-office-leave-history-departments"],
    queryFn: () =>
      fetch("/api/college/departments")
        .then((r) => r.json() as Promise<{ departments: Department[] }>)
        .then((d) => d.departments ?? []),
  });

  // Keyed by department name (how LeaveRequest.department is stored, same
  // string the HOD-scoped queries elsewhere in the leave module match on).
  const { data: absentToday = {} } = useQuery({
    queryKey: ["college-office-leave-history-absent-today"],
    queryFn: () =>
      fetch("/api/college/leave-history-report/absent-today")
        .then((r) => r.json() as Promise<{ counts: Record<string, number> }>)
        .then((d) => d.counts ?? {}),
  });

  // Sub-departments (e.g. BS-Chemistry under Basic Science) get their own
  // register reached via the parent's page - see [deptId]/page.tsx - so they
  // aren't peers of their parent here.
  const topLevelDepartments = departments.filter((d) => !d.parentDepartmentId);
  const childrenOf = (parentId: string) => departments.filter((d) => d.parentDepartmentId === parentId);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Leave History"
        description="Select a department to view its leave register"
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/college-office/leave-history/import">
              <Upload className="h-4 w-4 mr-1" />
              Import
            </Link>
          </Button>
        }
      />

      <ActiveLeaveNowCard />

      {/* College-wide roles (Vice Principal, College Office, Dean, IQAC, T&P,
          R&D, Library, Exam Cell, Webmaster) never belong to a department -
          each gets its own card/register instead of one combined list. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {NON_DEPARTMENTAL_STAFF_ROLES.map((role) => (
          <Card
            key={role}
            className="cursor-pointer hover:border-primary hover:shadow-md transition-all duration-200"
            onClick={() => router.push(`/college-office/leave-history/${role}`)}
          >
            <CardContent className="p-5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <Users className="h-5 w-5 text-primary" />
                </div>
                <p className="font-medium">{ROLE_LABELS[role]}</p>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </CardContent>
          </Card>
        ))}
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div key={i} className="h-[72px] rounded-lg border bg-muted/30 animate-pulse" />
          ))}
        </div>
      ) : topLevelDepartments.length === 0 ? (
        <EmptyState
          title="No departments yet"
          description="Departments added under Academic Management will appear here."
          icon={<History className="h-8 w-8" />}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {topLevelDepartments.map((d) => (
            <Card
              key={d.id}
              className="cursor-pointer hover:border-primary hover:shadow-md transition-all duration-200"
              onClick={() => router.push(`/college-office/leave-history/${d.id}`)}
            >
              <CardContent className="p-5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                    <History className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium">{d.name}</p>
                    <p className="text-xs text-muted-foreground">{d.code}</p>
                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                      <p className={`text-xs ${d.hodName ? "text-muted-foreground" : "text-orange-500"}`}>
                        {d.hodName ? `HOD: ${d.hodName}` : "No HOD assigned"}
                      </p>
                      {!!absentToday[d.name] && (
                        <Badge variant="modified" className="text-[10px] px-1.5 py-0">
                          {absentToday[d.name]} absent today
                        </Badge>
                      )}
                    </div>
                    {childrenOf(d.id).length > 0 && (
                      <div className="mt-1 flex items-start gap-1.5 text-xs text-muted-foreground">
                        <Layers className="h-3 w-3 mt-0.5 shrink-0" />
                        <span>{childrenOf(d.id).map((c) => c.name).join(", ")}</span>
                      </div>
                    )}
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
