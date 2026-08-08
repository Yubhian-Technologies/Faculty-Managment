"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/shared/Avatar";
import { toast } from "@/hooks/useToast";
import {
  NON_TECHNICAL_STAFF_DESIGNATION_LABELS,
  EMPLOYMENT_TYPE_LABELS, FACULTY_STATUS_LABELS,
} from "@/types";
import type {
  SupportingStaffMember, SupportingStaffDesignation,
  EmploymentType, FacultyStatus,
} from "@/types";

type StaffRow = Record<string, unknown> & SupportingStaffMember;

const STATUS_VARIANTS: Record<FacultyStatus, "default" | "secondary" | "outline" | "destructive"> = {
  INTERVIEW_DONE: "outline",
  ACTIVE: "default",
  ON_LEAVE: "outline",
  RESIGNED: "secondary",
  RETIRED: "secondary",
};

function designationLabel(designation: SupportingStaffDesignation): string {
  return (NON_TECHNICAL_STAFF_DESIGNATION_LABELS as Record<string, string>)[designation] ?? designation;
}

// Read-only view for Principal/VP - Non-Technical staff records are owned and
// edited by College Office (see college-office/non-technical-staff); this
// just gives Principal/VP the same visibility into college-wide non-teaching
// staff that they already have into Faculty.
export default function PrincipalNonTechnicalStaffPage() {
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch("/api/college/supporting-staff")
      .then((r) => r.json() as Promise<{ staff: StaffRow[] }>)
      .then((d) => setStaff(d.staff ?? []))
      .catch(() => toast({ variant: "destructive", title: "Failed to load non-technical staff" }))
      .finally(() => setIsLoading(false));
  }, []);

  const columns: Column<StaffRow>[] = [
    {
      key: "name",
      header: "Staff Member",
      render: (row) => (
        <div className="flex items-start gap-3 min-w-0">
          <Avatar name={row.name} photoUrl={row.profilePhotoUrl} size="sm" className="mt-0.5" />
          <div className="space-y-0.5 min-w-0">
            <p className="font-medium leading-tight">{row.name}</p>
            {row.collegeEmail && <p className="text-xs text-muted-foreground">{row.collegeEmail}</p>}
            <p className="text-xs text-muted-foreground">ID: {row.employeeId}</p>
          </div>
        </div>
      ),
    },
    {
      key: "designation",
      header: "Role",
      render: (row) => (
        <p className="text-sm font-medium">
          {row.designation === "OTHER" && row.otherDesignationTitle ? row.otherDesignationTitle : designationLabel(row.designation)}
        </p>
      ),
    },
    {
      key: "department",
      header: "Department",
      hideOnMobile: true,
      render: (row) => <span className="text-sm text-muted-foreground">{row.department || "Centrally managed"}</span>,
    },
    {
      key: "employmentType",
      header: "Employment",
      hideOnMobile: true,
      render: (row) => <Badge variant="outline">{EMPLOYMENT_TYPE_LABELS[row.employmentType as EmploymentType] ?? row.employmentType}</Badge>,
    },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <Badge variant={STATUS_VARIANTS[row.status] ?? "secondary"}>
          {FACULTY_STATUS_LABELS[row.status] ?? row.status}
        </Badge>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Non-Technical Staff"
        description="Non-Technical staff records across the college - managed by College Office"
      />

      <DataTable
        data={staff}
        columns={columns}
        isLoading={isLoading}
        keyExtractor={(r) => r.id}
        searchPlaceholder="Search by name, email, employee ID..."
        searchKeys={["name", "email", "employeeId"] as (keyof StaffRow)[]}
        emptyTitle="No non-technical staff records yet"
        emptyDescription="Records added by College Office will show up here."
      />
    </div>
  );
}
