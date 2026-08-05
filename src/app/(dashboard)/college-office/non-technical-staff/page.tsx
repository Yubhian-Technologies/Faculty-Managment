"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus, Pencil, Trash2, Upload } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { DataTable, type Column } from "@/components/shared/DataTable";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
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

export default function CollegeOfficeNonTechnicalStaffPage() {
  const router = useRouter();
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [deleteTarget, setDeleteTarget] = useState<StaffRow | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  async function load() {
    setIsLoading(true);
    try {
      const res = await fetch("/api/college/supporting-staff");
      const data = await res.json() as { staff: StaffRow[] };
      setStaff(data.staff ?? []);
    } catch {
      toast({ variant: "destructive", title: "Failed to load non-technical staff" });
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  async function handleDelete() {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      const res = await fetch(`/api/college/supporting-staff/${deleteTarget.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast({ variant: "success", title: `${deleteTarget.name} removed` });
      setDeleteTarget(null);
      void load();
    } catch {
      toast({ variant: "destructive", title: "Failed to delete staff record" });
    } finally {
      setIsDeleting(false);
    }
  }

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
    {
      key: "actions",
      header: "",
      render: (row) => (
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); router.push(`/college-office/non-technical-staff/${row.id}/edit`); }}>
            <Pencil className="h-3.5 w-3.5" /><span className="ml-1 hidden sm:inline">Edit</span>
          </Button>
          <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={(e) => { e.stopPropagation(); setDeleteTarget(row); }}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Non-Technical Staff"
        description="Non-Technical staff records for your college"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => router.push("/college-office/non-technical-staff/import")}>
              <Upload className="h-4 w-4 mr-2" />Import
            </Button>
            <Button onClick={() => router.push("/college-office/non-technical-staff/new")}>
              <UserPlus className="h-4 w-4 mr-2" />Add Staff
            </Button>
          </div>
        }
      />

      <DataTable
        data={staff}
        columns={columns}
        isLoading={isLoading}
        keyExtractor={(r) => r.id}
        searchPlaceholder="Search by name, email, employee ID..."
        searchKeys={["name", "email", "employeeId"] as (keyof StaffRow)[]}
        emptyTitle="No non-technical staff records yet"
        emptyDescription="Add Non-Technical staff to build your college's records"
        emptyAction={<Button onClick={() => router.push("/college-office/non-technical-staff/new")}><UserPlus className="h-4 w-4 mr-2" />Add Staff</Button>}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}
        title="Delete staff record?"
        description={`This will permanently remove ${deleteTarget?.name ?? "this staff member"} (${deleteTarget?.employeeId ?? ""}). This cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => void handleDelete()}
        loading={isDeleting}
      />
    </div>
  );
}
