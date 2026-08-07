"use client";

import { use } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { LeaveHistoryReport } from "@/components/leave/LeaveHistoryReport";
import type { Department } from "@/types";

export default function PrincipalLeaveHistoryDepartmentPage({ params }: { params: Promise<{ deptId: string }> }) {
  const { deptId } = use(params);

  const { data: department } = useQuery({
    queryKey: ["principal-leave-history-dept-name", deptId],
    queryFn: () =>
      fetch("/api/college/departments")
        .then((r) => r.json() as Promise<{ departments: Department[] }>)
        .then((d) => d.departments.find((dept) => dept.id === deptId)),
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title={department ? `${department.name} - Leave History` : "Leave History"}
        description="Monthly leave register - click an employee to view their full history"
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/principal/leave-history">
              <ArrowLeft className="h-4 w-4 mr-1" />
              Departments
            </Link>
          </Button>
        }
      />
      <LeaveHistoryReport
        apiUrl={`/api/college/leave-history-report?departmentId=${deptId}`}
        queryKey={["principal-leave-history-report", deptId]}
        employeeHrefBase={`/principal/leave-history/${deptId}`}
        emptyTitle="No faculty with a login in this department yet"
      />
    </div>
  );
}
