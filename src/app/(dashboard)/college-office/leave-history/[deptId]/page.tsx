"use client";

import { use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ChevronRight, Layers } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { LeaveHistoryReport } from "@/components/leave/LeaveHistoryReport";
import { NON_DEPARTMENTAL_STAFF_ROLES } from "@/lib/leave/nonDepartmentalStaffRoles";
import { ROLE_LABELS } from "@/types";
import type { Department, UserRole } from "@/types";

export default function CollegeOfficeLeaveHistoryDepartmentPage({ params }: { params: Promise<{ deptId: string }> }) {
  const { deptId } = use(params);
  const router = useRouter();
  const staffRole = NON_DEPARTMENTAL_STAFF_ROLES.includes(deptId as UserRole) ? (deptId as UserRole) : null;

  const { data: departments } = useQuery({
    queryKey: ["college-office-leave-history-departments-all"],
    queryFn: () =>
      fetch("/api/college/departments")
        .then((r) => r.json() as Promise<{ departments: Department[] }>)
        .then((d) => d.departments ?? []),
    enabled: !staffRole,
  });

  const department = departments?.find((dept) => dept.id === deptId);
  // A parent's sub-departments get their own register - see resolveReportRoster
  // (a sub-department's students are taught under the parent's courses, but
  // day-to-day leave is still tracked per the sub-HOD who runs it).
  const subDepartments = department?.hasSubDepartments
    ? (departments ?? []).filter((dept) => dept.parentDepartmentId === department.id)
    : [];

  const title = staffRole ? `${ROLE_LABELS[staffRole]} - Leave History` : department ? `${department.name} - Leave History` : "Leave History";

  return (
    <div className="space-y-6">
      <PageHeader
        title={title}
        description={
          staffRole
            ? `Monthly leave register for ${ROLE_LABELS[staffRole]} - click an employee to view their full history`
            : "Monthly leave register - click an employee to view their full history"
        }
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/college-office/leave-history">
              <ArrowLeft className="h-4 w-4 mr-1" />
              Back
            </Link>
          </Button>
        }
      />

      {subDepartments.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm font-medium text-muted-foreground">Sub-Departments</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {subDepartments.map((sub) => (
              <Card
                key={sub.id}
                className="cursor-pointer hover:border-primary hover:shadow-md transition-all duration-200"
                onClick={() => router.push(`/college-office/leave-history/${sub.id}`)}
              >
                <CardContent className="p-5 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                      <Layers className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium">{sub.name}</p>
                      <p className="text-xs text-muted-foreground">{sub.code}</p>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </CardContent>
              </Card>
            ))}
          </div>
          <p className="text-sm font-medium text-muted-foreground pt-2">{department?.name}</p>
        </div>
      )}

      <LeaveHistoryReport
        apiUrl={`/api/college/leave-history-report?departmentId=${deptId}`}
        queryKey={["college-office-leave-history-report", deptId]}
        employeeHrefBase={`/college-office/leave-history/${deptId}`}
        emptyTitle={staffRole ? `No ${ROLE_LABELS[staffRole]} with a login yet` : "No faculty with a login in this department yet"}
        showCategoryFilter={!staffRole}
      />
    </div>
  );
}
