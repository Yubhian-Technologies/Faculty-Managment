"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useParams, useRouter } from "next/navigation";
import { ArrowLeft, UsersRound } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar } from "@/components/shared/Avatar";
import { DESIGNATION_LABELS, FACULTY_STATUS_LABELS } from "@/types";
import type { Department, Designation, FacultyMember, FacultyStatus } from "@/types";

type FacultyRow = Record<string, unknown> & FacultyMember;

const STATUS_VARIANTS: Record<FacultyStatus, "default" | "secondary" | "outline" | "destructive"> = {
  ACTIVE: "default",
  ON_LEAVE: "outline",
  RESIGNED: "secondary",
  RETIRED: "secondary",
};

const STATUS_TABS = [
  { key: "", label: "All" },
  { key: "ACTIVE", label: "Active" },
  { key: "ON_LEAVE", label: "On Leave" },
  { key: "RESIGNED", label: "Resigned" },
  { key: "RETIRED", label: "Retired" },
];

export default function PrincipalDepartmentFacultyPage() {
  const router = useRouter();
  const { deptId } = useParams<{ deptId: string }>();
  const [statusFilter, setStatusFilter] = useState("");

  const { data: departments = [] } = useQuery({
    queryKey: ["principal-faculty-departments"],
    queryFn: () =>
      fetch("/api/college/departments")
        .then((r) => r.json() as Promise<{ departments: Department[] }>)
        .then((d) => d.departments ?? []),
  });
  const department = departments.find((d) => d.id === deptId);

  const { data: faculty = [], isLoading } = useQuery({
    queryKey: ["principal-dept-faculty", department?.name, statusFilter],
    queryFn: () =>
      fetch(
        `/api/college/faculty?department=${encodeURIComponent(department!.name)}${statusFilter ? `&status=${statusFilter}` : ""}`
      )
        .then((r) => r.json() as Promise<{ faculty: FacultyRow[] }>)
        .then((d) => d.faculty ?? []),
    enabled: !!department,
  });

  const columns: Column<FacultyRow>[] = [
    {
      key: "name",
      header: "Faculty Member",
      render: (row) => (
        <div className="flex items-center gap-3">
          <Avatar name={row.name} photoUrl={row.profilePhotoUrl} size="sm" />
          <div>
            <p className="font-medium leading-tight">{row.name}</p>
            <p className="text-xs text-muted-foreground">ID: {row.employeeId}</p>
          </div>
        </div>
      ),
    },
    {
      key: "designation",
      header: "Designation",
      render: (row) => DESIGNATION_LABELS[row.designation as Designation] ?? row.designation,
    },
    { key: "department", header: "Department", hideOnMobile: true },
    {
      key: "email",
      header: "Contact",
      hideOnMobile: true,
      render: (row) => (
        <div className="space-y-0.5">
          <p className="text-xs">{row.email}</p>
          {row.phone && <p className="text-xs text-muted-foreground">{row.phone}</p>}
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => (
        <Badge variant={STATUS_VARIANTS[row.status as FacultyStatus] ?? "secondary"}>
          {FACULTY_STATUS_LABELS[row.status as FacultyStatus] ?? row.status}
        </Badge>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={department?.name ?? "Faculty"}
        description="Faculty members in this department"
        actions={
          <Button variant="outline" onClick={() => router.push("/principal/faculty")}>
            <ArrowLeft className="h-4 w-4 mr-2" />Back
          </Button>
        }
      />

      <div className="flex gap-2 flex-wrap">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setStatusFilter(tab.key)}
            className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
              statusFilter === tab.key ? "bg-primary text-primary-foreground border-primary" : "bg-background border-border hover:bg-muted"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <DataTable
        data={faculty}
        columns={columns}
        isLoading={isLoading}
        keyExtractor={(f) => f.id}
        searchPlaceholder="Search by name, employee ID, or email..."
        searchKeys={["name", "employeeId", "email"] as (keyof FacultyRow)[]}
        emptyTitle="No faculty in this department"
        emptyDescription="Faculty added by the HOD for this department will appear here."
        onRowClick={(f) => router.push(`/principal/faculty/${deptId}/${f.id}`)}
      />

      {!department && (
        <p className="text-sm text-muted-foreground flex items-center gap-2">
          <UsersRound className="h-4 w-4" /> Resolving department…
        </p>
      )}
    </div>
  );
}
